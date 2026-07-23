"""
Config Service — จุดเดียวที่คุยกับตาราง AppSettings (config ที่แก้ผ่าน dashboard)
call_worker ต้องดึงค่าจากที่นี่ ไม่ใช่จาก app.config.settings โดยตรง
(settings ใน .env เป็นแค่ default ตอน first-run เท่านั้น)

เวอร์ชันนี้ตัด backend selector/VoIP credential ออก (ดู branch feature/voip-multi-sim)
เหลือแค่ retry/timeout/SMS fallback ที่ user ปรับผ่าน dashboard ได้
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.database import AppSettings


@dataclass
class EffectiveConfig:
    call_retry_count: int
    call_retry_delay_seconds: int
    call_ring_timeout_seconds: int
    sms_fallback_enabled: bool


def get_or_create_app_settings(db: Session) -> AppSettings:
    """โหลด config แถวเดียว (singleton) ถ้ายังไม่มีให้สร้างจากค่า default ใน .env"""
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if row is not None:
        return row

    row = AppSettings(
        id=1,
        call_retry_count=settings.call_retry_count,
        call_retry_delay_seconds=settings.call_retry_delay_seconds,
        call_ring_timeout_seconds=settings.call_ring_timeout_seconds,
        sms_fallback_enabled=str(settings.sms_fallback_enabled).lower(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_effective_config(db: Session) -> EffectiveConfig:
    """ค่า config พร้อมให้ call_worker ใช้งานจริง"""
    row = get_or_create_app_settings(db)
    return EffectiveConfig(
        call_retry_count=row.call_retry_count,
        call_retry_delay_seconds=row.call_retry_delay_seconds,
        call_ring_timeout_seconds=row.call_ring_timeout_seconds,
        sms_fallback_enabled=row.sms_fallback_enabled.lower() == "true",
    )


def get_masked_config(db: Session) -> dict:
    """ค่า config สำหรับส่งกลับ dashboard"""
    row = get_or_create_app_settings(db)
    return {
        "call_retry_count": row.call_retry_count,
        "call_retry_delay_seconds": row.call_retry_delay_seconds,
        "call_ring_timeout_seconds": row.call_ring_timeout_seconds,
        "sms_fallback_enabled": row.sms_fallback_enabled.lower() == "true",
    }


def update_app_settings(db: Session, **fields) -> AppSettings:
    """อัปเดต config จาก dashboard — ส่งเฉพาะ field ที่ต้องการเปลี่ยน"""
    row = get_or_create_app_settings(db)

    direct_fields = {
        "call_retry_count", "call_retry_delay_seconds", "call_ring_timeout_seconds",
    }

    for key, value in fields.items():
        if value is None:
            continue
        if key == "sms_fallback_enabled":
            row.sms_fallback_enabled = str(bool(value)).lower()
        elif key in direct_fields:
            setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return row
