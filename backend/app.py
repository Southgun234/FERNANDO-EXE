
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

frontend_origin = os.getenv("FRONTEND_ORIGIN", "http://localhost:5173")
CORS(app, resources={r"/api/*": {"origins": [frontend_origin]}})

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
    )

    try:
        for statement in required:
            execute_db(statement)
    except pymysql.MySQLError:
        app.logger.exception("Family cloud tables could not be created.")
        raise


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
                SELECT id, first_name, last_name, username, email, phone
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

    if not all([first_name, last_name, username, email, password, phone]):
        return api_error("All fields are required.")

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
                (first_name, last_name, username, password, email, phone)
            VALUES (%s, %s, %s, %s, %s, %s)
            """,
            (first_name, last_name, username, password_hash, email, phone)
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
            SELECT id, first_name, last_name, username, email, phone
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

    if not first_name or not last_name:
        return api_error("First name and last name are required.")

    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        return api_error("Enter a valid email address.")

    try:
        execute_db(
            """
            UPDATE users
            SET first_name = %s, last_name = %s, email = %s
            WHERE id = %s
            """,
            (first_name, last_name, email, g.user["id"])
        )
        user = query_db(
            """
            SELECT id, first_name, last_name, username, email, phone
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
# EXPENSES CRUD
# ============================================================

@app.route("/api/expenses", methods=["GET"])
@require_auth
def get_expenses():
    try:
        rows = query_db(
            """
            SELECT id, title, amount, category, expense_date, created_at
            FROM expenses WHERE user_id = %s
            ORDER BY expense_date DESC, id DESC
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

    if not title or not category or amount is None:
        return api_error("Title, category and a valid non-negative amount are required.")
    if expense_date is False:
        return api_error("Use a valid date in YYYY-MM-DD format.")

    try:
        result = execute_db(
            """
            INSERT INTO expenses (user_id, title, amount, category, expense_date)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (g.user["id"], title, amount, category, expense_date or date.today())
        )
        return jsonify({
            "message": "Expense recorded.",
            "expense_id": result["lastrowid"]
        }), 201
    except pymysql.MySQLError:
        return handle_database_error("create expense")


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

    if not updates:
        return api_error("Provide fields to update.")

    columns = ", ".join(f"{key} = %s" for key in updates)
    params = list(updates.values()) + [expense_id, g.user["id"]]

    try:
        result = execute_db(
            f"UPDATE expenses SET {columns} WHERE id=%s AND user_id=%s",
            params
        )
        if not result["rowcount"]:
            exists = query_db(
                "SELECT id FROM expenses WHERE id=%s AND user_id=%s",
                (expense_id, g.user["id"]),
                fetchone=True
            )
            if not exists:
                return api_error("Expense not found.", 404)
        return jsonify({"message": "Expense updated."}), 200
    except pymysql.MySQLError:
        return handle_database_error("update expense")


@app.route("/api/expenses/<int:expense_id>", methods=["DELETE"])
@require_auth
def delete_expense(expense_id):
    try:
        result = execute_db(
            "DELETE FROM expenses WHERE id=%s AND user_id=%s",
            (expense_id, g.user["id"])
        )
        if not result["rowcount"]:
            return api_error("Expense not found.", 404)
        return jsonify({"message": "Expense deleted."}), 200
    except pymysql.MySQLError:
        return handle_database_error("delete expense")


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
            FROM expenses WHERE user_id=%s
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
