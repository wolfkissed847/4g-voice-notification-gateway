"""
Migration ข้อมูล (ไม่ใช่ schema) ครั้งเดียว — ย้าย escalation contacts จาก .env (JSON string)
เข้าตาราง Group/Contact/EventType แล้วเติม event_type_id ให้ job เก่าที่ค้างอยู่

ขอบเขตของ script นี้คือ "ย้ายข้อมูล" เท่านั้น — ส่วน schema (สร้าง/เพิ่มคอลัมน์/index)
เป็นหน้าที่ของ Alembic ที่ migrations/ ทางเดียว ห้ามเพิ่ม ALTER TABLE ในไฟล์นี้อีก
init_db() ที่ถูกเรียกด้านล่างคือ `alembic upgrade head` ซึ่งจัดการ schema ให้ครบแล้ว

ถ้าเป็นการติดตั้งใหม่ (ไม่มี gateway.db เดิม) ไม่ต้องรัน script นี้เลย

รัน (จาก root ของ repo): python scripts/migrate_schema.py
"""
import json
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import text

from app.config import settings
from app.database import Contact, EventType, Group, SessionLocal, engine, init_db

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("migrate_schema")

# ชื่อ group ใน .env -> ชื่อที่จะแสดงในตาราง groups + event type เริ่มต้นให้กลุ่มนั้น
LEGACY_GROUPS = {
    "network_team": ("ทีมเครือข่าย", "network_team_contacts"),
    "power_team": ("ทีมไฟฟ้า", "power_team_contacts"),
}


def _backfill_groups_and_event_types():
    db = SessionLocal()
    try:
        for group_key, (display_name, env_field) in LEGACY_GROUPS.items():
            raw = getattr(settings, env_field, "[]")
            try:
                numbers = json.loads(raw)
            except json.JSONDecodeError:
                numbers = []

            group = db.query(Group).filter(Group.name == display_name).first()
            if group is None:
                group = Group(name=display_name, description=f"ย้ายมาจาก .env ({group_key})")
                db.add(group)
                db.flush()
                logger.info("สร้างกลุ่มใหม่: %s", display_name)

            existing_numbers = {c.phone_number for c in group.contacts}
            for index, number in enumerate(numbers):
                if number in existing_numbers:
                    continue
                db.add(Contact(group_id=group.id, phone_number=number, order_index=index))
                logger.info("เพิ่มเบอร์ %s เข้ากลุ่ม %s", number, display_name)

            event_type = db.query(EventType).filter(EventType.code == group_key).first()
            if event_type is None:
                db.add(EventType(
                    code=group_key,
                    display_name=display_name,
                    message_template="{message}",
                    group_id=group.id,
                ))
                logger.info("สร้าง event type เริ่มต้น: %s -> %s", group_key, display_name)

        db.commit()
    finally:
        db.close()


def _backfill_call_job_event_type_ids():
    """เติม event_type_id ให้ job เก่าที่ priority_group ตรงกับ event type code ที่เพิ่งสร้าง"""
    with engine.begin() as conn:
        rows = conn.execute(text(
            "SELECT id, code FROM event_types"
        )).fetchall()
        for event_type_id, code in rows:
            conn.execute(
                text(
                    "UPDATE call_jobs SET event_type_id = :etid "
                    "WHERE priority_group = :code AND event_type_id IS NULL"
                ),
                {"etid": event_type_id, "code": code},
            )
    logger.info("เติม event_type_id ให้ call_jobs เก่าที่จับคู่ได้เรียบร้อย")


def main():
    logger.info("เริ่ม migration...")
    init_db()  # = alembic upgrade head (schema ทั้งหมดจัดการที่ migrations/ ที่เดียว)
    _backfill_groups_and_event_types()
    _backfill_call_job_event_type_ids()
    logger.info("Migration เสร็จสมบูรณ์")


if __name__ == "__main__":
    main()
