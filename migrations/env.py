"""
Alembic environment — ผูกเข้ากับ config/model ของแอปแทนการตั้งค่าใน alembic.ini

- URL ของฐานข้อมูลอ่านจาก settings.database_url (.env) ที่เดียว ไม่ต้องกรอกซ้ำใน alembic.ini
  เพื่อไม่ให้ dev/Pi ชี้ผิดไฟล์กัน และไม่ต้องเอา path จริงเข้า git
- render_as_batch=True จำเป็นสำหรับ SQLite เพราะ SQLite ไม่รองรับ ALTER COLUMN/DROP COLUMN ตรงๆ
  Alembic จะสร้างตารางใหม่ + copy ข้อมูล + rename ให้เอง (batch mode)
"""
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

from app.config import settings
from app.database import Base

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ให้ autogenerate เทียบ model ทั้งหมดใน app/database.py กับ schema จริงใน DB
target_metadata = Base.metadata

# override ค่า placeholder ใน alembic.ini ด้วยค่าจริงจาก .env
config.set_main_option("sqlalchemy.url", settings.database_url)


def run_migrations_offline() -> None:
    """สร้าง SQL script ออกมาโดยไม่ต่อ DB จริง (alembic upgrade head --sql)"""
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        # ── ปิด foreign key ระหว่างรัน migration (เฉพาะ SQLite) ────────────────
        # SQLite เปลี่ยนโครงตาราง (เช่น ผ่อน NOT NULL) ตรงๆ ไม่ได้ alembic จึงใช้วิธี
        # "สร้างตารางใหม่ → ก็อปข้อมูล → ลบตารางเก่า" (batch mode) แต่ database.py
        # เปิด PRAGMA foreign_keys=ON ไว้ทุก connection ตอนลบตารางเก่าจึงติด FK
        # ของตารางอื่นที่ชี้มาหา แล้ว migration ล้มทั้งก้อน
        #
        # ต้องสั่งก่อนเปิด transaction เพราะ PRAGMA นี้ไม่มีผลถ้าอยู่ใน transaction แล้ว
        # ปลอดภัยเพราะ migration เป็นการเปลี่ยนโครงสร้าง ไม่ใช่การแก้ข้อมูลที่ต้องพึ่ง FK
        # และ connection นี้ใช้เฉพาะตอน migrate แล้วปิดทิ้ง ไม่กระทบ connection ของแอป
        # ⚠️ ต้องสั่งผ่าน driver ตรงๆ ไม่ใช่ connection.exec_driver_sql()
        # เพราะการสั่งผ่าน SQLAlchemy จะเปิด transaction ค้างไว้ตั้งแต่คำสั่งแรก
        # แล้วตอนจบบล็อกนี้มันถูก rollback ทิ้ง — ผลคือ migration "รันผ่าน" ไม่มี error
        # แต่ schema ไม่เปลี่ยนอะไรเลยและเลขเวอร์ชันไม่ขยับ (หลอกมาก ใช้เวลาหาอยู่นาน)
        if connection.dialect.name == "sqlite":
            connection.connection.dbapi_connection.execute("PRAGMA foreign_keys=OFF")

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
