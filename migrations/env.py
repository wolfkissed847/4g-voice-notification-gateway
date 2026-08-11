"""
Alembic environment — ผูกเข้ากับ config/model ของแอปแทนการตั้งค่าใน alembic.ini

- URL ของฐานข้อมูลอ่านจาก settings.database_url (.env) ที่เดียว ไม่ต้องกรอกซ้ำใน alembic.ini
  เพื่อไม่ให้ dev/Pi ชี้ผิดไฟล์กัน และไม่ต้องเอา path จริงเข้า git
- render_as_batch=True จำเป็นสำหรับ SQLite เพราะ SQLite ไม่รองรับ ALTER COLUMN/DROP COLUMN ตรงๆ
  Alembic จะสร้างตารางใหม่ + copy ข้อมูล + rename ให้เอง (batch mode)
"""
import logging
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


def _drop_leftover_batch_tables(connection) -> None:
    """
    ลบตารางชั่วคราวที่ค้างจาก batch migration รอบก่อนที่ล้มกลางคัน

    ── ทำไมต้องมี ────────────────────────────────────────────────────────────
    batch mode ของ Alembic เปลี่ยนโครงตาราง SQLite ด้วยการสร้างตารางชื่อ `_alembic_tmp_<ชื่อ>`
    ขึ้นมาก่อน แล้วค่อยก็อปข้อมูลและ rename ทับ ถ้าจังหวะนั้นล้ม (ไฟดับ, container ถูกฆ่า,
    คำสั่งใด SQL พัง) ตารางชั่วคราวจะค้างอยู่ในไฟล์ฐานข้อมูล

    ผลคือ migration รอบถัดไป**ทุกรอบ**จะล้มด้วย "table _alembic_tmp_xxx already exists"
    และเนื่องจาก init_db() ถูกเรียกตอนแอปสตาร์ต แอปจะสตาร์ตไม่ขึ้นเลยแม้แต่ครั้งเดียว
    กลายเป็น container วนรีสตาร์ตไม่จบ ทั้งที่ข้อมูลจริงยังอยู่ครบ — เคยเกิดกับโปรเจกต์นี้มาแล้ว
    และเป็นอาการที่หาสาเหตุยากมากเพราะข้อความ error ไม่ได้บอกว่าให้ไปลบอะไร

    ปลอดภัยที่จะลบทิ้งเสมอ: ตารางพวกนี้เป็นของชั่วคราวล้วนๆ ที่ Alembic สร้างเองแล้วตั้งใจ
    จะลบเองอยู่แล้ว ถ้ามันยังอยู่ตอน "เริ่ม" รอบใหม่ แปลว่าเป็นเศษจากรอบที่ตายไปแล้วแน่นอน
    ข้อมูลจริงอยู่ในตารางชื่อจริงเสมอ ไม่เคยอยู่ในตารางชื่อนี้เมื่อไม่มี migration กำลังรันอยู่
    """
    # ⚠️ ต้องสั่งผ่าน driver ตรงๆ ด้วยเหตุผลเดียวกับ PRAGMA ข้างบน
    # ถ้าสั่งผ่าน connection.execute() ของ SQLAlchemy มันจะเปิด transaction ค้างไว้ตั้งแต่
    # คำสั่งแรก แล้วตอนจบบล็อกจะถูก rollback ทิ้งพร้อมกับ migration ทั้งหมดที่รันตามมา
    # ผลคือ "รันผ่านไม่มี error แต่ schema ไม่เปลี่ยนและเลขเวอร์ชันไม่ขยับ"
    # (ผมพลาดตรงนี้มาแล้วตอนเขียนฟังก์ชันนี้ครั้งแรก — อาการคือ migration ตัวแรกถูกรันซ้ำ
    #  แล้วล้มด้วย "table api_keys already exists" ซึ่งอ่านแล้วไม่มีทางเดาสาเหตุถูกเลย)
    raw = connection.connection.dbapi_connection
    leftovers = [
        row[0]
        for row in raw.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '_alembic_tmp_%'"
        ).fetchall()
    ]
    for name in leftovers:
        logging.getLogger("alembic.env").warning(
            "พบตารางค้างจาก migration รอบก่อนที่ล้มกลางคัน: %s — ลบทิ้งก่อนเริ่มรอบใหม่", name
        )
        raw.execute(f'DROP TABLE "{name}"')
    if leftovers:
        raw.commit()


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
            _drop_leftover_batch_tables(connection)

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
