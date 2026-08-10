"""
API Key Service — จัดการ key ประจำอุปกรณ์ที่ยิง POST /notify เข้ามา

1 key = 1 อุปกรณ์ (ดู docstring ของ ApiKey ใน database.py ว่าทำไม)
key ถูกฝังใน firmware ครั้งเดียวแล้วไม่เปลี่ยนอีก ดังนั้นสิ่งที่เปลี่ยนได้ทั้งหมด
(ชื่ออุปกรณ์, event type ที่ยิงได้) ต้องอยู่ฝั่ง DB เพื่อไม่ให้ต้องเอาบอร์ดกลับมาแฟลชใหม่

เก็บเฉพาะ sha256 hash ในฐานข้อมูล — plaintext คืนให้ผู้ใช้เห็นแค่ตอนสร้างครั้งเดียวเท่านั้น
"""
import datetime
import hashlib
import secrets

from sqlalchemy.orm import Session

from app.database import ApiKey, EventType

_KEY_PREFIX = "gw_live_"


def _hash_key(plaintext: str) -> str:
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def generate_key() -> tuple[str, str, str]:
    """คืน (plaintext, prefix_สำหรับแสดงผล, hash_สำหรับเก็บ DB)"""
    token = secrets.token_urlsafe(32)
    plaintext = f"{_KEY_PREFIX}{token}"
    display_prefix = plaintext[: len(_KEY_PREFIX) + 6]
    return plaintext, display_prefix, _hash_key(plaintext)


class UnknownEventTypeError(Exception):
    """อ้างถึง event type id ที่ไม่มีอยู่จริง"""


def _resolve_event_types(db: Session, event_type_ids: list[int]) -> list[EventType]:
    if not event_type_ids:
        return []
    found = db.query(EventType).filter(EventType.id.in_(event_type_ids)).all()
    missing = set(event_type_ids) - {e.id for e in found}
    if missing:
        raise UnknownEventTypeError(f"ไม่พบ event type id: {sorted(missing)}")
    return found


def create_api_key(db: Session, name: str, event_type_ids: list[int] | None = None) -> tuple[ApiKey, str]:
    """name = ชื่ออุปกรณ์ (เช่น 'โหนดตึก A ชั้น 3'), event_type_ids = รายการที่อุปกรณ์นี้ยิงได้"""
    plaintext, prefix, key_hash = generate_key()
    api_key = ApiKey(name=name, key_prefix=prefix, key_hash=key_hash)
    api_key.allowed_event_types = _resolve_event_types(db, event_type_ids or [])
    db.add(api_key)
    db.commit()
    db.refresh(api_key)
    return api_key, plaintext


def update_api_key(
    db: Session,
    key_id: int,
    name: str | None = None,
    event_type_ids: list[int] | None = None,
) -> ApiKey | None:
    """
    แก้ชื่ออุปกรณ์ / รายการ event type ที่ยิงได้ — โดยที่ key ตัวเดิมยังใช้งานได้เหมือนเดิม

    นี่คือหัวใจของการ "ไม่ต้องแฟลชบอร์ดใหม่": ย้ายบอร์ดไปตึกอื่น เปลี่ยนชื่อ
    หรือเพิ่ม/ถอนสิทธิ์การแจ้งเตือน ทำที่นี่ที่เดียว firmware ไม่ต้องรู้เรื่องด้วย
    """
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if api_key is None:
        return None
    if name is not None:
        api_key.name = name
    if event_type_ids is not None:
        api_key.allowed_event_types = _resolve_event_types(db, event_type_ids)
    db.commit()
    db.refresh(api_key)
    return api_key


def list_api_keys(db: Session) -> list[ApiKey]:
    return db.query(ApiKey).order_by(ApiKey.created_at.desc()).all()


def delete_api_key(db: Session, key_id: int) -> bool:
    """
    ลบอุปกรณ์ออกจากฐานข้อมูลจริง (hard delete) ไม่ใช่แค่ปิดการใช้งาน

    ปลอดภัยเพราะ FK ถูกออกแบบไว้รองรับแล้ว (ดู app/database.py) และ PRAGMA foreign_keys=ON
    เปิดไว้ทุก connection แล้ว SQLite จึงบังคับใช้จริง:
      - api_key_event_types  ON DELETE CASCADE  → สิทธิ์ที่ผูกไว้หายตามไปเอง
      - call_jobs.api_key_id ON DELETE SET NULL → ประวัติการโทรไม่หาย แค่ตัดสายโยงไปหาอุปกรณ์

    ประวัติยังอ่านรู้เรื่องหลังลบ เพราะ call_jobs.source_device เก็บ "ชื่ออุปกรณ์ ณ ตอนนั้น"
    ไว้เป็น snapshot อยู่แล้ว ไม่ได้ join เอาชื่อจากตาราง api_keys ตอนแสดงผล
    """
    api_key = db.query(ApiKey).filter(ApiKey.id == key_id).first()
    if api_key is None:
        return False
    db.delete(api_key)
    db.commit()
    return True


def verify_and_touch(db: Session, plaintext: str) -> ApiKey | None:
    """
    ตรวจ key ที่ส่งมาใน request กับ hash ใน DB ถ้าถูกต้องและยัง active อัปเดต last_used_at
    แล้วคืน ApiKey กลับไป (None = ไม่ผ่าน)

    ต้องคืนตัว ApiKey ไม่ใช่แค่ True/False เพราะ /notify ต้องใช้ต่อ 2 อย่าง:
    เช็คว่า event type ที่ขอมาอยู่ในสิทธิ์ของอุปกรณ์นี้ไหม และเอาชื่ออุปกรณ์ไปเติมในข้อความ
    """
    key_hash = _hash_key(plaintext)
    api_key = (
        db.query(ApiKey)
        .filter(ApiKey.key_hash == key_hash, ApiKey.is_active == "true")
        .first()
    )
    if api_key is None:
        return None
    api_key.last_used_at = datetime.datetime.utcnow()
    db.commit()
    return api_key
