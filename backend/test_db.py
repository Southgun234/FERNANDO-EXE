
import os
from pathlib import Path

import pymysql
from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent / ".env"
print("Found .env:", env_path.is_file())

load_dotenv(dotenv_path=env_path)

try:
    connection = pymysql.connect(
        host=os.getenv("DB_HOST"),
        port=int(os.getenv("DB_PORT", "3306")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database=os.getenv("DB_NAME"),
        connect_timeout=10,
        charset="utf8mb4",
    )

    with connection.cursor() as cursor:
        cursor.execute("SELECT DATABASE()")
        print("Connected database:", cursor.fetchone()[0])

        cursor.execute("SHOW TABLES")
        tables = cursor.fetchall()
        print("Tables found:", len(tables))

        for table in tables:
            print("-", table[0])

    connection.close()
    print("\nSUCCESS: MySQL connection works!")

except Exception as error:
    print("\nCONNECTION FAILED:", type(error).__name__, "-", error)
