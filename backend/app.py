
import os
import re
import hashlib
import mimetypes
import secrets
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import wraps
from pathlib import Path

import pymysql
import pymysql.cursors
from PIL import Image, ImageOps, UnidentifiedImageError

from flask import Flask, request, jsonify, g, send_file
from flask_cors import CORS
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired

load_dotenv()

app = Flask(__name__, static_folder=None)
MAX_MEDIA_UPLOAD_MB = max(1, int(os.getenv("MAX_MEDIA_UPLOAD_MB", "50")))
MAX_MEDIA_UPLOAD_BYTES = MAX_MEDIA_UPLOAD_MB * 1024 * 1024
app.config["MAX_CONTENT_LENGTH"] = MAX_MEDIA_UPLOAD_BYTES + (1024 * 1024)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "")
BACKEND_ROOT = Path(__file__).resolve().parent
LEGACY_MEDIA_ROOT = (BACKEND_ROOT / "storage").resolve()
DEFAULT_MEDIA_ROOT = BACKEND_ROOT / "static"
WWW_MEDIA_ROOT = BACKEND_ROOT.parent / "static"
if not DEFAULT_MEDIA_ROOT.is_dir() and WWW_MEDIA_ROOT.is_dir():
    DEFAULT_MEDIA_ROOT = WWW_MEDIA_ROOT
MEDIA_ROOT = Path(os.getenv("RERE_CLOUD_STORAGE", DEFAULT_MEDIA_ROOT)).resolve()
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)
for media_folder in ("images", "videos", "documents", "other", "thumbnails"):
    (MEDIA_ROOT / media_folder).mkdir(parents=True, exist_ok=True)

if not app.config["SECRET_KEY"]:
    raise RuntimeError("Set SECRET_KEY in your .env file.")

frontend_origins = [
    "http://localhost:5173",
    "https://fernando-exe.vercel.app",
    *[
        origin.strip()
        for origin in os.getenv("FRONTEND_ORIGIN", "").split(",")
        if origin.strip()
    ],
]
CORS(app, resources={r"/api/*": {"origins": frontend_origins}})

serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
PHOTO_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
VIDEO_EXTENSIONS = {".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"}
DOCUMENT_EXTENSIONS = {".pdf", ".txt", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".csv"}


# ============================================================
# DATABASE HELPERS
# ============================================================

def get_db_connection():
    return pymysql.connect(
        host=os.getenv("DB_HOST", "localhost"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD", ""),
        database=os.getenv("DB_NAME", "fernando_exe_db"),
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False
    )


def query_db(sql, params=(), fetchone=False):
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchone() if fetchone else cursor.fetchall()
    finally:
        connection.close()


def execute_db(sql, params=()):
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            result = {
                "lastrowid": cursor.lastrowid,
                "rowcount": cursor.rowcount
            }
        connection.commit()
        return result
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def get_data():
    if request.is_json:
        return request.get_json(silent=True) or {}
    return request.form.to_dict()


def clean_string(value, limit=255):
    if not isinstance(value, str):
        return ""
    return value.strip()[:limit]


def api_error(message, status=400):
    return jsonify({"error": message}), status


def parse_id(value):
    try:
        number = int(value)
        return number if number > 0 else None
    except (ValueError, TypeError):
        return None


def parse_amount(value):
    try:
        amount = Decimal(str(value))
        if not amount.is_finite() or amount < 0:
            return None
        if amount > Decimal("999999999999.99"):
            return None
        return amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError, TypeError):
        return None


def parse_date(value, optional=False):
    if optional and (value is None or value == ""):
        return None
    if not isinstance(value, str):
        return False
    try:
        return date.fromisoformat(value)
    except ValueError:
        return False


def handle_database_error(action):
    app.logger.exception("Database operation failed: %s", action)
    return api_error("A database error occurred.", 500)


def get_family_for_user(user_id, family_id=None):
    if family_id is None:
        return query_db(
            """
            SELECT f.id, f.name, fm.role
            FROM family_members fm JOIN families f ON f.id = fm.family_id
            WHERE fm.user_id = %s ORDER BY f.id LIMIT 1
            """,
            (user_id,), fetchone=True
        )
    return query_db(
        """
        SELECT f.id, f.name, fm.role
        FROM family_members fm JOIN families f ON f.id = fm.family_id
        WHERE fm.user_id = %s AND f.id = %s
        """,
        (user_id, family_id), fetchone=True
    )


def ensure_family_tables():
    required = (
        """
        CREATE TABLE IF NOT EXISTS families (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            name VARCHAR(100) NOT NULL,
            slug VARCHAR(120) NOT NULL,
            created_by INT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_families_slug (slug),
            KEY idx_families_created_by (created_by),
            CONSTRAINT fk_families_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS family_members (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            family_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            role ENUM('owner','admin','member') NOT NULL DEFAULT 'member',
            joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_family_members (family_id, user_id),
            KEY idx_family_members_user (user_id),
            CONSTRAINT fk_family_members_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
            CONSTRAINT fk_family_members_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS family_files (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            family_id INT UNSIGNED NOT NULL,
            uploaded_by INT UNSIGNED NOT NULL,
            original_name VARCHAR(255) NOT NULL,
            stored_name VARCHAR(255) NOT NULL,
            category ENUM('photo','video','document','other') NOT NULL DEFAULT 'other',
            mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
            size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
            file_path VARCHAR(500) NOT NULL,
            file_date DATE DEFAULT NULL,
            thumbnail_path VARCHAR(500) DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_family_files_family (family_id),
            KEY idx_family_files_user (uploaded_by),
            KEY idx_family_files_date (file_date),
            CONSTRAINT fk_family_files_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
            CONSTRAINT fk_family_files_user FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS family_invites (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            family_id INT UNSIGNED NOT NULL,
            created_by INT UNSIGNED NOT NULL,
            code_hash CHAR(64) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_family_invites_code (code_hash),
            KEY idx_family_invites_family (family_id),
            CONSTRAINT fk_family_invites_family FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
            CONSTRAINT fk_family_invites_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
    )

    try:
        for statement in required:
            execute_db(statement)
    except pymysql.MySQLError:
        app.logger.exception("Family cloud tables could not be created.")
        raise


def ensure_finance_tables():
    required = (
        """
        CREATE TABLE IF NOT EXISTS finance_accounts (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            name VARCHAR(100) NOT NULL,
            balance DECIMAL(14,2) NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_finance_accounts_name (user_id, name),
            CONSTRAINT fk_finance_accounts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS expense_categories (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            name VARCHAR(100) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            UNIQUE KEY uq_expense_categories_name (user_id, name),
            CONSTRAINT fk_expense_categories_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS finance_budgets (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            category VARCHAR(100) NOT NULL,
            amount DECIMAL(14,2) NOT NULL,
            period ENUM('daily','weekly','monthly','yearly') NOT NULL DEFAULT 'monthly',
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_finance_budgets_user (user_id),
            CONSTRAINT fk_finance_budgets_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS financial_goals (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            user_id INT UNSIGNED NOT NULL,
            title VARCHAR(150) NOT NULL,
            target_amount DECIMAL(14,2) NOT NULL,
            target_date DATE DEFAULT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_financial_goals_user (user_id),
            CONSTRAINT fk_financial_goals_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
        """
        CREATE TABLE IF NOT EXISTS goal_contributions (
            id INT UNSIGNED NOT NULL AUTO_INCREMENT,
            goal_id INT UNSIGNED NOT NULL,
            user_id INT UNSIGNED NOT NULL,
            account_id INT UNSIGNED NOT NULL,
            amount DECIMAL(14,2) NOT NULL,
            xp INT UNSIGNED NOT NULL DEFAULT 0,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (id),
            KEY idx_goal_contributions_goal (goal_id),
            CONSTRAINT fk_goal_contributions_goal FOREIGN KEY (goal_id) REFERENCES financial_goals(id) ON DELETE CASCADE,
            CONSTRAINT fk_goal_contributions_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            CONSTRAINT fk_goal_contributions_account FOREIGN KEY (account_id) REFERENCES finance_accounts(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci
        """,
    )

    for statement in required:
        execute_db(statement)

    budget_period = query_db("SHOW COLUMNS FROM finance_budgets LIKE 'period'", fetchone=True)
    if "daily" not in budget_period["Type"] or "weekly" not in budget_period["Type"]:
        execute_db("ALTER TABLE finance_budgets MODIFY period ENUM('daily','weekly','monthly','yearly') NOT NULL DEFAULT 'monthly'")
    columns = {row["Field"] for row in query_db("SHOW COLUMNS FROM expenses")}
    if "account_id" not in columns:
        execute_db("ALTER TABLE expenses ADD COLUMN account_id INT UNSIGNED DEFAULT NULL AFTER user_id")
    if "transaction_type" not in columns:
        execute_db("ALTER TABLE expenses ADD COLUMN transaction_type ENUM('expense','income') NOT NULL DEFAULT 'expense' AFTER amount")
    execute_db(
        """INSERT IGNORE INTO expense_categories (user_id, name)
        SELECT DISTINCT user_id, category FROM expenses WHERE category <> ''"""
    )


def slugify(value):
    slug = re.sub(r"[^a-z0-9]+", "-", (value or "family").lower()).strip("-")
    return slug[:80] or "family"


def ensure_default_family_for_user(user_id):
    existing = get_family_for_user(user_id)
    if existing:
        return existing["id"]

    user = query_db(
        "SELECT first_name, last_name FROM users WHERE id = %s",
        (user_id,),
        fetchone=True,
    )
    if not user:
        return None

    family_name = f"{user['first_name']} & Family" if user.get("first_name") else "My Family"
    slug = f"{slugify(family_name)}-{user_id}"

    try:
        family_result = execute_db(
            "INSERT INTO families (name, slug, created_by) VALUES (%s, %s, %s)",
            (family_name, slug, user_id),
        )
        family_id = family_result["lastrowid"]
        execute_db(
            "INSERT INTO family_members (family_id, user_id, role) VALUES (%s, %s, 'owner')",
            (family_id, user_id),
        )
        return family_id
    except pymysql.err.IntegrityError:
        return get_family_for_user(user_id)["id"] if get_family_for_user(user_id) else None


def invite_digest(code):
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def classify_media(filename):
    extension = Path(filename).suffix.casefold()
    if extension in PHOTO_EXTENSIONS:
        return "photo"
    if extension in VIDEO_EXTENSIONS:
        return "video"
    if extension in DOCUMENT_EXTENSIONS:
        return "document"
    return "other"


def photo_capture_date(upload):
    upload.stream.seek(0)
    try:
        with Image.open(upload.stream) as image:
            image.verify()
        upload.stream.seek(0)
        with Image.open(upload.stream) as image:
            exif = image.getexif()
            raw_date = exif.get(36867) or exif.get(306)
            if raw_date:
                try:
                    return datetime.strptime(str(raw_date), "%Y:%m:%d %H:%M:%S")
                except ValueError:
                    app.logger.info("Photo has an unreadable EXIF capture date")
    except (UnidentifiedImageError, OSError, RuntimeError, Image.DecompressionBombError) as error:
        raise ValueError("This image could not be verified. Upload a valid JPG, PNG, GIF, or WebP photo.") from error
    finally:
        upload.stream.seek(0)
    return datetime.now()


def media_paths(family_id, category, file_date, stored_name):
    category_folder = {"photo": "images", "video": "videos", "document": "documents", "other": "other"}[category]
    relative_path = Path(str(family_id)) / category_folder / file_date.strftime("%Y") / file_date.strftime("%m") / stored_name
    absolute_path = (MEDIA_ROOT / relative_path).resolve()
    if os.path.commonpath((str(MEDIA_ROOT), str(absolute_path))) != str(MEDIA_ROOT):
        raise ValueError("Invalid media storage path.")
    return relative_path.as_posix(), absolute_path


def thumbnail_path(family_id, file_date, stored_name):
    thumbnail_name = f"{Path(stored_name).stem}.jpg"
    relative_path = Path("thumbnails") / str(family_id) / file_date.strftime("%Y") / file_date.strftime("%m") / thumbnail_name
    absolute_path = (MEDIA_ROOT / relative_path).resolve()
    if os.path.commonpath((str(MEDIA_ROOT), str(absolute_path))) != str(MEDIA_ROOT):
        raise ValueError("Invalid thumbnail storage path.")
    return relative_path.as_posix(), absolute_path


def resolve_media_path(relative_path):
    for root in dict.fromkeys((MEDIA_ROOT, LEGACY_MEDIA_ROOT)):
        absolute_path = (root / relative_path).resolve()
        try:
            is_within_root = os.path.commonpath((str(root), str(absolute_path))) == str(root)
        except ValueError:
            continue
        if is_within_root and absolute_path.exists():
            return absolute_path
    return None


def create_photo_thumbnail(source_path, target_path):
    target_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_path) as image:
        image = ImageOps.exif_transpose(image)
        resampling = getattr(Image, "Resampling", Image)
        image.thumbnail((720, 540), resampling.LANCZOS)
        if image.mode != "RGB":
            image = image.convert("RGB")
        image.save(target_path, "JPEG", quality=84, optimize=True)


def media_response(row):
    uploader_name = row.get("uploader_name")
    if not uploader_name and row.get("first_name"):
        uploader_name = f"{row.get('first_name', '').strip()} {row.get('last_name', '').strip()}".strip()
    return {
        "id": row["id"],
        "family_id": row["family_id"],
        "uploaded_by": row["uploaded_by"],
        "uploader_name": uploader_name,
        "category": row["category"],
        "original_name": row["original_name"],
        "mime_type": row["mime_type"],
        "size_bytes": row["size_bytes"],
        "file_date": row["file_date"].isoformat() if row.get("file_date") else None,
        "created_at": row["created_at"].isoformat() if row.get("created_at") else None,
        "download_url": f"/api/files/{row['id']}/download",
        "thumbnail_url": f"/api/files/{row['id']}/thumbnail" if row.get("thumbnail_path") else None,
    }


ensure_family_tables()
ensure_finance_tables()


# ============================================================
# AUTHENTICATION
# ============================================================

def create_token(user_id):
    return serializer.dumps({"user_id": user_id}, salt="fernando-auth")


def require_auth(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        header = request.headers.get("Authorization", "")

        if not header.startswith("Bearer "):
            return api_error("Authentication required.", 401)

        token = header[7:].strip()

        try:
            payload = serializer.loads(
                token,
                salt="fernando-auth",
                max_age=86400
            )
        except (BadSignature, SignatureExpired):
            return api_error("Invalid or expired token.", 401)

        user_id = parse_id(payload.get("user_id"))
        if not user_id:
            return api_error("Invalid token.", 401)

        try:
            user = query_db(
                """
                SELECT id, first_name, last_name, username, email, phone, occupation
                FROM users WHERE id = %s
                """,
                (user_id,),
                fetchone=True
            )
        except pymysql.MySQLError:
            return handle_database_error("authenticate user")

        if not user:
            return api_error("User account not found.", 401)

        g.user = user
        return function(*args, **kwargs)

    return wrapper


# ============================================================
# HEALTH CHECK
# ============================================================

@app.route("/api/health", methods=["GET"])
def health():
    try:
        query_db("SELECT 1")
        return jsonify({
            "status": "ok",
            "api": "FERNANDO.EXE",
            "database": "connected"
        }), 200
    except pymysql.MySQLError:
        app.logger.exception("Health check failed")
        return jsonify({
            "status": "error",
            "database": "unavailable"
        }), 503


# ============================================================
# SIGNUP
# ============================================================

@app.route("/api/signup", methods=["POST"])
def signup():
    data = get_data()

    first_name = clean_string(data.get("first_name"), 100)
    last_name = clean_string(data.get("last_name"), 100)
    username = clean_string(data.get("username"), 50).casefold()
    email = clean_string(data.get("email"), 254).casefold()
    password = data.get("password")
    phone = clean_string(data.get("phone"), 40)
    occupation = clean_string(data.get("occupation"), 30).casefold()
    allowed_occupations = {"student", "employed", "self_employed", "homemaker", "caregiver", "retired", "other"}

    if not all([first_name, last_name, username, email, password, phone, occupation]):
        return api_error("All fields are required.")
    if occupation not in allowed_occupations:
        return api_error("Choose a valid occupation.")

    if not re.fullmatch(r"[a-z0-9_.-]{3,50}", username):
        return api_error("Username must be 3-50 characters using letters, numbers, _, . or -.")

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return api_error("Enter a valid email address.")

    if not isinstance(password, str) or not 8 <= len(password) <= 128:
        return api_error("Password must be 8-128 characters.")

    if not re.fullmatch(r"[+() 0-9-]+", phone):
        return api_error("Enter a valid Kenyan phone number.")

    digits = re.sub(r"\D", "", phone)
    if len(digits) != 12 or not digits.startswith("254"):
        return api_error("Phone must contain +254 followed by 9 digits.")

    phone = f"+254({digits[3:6]}) ({digits[6:9]}) ({digits[9:12]})"
    password_hash = generate_password_hash(password)

    try:
        result = execute_db(
            """
            INSERT INTO users
                (first_name, last_name, username, password, email, phone, occupation)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (first_name, last_name, username, password_hash, email, phone, occupation)
        )
        family_id = ensure_default_family_for_user(result["lastrowid"])
        return jsonify({
            "message": "Account created successfully.",
            "user_id": result["lastrowid"],
            "family_id": family_id
        }), 201

    except pymysql.err.IntegrityError as error:
        if error.args and error.args[0] == 1062:
            return api_error("Username, email, or phone is already registered.", 409)
        return handle_database_error("signup")
    except pymysql.MySQLError:
        return handle_database_error("signup")


# ============================================================
# SIGNIN
# ============================================================

@app.route("/api/signin", methods=["POST"])
def signin():
    data = get_data()
    username = clean_string(data.get("username"), 50).casefold()
    password = data.get("password")

    if not username or not isinstance(password, str) or not password:
        return api_error("Username and password are required.")

    try:
        user = query_db(
            "SELECT id, password FROM users WHERE username = %s LIMIT 1",
            (username,),
            fetchone=True
        )

        if not user or not check_password_hash(user["password"], password):
            return api_error("Invalid username or password.", 401)

        public_user = query_db(
            """
            SELECT id, first_name, last_name, username, email, phone, occupation
            FROM users WHERE id = %s
            """,
            (user["id"],),
            fetchone=True
        )
        family = get_family_for_user(public_user["id"])
        if family:
            public_user["family_id"] = family["id"]
            public_user["family_name"] = family["name"]
        else:
            family_id = ensure_default_family_for_user(public_user["id"])
            family = get_family_for_user(public_user["id"])
            if family:
                public_user["family_id"] = family["id"]
                public_user["family_name"] = family["name"]

        return jsonify({
            "message": "Signed in successfully.",
            "token": create_token(public_user["id"]),
            "user": public_user
        }), 200

    except pymysql.MySQLError:
        return handle_database_error("signin")


# ============================================================
# PROFILE
# ============================================================

@app.route("/api/profile", methods=["GET"])
@require_auth
def get_profile():
    return jsonify({"user": g.user}), 200


@app.route("/api/profile", methods=["PATCH"])
@require_auth
def update_profile():
    data = get_data()

    first_name = clean_string(data.get("first_name"), 100)
    last_name = clean_string(data.get("last_name"), 100)
    email = clean_string(data.get("email"), 254).casefold()
    occupation = clean_string(data.get("occupation", g.user.get("occupation", "other")), 30).casefold()
    allowed_occupations = {"student", "employed", "self_employed", "homemaker", "caregiver", "retired", "other"}

    if not first_name or not last_name:
        return api_error("First name and last name are required.")

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return api_error("Enter a valid email address.")
    if occupation not in allowed_occupations:
        return api_error("Choose a valid occupation.")

    try:
        execute_db(
            """
            UPDATE users
            SET first_name = %s, last_name = %s, email = %s, occupation = %s
            WHERE id = %s
            """,
            (first_name, last_name, email, occupation, g.user["id"])
        )
        user = query_db(
            """
            SELECT id, first_name, last_name, username, email, phone, occupation
            FROM users WHERE id = %s
            """,
            (g.user["id"],),
            fetchone=True
        )
        return jsonify({"message": "Profile updated.", "user": user}), 200
    except pymysql.err.IntegrityError:
        return api_error("Email address is already in use.", 409)
    except pymysql.MySQLError:
        return handle_database_error("update profile")


# ============================================================
# PROJECTS CRUD
# ============================================================

@app.route("/api/projects", methods=["GET"])
@require_auth
def get_projects():
    try:
        rows = query_db(
            """
            SELECT id, title, description, status, created_at, updated_at
            FROM projects WHERE user_id = %s ORDER BY id DESC
            """,
            (g.user["id"],)
        )
        return jsonify({"projects": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get projects")


@app.route("/api/projects", methods=["POST"])
@require_auth
def create_project():
    data = get_data()
    title = clean_string(data.get("title"), 150)
    description = clean_string(data.get("description"), 5000)
    status = clean_string(data.get("status") or "active", 30).casefold()

    if not title:
        return api_error("Project title is required.")
    if status not in {"active", "completed", "on_hold", "archived"}:
        return api_error("Invalid project status.")

    try:
        result = execute_db(
            """
            INSERT INTO projects (user_id, title, description, status)
            VALUES (%s, %s, %s, %s)
            """,
            (g.user["id"], title, description, status)
        )
        return jsonify({
            "message": "Project created.",
            "project_id": result["lastrowid"]
        }), 201
    except pymysql.MySQLError:
        return handle_database_error("create project")


@app.route("/api/projects/<int:project_id>", methods=["GET"])
@require_auth
def get_project(project_id):
    try:
        row = query_db(
            """
            SELECT id, title, description, status, created_at, updated_at
            FROM projects WHERE id = %s AND user_id = %s
            """,
            (project_id, g.user["id"]),
            fetchone=True
        )
        if not row:
            return api_error("Project not found.", 404)
        return jsonify({"project": row}), 200
    except pymysql.MySQLError:
        return handle_database_error("get project")


@app.route("/api/projects/<int:project_id>", methods=["PATCH"])
@require_auth
def update_project(project_id):
    data = get_data()
    updates = {}

    for key, limit in [("title", 150), ("description", 5000), ("status", 30)]:
        if key in data:
            if not isinstance(data[key], str):
                return api_error(f"{key} must be text.")
            updates[key] = data[key].strip()[:limit]

    if not updates:
        return api_error("Provide fields to update.")

    if "title" in updates and not updates["title"]:
        return api_error("Project title cannot be empty.")

    if "status" in updates:
        updates["status"] = updates["status"].casefold()
        if updates["status"] not in {"active", "completed", "on_hold", "archived"}:
            return api_error("Invalid project status.")

    columns = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [project_id, g.user["id"]]

    try:
        result = execute_db(
            f"UPDATE projects SET {columns} WHERE id = %s AND user_id = %s",
            params
        )
        if not result["rowcount"]:
            exists = query_db(
                "SELECT id FROM projects WHERE id=%s AND user_id=%s",
                (project_id, g.user["id"]),
                fetchone=True
            )
            if not exists:
                return api_error("Project not found.", 404)
        return jsonify({"message": "Project updated."}), 200
    except pymysql.MySQLError:
        return handle_database_error("update project")


@app.route("/api/projects/<int:project_id>", methods=["DELETE"])
@require_auth
def delete_project(project_id):
    try:
        result = execute_db(
            "DELETE FROM projects WHERE id=%s AND user_id=%s",
            (project_id, g.user["id"])
        )
        if not result["rowcount"]:
            return api_error("Project not found.", 404)
        return jsonify({"message": "Project deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete project")


# ============================================================
# FINANCE ACCOUNTS AND CATEGORIES
# ============================================================

@app.route("/api/finance/accounts", methods=["GET"])
@require_auth
def get_finance_accounts():
    try:
        rows = query_db(
            "SELECT id, name, balance, created_at FROM finance_accounts WHERE user_id=%s ORDER BY id",
            (g.user["id"],),
        )
        return jsonify({"accounts": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get finance accounts")


@app.route("/api/finance/accounts", methods=["POST"])
@require_auth
def create_finance_account():
    data = get_data()
    name = clean_string(data.get("name"), 100)
    balance = parse_amount(data.get("balance", 0))
    if not name or balance is None:
        return api_error("Account name and a valid non-negative opening balance are required.")
    try:
        result = execute_db(
            "INSERT INTO finance_accounts (user_id, name, balance) VALUES (%s, %s, %s)",
            (g.user["id"], name, balance),
        )
        return jsonify({"message": "Account created.", "account_id": result["lastrowid"]}), 201
    except pymysql.err.IntegrityError:
        return api_error("An account with that name already exists.", 409)
    except pymysql.MySQLError:
        return handle_database_error("create finance account")


@app.route("/api/finance/accounts/<int:account_id>", methods=["DELETE"])
@require_auth
def delete_finance_account(account_id):
    try:
        linked_expense = query_db(
            "SELECT id FROM expenses WHERE account_id=%s AND user_id=%s LIMIT 1",
            (account_id, g.user["id"]), fetchone=True,
        )
        linked_goal = query_db(
            "SELECT id FROM goal_contributions WHERE account_id=%s AND user_id=%s LIMIT 1",
            (account_id, g.user["id"]), fetchone=True,
        )
        if linked_expense or linked_goal:
            return api_error("This account has transaction or goal history and cannot be deleted.", 409)
        result = execute_db("DELETE FROM finance_accounts WHERE id=%s AND user_id=%s", (account_id, g.user["id"]))
        if not result["rowcount"]:
            return api_error("Account not found.", 404)
        return jsonify({"message": "Account deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete finance account")


@app.route("/api/finance/categories", methods=["GET"])
@require_auth
def get_expense_categories():
    try:
        rows = query_db(
            "SELECT id, name FROM expense_categories WHERE user_id=%s ORDER BY name",
            (g.user["id"],),
        )
        return jsonify({"categories": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get expense categories")


@app.route("/api/finance/categories", methods=["POST"])
@require_auth
def create_expense_category():
    name = clean_string(get_data().get("name"), 100)
    if not name:
        return api_error("Category name is required.")
    try:
        result = execute_db(
            "INSERT INTO expense_categories (user_id, name) VALUES (%s, %s)",
            (g.user["id"], name),
        )
        return jsonify({"message": "Category created.", "category_id": result["lastrowid"]}), 201
    except pymysql.err.IntegrityError:
        return api_error("That category already exists.", 409)
    except pymysql.MySQLError:
        return handle_database_error("create expense category")


# ============================================================
# EXPENSES CRUD
# ============================================================

@app.route("/api/finance/budgets", methods=["GET"])
@require_auth
def get_finance_budgets():
    today = date.today()
    week_start = today - timedelta(days=today.weekday())
    month_start = today.replace(day=1)
    year_start = today.replace(month=1, day=1)
    period_starts = {
        "daily": today,
        "weekly": week_start,
        "monthly": month_start,
        "yearly": year_start,
    }
    try:
        budgets = query_db(
            "SELECT id, category, amount, period, created_at FROM finance_budgets WHERE user_id=%s ORDER BY id DESC",
            (g.user["id"],),
        )
        rows = query_db(
            """SELECT category, expense_date, SUM(amount) AS spent FROM expenses
            WHERE user_id=%s AND transaction_type='expense' AND expense_date >= %s AND expense_date <= %s
            GROUP BY category, expense_date""",
            (g.user["id"], min(period_starts.values()), today),
        )
        totals = {period: {} for period in period_starts}
        for row in rows:
            amount = Decimal(row["spent"] or 0)
            for period, start_date in period_starts.items():
                if row["expense_date"] >= start_date:
                    category_totals = totals[period]
                    category_totals[row["category"]] = category_totals.get(row["category"], Decimal(0)) + amount
        for budget in budgets:
            budget["spent"] = totals[budget["period"]].get(budget["category"], Decimal(0))
        return jsonify({"budgets": budgets}), 200
    except pymysql.MySQLError:
        return handle_database_error("get finance budgets")


@app.route("/api/finance/budgets", methods=["POST"])
@require_auth
def create_finance_budget():
    data = get_data()
    category = clean_string(data.get("category"), 100)
    amount = parse_amount(data.get("amount"))
    period = clean_string(data.get("period") or "monthly", 20).casefold()
    if not category or amount is None or amount <= 0 or period not in {"daily", "weekly", "monthly", "yearly"}:
        return api_error("Choose a category, a positive budget amount, and a valid period.")
    try:
        result = execute_db(
            "INSERT INTO finance_budgets (user_id, category, amount, period) VALUES (%s, %s, %s, %s)",
            (g.user["id"], category, amount, period),
        )
        return jsonify({"message": "Budget created.", "budget_id": result["lastrowid"]}), 201
    except pymysql.MySQLError:
        return handle_database_error("create finance budget")


@app.route("/api/finance/budgets/<int:budget_id>", methods=["DELETE"])
@require_auth
def delete_finance_budget(budget_id):
    try:
        result = execute_db("DELETE FROM finance_budgets WHERE id=%s AND user_id=%s", (budget_id, g.user["id"]))
        if not result["rowcount"]:
            return api_error("Budget not found.", 404)
        return jsonify({"message": "Budget deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete finance budget")


@app.route("/api/finance/goals", methods=["GET"])
@require_auth
def get_financial_goals():
    try:
        rows = query_db(
            """SELECT g.id, g.title, g.target_amount, g.target_date, g.created_at,
            COALESCE(SUM(c.amount), 0) AS saved_amount, COALESCE(SUM(c.xp), 0) AS xp
            FROM financial_goals g LEFT JOIN goal_contributions c ON c.goal_id=g.id AND c.user_id=g.user_id
            WHERE g.user_id=%s GROUP BY g.id ORDER BY g.id DESC""",
            (g.user["id"],),
        )
        return jsonify({"goals": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get financial goals")


@app.route("/api/finance/goals", methods=["POST"])
@require_auth
def create_financial_goal():
    data = get_data()
    title = clean_string(data.get("title"), 150)
    target = parse_amount(data.get("target_amount"))
    target_date = parse_date(data.get("target_date"), optional=True)
    if not title or target is None or target <= 0:
        return api_error("Goal name and a positive target amount are required.")
    if target_date is False:
        return api_error("Use a valid target date in YYYY-MM-DD format.")
    try:
        result = execute_db(
            "INSERT INTO financial_goals (user_id, title, target_amount, target_date) VALUES (%s, %s, %s, %s)",
            (g.user["id"], title, target, target_date),
        )
        return jsonify({"message": "Goal created.", "goal_id": result["lastrowid"]}), 201
    except pymysql.MySQLError:
        return handle_database_error("create financial goal")


@app.route("/api/finance/goals/<int:goal_id>", methods=["DELETE"])
@require_auth
def delete_financial_goal(goal_id):
    try:
        result = execute_db("DELETE FROM financial_goals WHERE id=%s AND user_id=%s", (goal_id, g.user["id"]))
        if not result["rowcount"]:
            return api_error("Financial goal not found.", 404)
        return jsonify({"message": "Financial goal deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete financial goal")


@app.route("/api/finance/goals/<int:goal_id>/contributions", methods=["POST"])
@require_auth
def contribute_to_financial_goal(goal_id):
    data = get_data()
    amount = parse_amount(data.get("amount"))
    account_id = parse_id(data.get("account_id"))
    if amount is None or amount <= 0 or not account_id:
        return api_error("Choose an account and enter a positive contribution.")
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT id FROM financial_goals WHERE id=%s AND user_id=%s FOR UPDATE", (goal_id, g.user["id"]))
            if not cursor.fetchone():
                connection.rollback()
                return api_error("Financial goal not found.", 404)
            cursor.execute("SELECT balance FROM finance_accounts WHERE id=%s AND user_id=%s FOR UPDATE", (account_id, g.user["id"]))
            account = cursor.fetchone()
            if not account:
                connection.rollback()
                return api_error("Account not found.", 404)
            if Decimal(account["balance"]) < amount:
                connection.rollback()
                return api_error("That account does not have enough money for this contribution.", 409)
            xp = max(1, int(amount // Decimal("100")))
            cursor.execute("UPDATE finance_accounts SET balance=balance-%s WHERE id=%s", (amount, account_id))
            cursor.execute(
                "INSERT INTO goal_contributions (goal_id, user_id, account_id, amount, xp) VALUES (%s, %s, %s, %s, %s)",
                (goal_id, g.user["id"], account_id, amount, xp),
            )
        connection.commit()
        return jsonify({"message": "Goal contribution saved.", "xp_earned": xp}), 201
    except pymysql.MySQLError:
        connection.rollback()
        return handle_database_error("contribute to financial goal")
    finally:
        connection.close()


@app.route("/api/expenses", methods=["GET"])
@require_auth
def get_expenses():
    try:
        rows = query_db(
            """
            SELECT e.id, e.title, e.amount, e.category,
                CAST(e.expense_date AS CHAR) AS expense_date, e.created_at,
                e.account_id, e.transaction_type, a.name AS account_name
            FROM expenses e LEFT JOIN finance_accounts a ON a.id=e.account_id
            WHERE e.user_id = %s
            ORDER BY e.expense_date DESC, e.id DESC
            """,
            (g.user["id"],)
        )
        return jsonify({"expenses": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get expenses")


@app.route("/api/expenses", methods=["POST"])
@require_auth
def create_expense():
    data = get_data()
    title = clean_string(data.get("title"), 150)
    category = clean_string(data.get("category"), 100)
    amount = parse_amount(data.get("amount"))
    expense_date = parse_date(data.get("expense_date"), optional=True)
    account_id = parse_id(data.get("account_id"))
    transaction_type = clean_string(data.get("transaction_type") or "expense", 20).casefold()

    if not title or not category or amount is None or amount <= 0 or not account_id:
        return api_error("Title, category, account and a valid positive amount are required.")
    if transaction_type not in {"expense", "income"}:
        return api_error("Choose either an expense or income transaction.")
    if expense_date is False:
        return api_error("Use a valid date in YYYY-MM-DD format.")

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT balance FROM finance_accounts WHERE id=%s AND user_id=%s FOR UPDATE", (account_id, g.user["id"]))
            account = cursor.fetchone()
            if not account:
                connection.rollback()
                return api_error("Account not found.", 404)
            if transaction_type == "expense" and Decimal(account["balance"]) < amount:
                connection.rollback()
                return api_error("That account does not have enough money for this expense.", 409)
            balance_delta = amount if transaction_type == "income" else -amount
            cursor.execute("UPDATE finance_accounts SET balance=balance+%s WHERE id=%s", (balance_delta, account_id))
            cursor.execute(
                """INSERT INTO expenses (user_id, account_id, transaction_type, title, amount, category, expense_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s)""",
                (g.user["id"], account_id, transaction_type, title, amount, category, expense_date or date.today()),
            )
            expense_id = cursor.lastrowid
        connection.commit()
        return jsonify({
            "message": "Income recorded." if transaction_type == "income" else "Expense recorded.",
            "expense_id": expense_id
        }), 201
    except pymysql.MySQLError:
        connection.rollback()
        return handle_database_error("create expense")
    finally:
        connection.close()


@app.route("/api/expenses/<int:expense_id>", methods=["PATCH"])
@require_auth
def update_expense(expense_id):
    data = get_data()
    updates = {}

    if "title" in data:
        title = clean_string(data["title"], 150)
        if not title:
            return api_error("Title cannot be empty.")
        updates["title"] = title

    if "category" in data:
        category = clean_string(data["category"], 100)
        if not category:
            return api_error("Category cannot be empty.")
        updates["category"] = category

    if "amount" in data:
        amount = parse_amount(data["amount"])
        if amount is None:
            return api_error("Enter a valid non-negative amount.")
        updates["amount"] = amount

    if "expense_date" in data:
        expense_date = parse_date(data["expense_date"])
        if expense_date is False:
            return api_error("Use a valid date in YYYY-MM-DD format.")
        updates["expense_date"] = expense_date

    if "transaction_type" in data:
        transaction_type = clean_string(data["transaction_type"], 20).casefold()
        if transaction_type not in {"expense", "income"}:
            return api_error("Choose either an expense or income transaction.")
        updates["transaction_type"] = transaction_type

    if "account_id" in data:
        account_id = parse_id(data["account_id"])
        if not account_id:
            return api_error("Choose a valid account.")
        updates["account_id"] = account_id

    if not updates:
        return api_error("Provide fields to update.")

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT account_id, amount, transaction_type FROM expenses WHERE id=%s AND user_id=%s FOR UPDATE",
                (expense_id, g.user["id"]),
            )
            existing = cursor.fetchone()
            if not existing:
                connection.rollback()
                return api_error("Expense not found.", 404)
            old_account_id = existing["account_id"]
            next_account_id = updates.get("account_id", old_account_id)
            next_amount = Decimal(updates.get("amount", existing["amount"]))
            next_type = updates.get("transaction_type", existing["transaction_type"])
            account_ids = sorted({value for value in (old_account_id, next_account_id) if value})
            balances = {}
            for current_id in account_ids:
                cursor.execute("SELECT balance FROM finance_accounts WHERE id=%s AND user_id=%s FOR UPDATE", (current_id, g.user["id"]))
                account = cursor.fetchone()
                if not account:
                    connection.rollback()
                    return api_error("Account not found.", 404)
                balances[current_id] = Decimal(account["balance"])

            changes = {}
            if old_account_id:
                old_amount = Decimal(existing["amount"])
                changes[old_account_id] = old_amount if existing["transaction_type"] == "expense" else -old_amount
            if next_account_id:
                next_delta = -next_amount if next_type == "expense" else next_amount
                changes[next_account_id] = changes.get(next_account_id, Decimal(0)) + next_delta
            for current_id, delta in changes.items():
                if balances[current_id] + delta < 0:
                    connection.rollback()
                    return api_error("That account does not have enough money for this expense.", 409)
                cursor.execute("UPDATE finance_accounts SET balance=balance+%s WHERE id=%s", (delta, current_id))

            columns = ", ".join(f"{key}=%s" for key in updates)
            cursor.execute(
                f"UPDATE expenses SET {columns} WHERE id=%s AND user_id=%s",
                list(updates.values()) + [expense_id, g.user["id"]],
            )
        connection.commit()
        return jsonify({"message": "Expense updated."}), 200
    except pymysql.MySQLError:
        connection.rollback()
        return handle_database_error("update expense")
    finally:
        connection.close()


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
@require_auth
def delete_expense(expense_id):
    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT account_id, amount, transaction_type FROM expenses WHERE id=%s AND user_id=%s FOR UPDATE",
                (expense_id, g.user["id"]),
            )
            expense = cursor.fetchone()
            if not expense:
                connection.rollback()
                return api_error("Expense not found.", 404)
            if expense["account_id"]:
                cursor.execute("SELECT balance FROM finance_accounts WHERE id=%s AND user_id=%s FOR UPDATE", (expense["account_id"], g.user["id"]))
                account = cursor.fetchone()
                if not account:
                    connection.rollback()
                    return api_error("Account not found.", 404)
                if expense["transaction_type"] == "income" and Decimal(account["balance"]) < Decimal(expense["amount"]):
                    connection.rollback()
                    return api_error("This income has already been spent and cannot be removed without an account deficit.", 409)
                delta = -Decimal(expense["amount"]) if expense["transaction_type"] == "income" else Decimal(expense["amount"])
                cursor.execute("UPDATE finance_accounts SET balance=balance+%s WHERE id=%s", (delta, expense["account_id"]))
            cursor.execute("DELETE FROM expenses WHERE id=%s AND user_id=%s", (expense_id, g.user["id"]))
        connection.commit()
        return jsonify({"message": "Expense deleted."}), 200
    except pymysql.MySQLError:
        connection.rollback()
        return handle_database_error("delete expense")
    finally:
        connection.close()


# ============================================================
# TASKS CRUD
# ============================================================

@app.route("/api/tasks", methods=["GET"])
@require_auth
def get_tasks():
    try:
        rows = query_db(
            """
            SELECT id, title, description, status, due_date, created_at, updated_at
            FROM tasks WHERE user_id = %s ORDER BY id DESC
            """,
            (g.user["id"],)
        )
        return jsonify({"tasks": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get tasks")


@app.route("/api/tasks", methods=["POST"])
@require_auth
def create_task():
    data = get_data()
    title = clean_string(data.get("title"), 200)
    description = clean_string(data.get("description"), 5000)
    status = clean_string(data.get("status") or "pending", 30).casefold()
    due_date = parse_date(data.get("due_date"), optional=True)

    if not title:
        return api_error("Task title is required.")
    if status not in {"pending", "in_progress", "completed"}:
        return api_error("Invalid task status.")
    if due_date is False:
        return api_error("Use a valid due date in YYYY-MM-DD format.")

    try:
        result = execute_db(
            """
            INSERT INTO tasks (user_id, title, description, status, due_date)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (g.user["id"], title, description, status, due_date)
        )
        return jsonify({
            "message": "Task created.",
            "task_id": result["lastrowid"]
        }), 201
    except pymysql.MySQLError:
        return handle_database_error("create task")


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
@require_auth
def update_task(task_id):
    data = get_data()
    updates = {}

    if "title" in data:
        title = clean_string(data["title"], 200)
        if not title:
            return api_error("Task title cannot be empty.")
        updates["title"] = title

    if "description" in data:
        if not isinstance(data["description"], str):
            return api_error("Description must be text.")
        updates["description"] = data["description"][:5000]

    if "status" in data:
        status = clean_string(data["status"], 30).casefold()
        if status not in {"pending", "in_progress", "completed"}:
            return api_error("Invalid task status.")
        updates["status"] = status

    if "due_date" in data:
        due_date = parse_date(data["due_date"], optional=True)
        if due_date is False:
            return api_error("Use a valid due date in YYYY-MM-DD format.")
        updates["due_date"] = due_date

    if not updates:
        return api_error("Provide fields to update.")

    columns = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [task_id, g.user["id"]]

    try:
        result = execute_db(
            f"UPDATE tasks SET {columns} WHERE id=%s AND user_id=%s",
            params
        )
        if not result["rowcount"]:
            exists = query_db(
                "SELECT id FROM tasks WHERE id=%s AND user_id=%s",
                (task_id, g.user["id"]),
                fetchone=True
            )
            if not exists:
                return api_error("Task not found.", 404)
        return jsonify({"message": "Task updated."}), 200
    except pymysql.MySQLError:
        return handle_database_error("update task")


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@require_auth
def delete_task(task_id):
    try:
        result = execute_db(
            "DELETE FROM tasks WHERE id=%s AND user_id=%s",
            (task_id, g.user["id"])
        )
        if not result["rowcount"]:
            return api_error("Task not found.", 404)
        return jsonify({"message": "Task deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete task")


# ============================================================
# NOTES CRUD
# ============================================================

@app.route("/api/notes", methods=["GET"])
@require_auth
def get_notes():
    try:
        rows = query_db(
            """
            SELECT id, title, content, created_at, updated_at
            FROM notes WHERE user_id=%s ORDER BY updated_at DESC, id DESC
            """,
            (g.user["id"],)
        )
        return jsonify({"notes": rows}), 200
    except pymysql.MySQLError:
        return handle_database_error("get notes")


@app.route("/api/notes", methods=["POST"])
@require_auth
def create_note():
    data = get_data()
    title = clean_string(data.get("title"), 200)
    content = clean_string(data.get("content"), 20000)

    if not title:
        return api_error("Note title is required.")

    try:
        result = execute_db(
            "INSERT INTO notes (user_id, title, content) VALUES (%s, %s, %s)",
            (g.user["id"], title, content)
        )
        return jsonify({
            "message": "Note created.",
            "note_id": result["lastrowid"]
        }), 201
    except pymysql.MySQLError:
        return handle_database_error("create note")


@app.route("/api/notes/<int:note_id>", methods=["PATCH"])
@require_auth
def update_note(note_id):
    data = get_data()
    updates = {}

    if "title" in data:
        title = clean_string(data["title"], 200)
        if not title:
            return api_error("Note title cannot be empty.")
        updates["title"] = title

    if "content" in data:
        if not isinstance(data["content"], str):
            return api_error("Content must be text.")
        updates["content"] = data["content"][:20000]

    if not updates:
        return api_error("Provide a title or content to update.")

    columns = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [note_id, g.user["id"]]

    try:
        result = execute_db(
            f"UPDATE notes SET {columns} WHERE id=%s AND user_id=%s",
            params
        )
        if not result["rowcount"]:
            exists = query_db(
                "SELECT id FROM notes WHERE id=%s AND user_id=%s",
                (note_id, g.user["id"]),
                fetchone=True
            )
            if not exists:
                return api_error("Note not found.", 404)
        return jsonify({"message": "Note updated."}), 200
    except pymysql.MySQLError:
        return handle_database_error("update note")


@app.route("/api/notes/<int:note_id>", methods=["DELETE"])
@require_auth
def delete_note(note_id):
    try:
        result = execute_db(
            "DELETE FROM notes WHERE id=%s AND user_id=%s",
            (note_id, g.user["id"])
        )
        if not result["rowcount"]:
            return api_error("Note not found.", 404)
        return jsonify({"message": "Note deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete note")


# ============================================================
# FAMILY CLOUD FILES
# ============================================================

@app.route("/api/family/invites", methods=["POST"])
@require_auth
def create_family_invite():
    family = get_family_for_user(g.user["id"])
    if not family:
        family_id = ensure_default_family_for_user(g.user["id"])
        family = get_family_for_user(g.user["id"]) if family_id else None
    if not family:
        return api_error("A family workspace is required to create an invite.", 400)
    if family["role"] not in {"owner", "admin"}:
        return api_error("Only a family owner or admin can invite another account.", 403)

    code = secrets.token_hex(16).upper()
    try:
        execute_db(
            """INSERT INTO family_invites (family_id, created_by, code_hash, expires_at)
            VALUES (%s, %s, %s, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY))""",
            (family["id"], g.user["id"], invite_digest(code)),
        )
        return jsonify({"message": "Family invite created.", "code": code, "expires_in_days": 7}), 201
    except pymysql.MySQLError:
        return handle_database_error("create family invite")


@app.route("/api/family/join", methods=["POST"])
@require_auth
def join_family():
    code = clean_string(get_data().get("code"), 64).upper()
    if not code:
        return api_error("Enter a family invite code.")

    connection = get_db_connection()
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT family_id FROM family_invites WHERE code_hash=%s AND expires_at > UTC_TIMESTAMP() FOR UPDATE",
                (invite_digest(code),),
            )
            invite = cursor.fetchone()
            if not invite:
                connection.rollback()
                return api_error("That family invite is invalid or expired.", 404)

            target_family_id = invite["family_id"]
            cursor.execute("SELECT family_id FROM family_members WHERE user_id=%s FOR UPDATE", (g.user["id"],))
            memberships = cursor.fetchall()
            source_family_ids = sorted({row["family_id"] for row in memberships if row["family_id"] != target_family_id})
            cursor.execute(
                "INSERT IGNORE INTO family_members (family_id, user_id, role) VALUES (%s, %s, 'member')",
                (target_family_id, g.user["id"]),
            )

            for source_family_id in source_family_ids:
                cursor.execute("UPDATE family_files SET family_id=%s WHERE family_id=%s", (target_family_id, source_family_id))
                cursor.execute("SELECT user_id, role, joined_at FROM family_members WHERE family_id=%s", (source_family_id,))
                source_members = cursor.fetchall()
                for member in source_members:
                    role = "admin" if member["role"] == "owner" else member["role"]
                    cursor.execute(
                        "INSERT IGNORE INTO family_members (family_id, user_id, role, joined_at) VALUES (%s, %s, %s, %s)",
                        (target_family_id, member["user_id"], role, member["joined_at"]),
                    )
                cursor.execute("DELETE FROM family_members WHERE family_id=%s", (source_family_id,))
                cursor.execute("DELETE FROM families WHERE id=%s", (source_family_id,))

        connection.commit()
        return jsonify({"message": "This account and its family archive are now connected.", "merged_families": len(source_family_ids)}), 200
    except pymysql.MySQLError:
        connection.rollback()
        return handle_database_error("join family")
    finally:
        connection.close()

@app.route("/api/files", methods=["GET"])
@require_auth
def list_family_files():
    family = get_family_for_user(g.user["id"])
    if not family:
        family_id = ensure_default_family_for_user(g.user["id"])
        family = get_family_for_user(g.user["id"]) if family_id else None
    if not family:
        return jsonify({"files": []}), 200

    try:
        rows = query_db(
            """
            SELECT ff.*, u.first_name, u.last_name
            FROM family_files ff
            JOIN users u ON u.id = ff.uploaded_by
            WHERE ff.family_id = %s
            ORDER BY ff.file_date DESC, ff.created_at DESC, ff.id DESC
            """,
            (family["id"],),
        )
        return jsonify({"files": [media_response(row) for row in rows]}), 200
    except pymysql.MySQLError:
        return handle_database_error("list family files")


@app.route("/api/family/members", methods=["GET"])
@require_auth
def list_family_members():
    family = get_family_for_user(g.user["id"])
    if not family:
        family_id = ensure_default_family_for_user(g.user["id"])
        family = get_family_for_user(g.user["id"]) if family_id else None
    if not family:
        return jsonify({"members": []}), 200

    try:
        rows = query_db(
            """
            SELECT u.id, u.first_name, u.last_name, u.username, fm.role, fm.joined_at
            FROM family_members fm
            JOIN users u ON u.id = fm.user_id
            WHERE fm.family_id = %s
            ORDER BY FIELD(fm.role, 'owner', 'admin', 'member'), u.first_name, u.last_name
            """,
            (family["id"],),
        )
        members = [
            {
                "id": row["id"],
                "first_name": row["first_name"],
                "last_name": row["last_name"],
                "username": row["username"],
                "role": row["role"],
                "joined_at": row["joined_at"].isoformat() if row.get("joined_at") else None,
            }
            for row in rows
        ]
        return jsonify({"members": members}), 200
    except pymysql.MySQLError:
        return handle_database_error("list family members")


@app.route("/api/files/upload", methods=["POST"])
@require_auth
def upload_family_file():
    family = get_family_for_user(g.user["id"])
    if not family:
        family_id = ensure_default_family_for_user(g.user["id"])
        family = get_family_for_user(g.user["id"]) if family_id else None
    if not family:
        return api_error("A family workspace is required before uploading files.", 400)

    uploaded = request.files.get("file")
    if not uploaded or uploaded.filename == "":
        return api_error("Select a file to upload.", 400)

    safe_name = secure_filename(uploaded.filename)
    if not safe_name:
        return api_error("The uploaded filename is invalid.", 400)

    category_hint = clean_string(request.form.get("category", ""), 20).lower()
    category = classify_media(safe_name)
    if category_hint in {"photo", "video", "document", "other"}:
        category = category_hint

    if category == "photo" and not safe_name.lower().endswith(tuple(PHOTO_EXTENSIONS)):
        return api_error("Only image files are allowed in the photo category.", 400)

    if category == "video" and not safe_name.lower().endswith(tuple(VIDEO_EXTENSIONS)):
        return api_error("Only video files are allowed in the video category.", 400)

    try:
        if category == "photo":
            file_date = photo_capture_date(uploaded).date()
        else:
            file_date = date.today()

        stored_name = f"{uuid.uuid4().hex}_{safe_name}"
        relative_path, absolute_path = media_paths(family["id"], category, file_date, stored_name)
        absolute_path.parent.mkdir(parents=True, exist_ok=True)
        uploaded.stream.seek(0)
        uploaded.save(absolute_path)
        thumbnail_relative_path = None
        if category == "photo":
            thumbnail_relative_path, thumbnail_absolute_path = thumbnail_path(family["id"], file_date, stored_name)
            create_photo_thumbnail(absolute_path, thumbnail_absolute_path)

        mime_type = uploaded.mimetype or mimetypes.guess_type(safe_name)[0] or "application/octet-stream"
        size_bytes = os.path.getsize(absolute_path)

        result = execute_db(
            """
            INSERT INTO family_files
                (family_id, uploaded_by, original_name, stored_name, category, mime_type, size_bytes, file_path, file_date, thumbnail_path)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (family["id"], g.user["id"], safe_name, stored_name, category, mime_type, size_bytes, relative_path, file_date, thumbnail_relative_path),
        )

        row = query_db(
            """
            SELECT ff.*, u.first_name, u.last_name
            FROM family_files ff
            JOIN users u ON u.id = ff.uploaded_by
            WHERE ff.id = %s
            """,
            (result["lastrowid"],),
            fetchone=True,
        )
        return jsonify({"message": "File uploaded to the family cloud.", "file": media_response(row)}), 201
    except ValueError as error:
        return api_error(str(error), 400)
    except OSError:
        app.logger.exception("File storage failed during upload.")
        return api_error("The server could not save the uploaded file. Check storage path permissions and available disk space.", 500)
    except pymysql.MySQLError:
        return handle_database_error("upload family file")
    except Exception:
        app.logger.exception("Unexpected error while processing file upload.")
        return api_error("The server encountered an unexpected error while processing the upload. Check the API server logs.", 500)


@app.route("/api/files/<int:file_id>", methods=["GET"])
@require_auth
def get_family_file(file_id):
    family = get_family_for_user(g.user["id"])
    if not family:
        return api_error("Family record not found.", 404)

    row = query_db(
        """
        SELECT ff.*, u.first_name, u.last_name
        FROM family_files ff
        JOIN users u ON u.id = ff.uploaded_by
        WHERE ff.id = %s AND ff.family_id = %s
        """,
        (file_id, family["id"]),
        fetchone=True,
    )
    if not row:
        return api_error("File not found.", 404)
    return jsonify({"file": media_response(row)}), 200


@app.route("/api/files/<int:file_id>/download", methods=["GET"])
@require_auth
def download_family_file(file_id):
    family = get_family_for_user(g.user["id"])
    if not family:
        return api_error("Family record not found.", 404)

    row = query_db(
        "SELECT * FROM family_files WHERE id = %s AND family_id = %s",
        (file_id, family["id"]),
        fetchone=True,
    )
    if not row:
        return api_error("File not found.", 404)

    absolute_path = resolve_media_path(row["file_path"])
    if not absolute_path:
        return api_error("The file is no longer available on disk.", 404)

    return send_file(absolute_path, as_attachment=True, download_name=row["original_name"], mimetype=row["mime_type"] or mimetypes.guess_type(row["original_name"])[0])


@app.route("/api/files/<int:file_id>", methods=["DELETE"])
@require_auth
def delete_family_file(file_id):
    family = get_family_for_user(g.user["id"])
    if not family:
        return api_error("Family record not found.", 404)

    row = query_db(
        "SELECT * FROM family_files WHERE id = %s AND family_id = %s",
        (file_id, family["id"]),
        fetchone=True,
    )
    if not row:
        return api_error("File not found.", 404)

    try:
        absolute_path = resolve_media_path(row["file_path"])
        if absolute_path:
            absolute_path.unlink()

        if row.get("thumbnail_path"):
            stored_thumbnail = resolve_media_path(row["thumbnail_path"])
            if stored_thumbnail:
                stored_thumbnail.unlink()

        execute_db(
            "DELETE FROM family_files WHERE id = %s AND family_id = %s",
            (file_id, family["id"]),
        )
        return jsonify({"message": "File deleted from the family cloud."}), 200
    except OSError:
        return api_error("The file could not be removed from storage.", 500)
    except pymysql.MySQLError:
        return handle_database_error("delete family file")


@app.route("/api/files/<int:file_id>/thumbnail", methods=["GET"])
@require_auth
def family_file_thumbnail(file_id):
    family = get_family_for_user(g.user["id"])
    if not family:
        return api_error("Family record not found.", 404)

    row = query_db(
        "SELECT * FROM family_files WHERE id = %s AND family_id = %s",
        (file_id, family["id"]),
        fetchone=True,
    )
    if not row:
        return api_error("File not found.", 404)

    if row.get("thumbnail_path"):
        absolute_path = resolve_media_path(row["thumbnail_path"])
        if absolute_path:
            return send_file(absolute_path, mimetype="image/jpeg", conditional=True)

    absolute_path = resolve_media_path(row["file_path"])
    if not absolute_path or row["category"] != "photo":
        return api_error("No thumbnail available.", 404)
    return send_file(absolute_path, mimetype=row.get("mime_type") or "image/jpeg", conditional=True)


# ============================================================
# DASHBOARD STATISTICS
# ============================================================

@app.route("/api/dashboard/stats", methods=["GET"])
@require_auth
def dashboard_stats():
    user_id = g.user["id"]

    try:
        projects = query_db(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(status = 'completed'), 0) AS completed
            FROM projects WHERE user_id=%s
            """,
            (user_id,), fetchone=True
        )

        tasks = query_db(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(status = 'completed'), 0) AS completed,
                   COALESCE(SUM(status = 'pending'), 0) AS pending
            FROM tasks WHERE user_id=%s
            """,
            (user_id,), fetchone=True
        )

        expenses = query_db(
            """
            SELECT COUNT(*) AS total,
                   COALESCE(SUM(amount), 0) AS total_amount
            FROM expenses WHERE user_id=%s AND transaction_type='expense'
            """,
            (user_id,), fetchone=True
        )

        notes = query_db(
            "SELECT COUNT(*) AS total FROM notes WHERE user_id=%s",
            (user_id,), fetchone=True
        )

        return jsonify({
            "projects": projects,
            "tasks": tasks,
            "expenses": expenses,
            "notes": notes
        }), 200

    except pymysql.MySQLError:
        return handle_database_error("dashboard statistics")


# ============================================================
# ERROR HANDLERS
# ============================================================

@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Endpoint not found."}), 404


@app.errorhandler(405)
def method_not_allowed(error):
    return jsonify({"error": "Method not allowed."}), 405


@app.errorhandler(413)
def payload_too_large(error):
    return jsonify({"error": "Request body is too large."}), 413


# ============================================================
# DEVELOPMENT SERVER
# ============================================================

# if __name__ == "__main__":
#     app.run(host="127.0.0.1", port=5000, debug=True)
