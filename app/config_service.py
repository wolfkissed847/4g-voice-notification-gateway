"""
Config Service — จุดเดียวที่คุยกับตาราง AppSettings (config ที่แก้ผ่าน dashboard)
call_backends และ call_worker ต้องดึงค่าจากที่นี่ ไม่ใช่จาก app.config.settings โดยตรง
(settings ใน .env เป็นแค่ default ตอน first-run เท่านั้น)
"""
from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.config import settings
from app.database import AppSettings
from app.secrets_crypto import decrypt_value, encrypt_value, mask_secret


@dataclass
class EffectiveConfig:
    """ค่า config ที่ decrypt แล้ว พร้อมใช้งานจริงใน backend — ห้าม log/ส่งกลับ client ตรงๆ"""
    call_backend: str
    call_retry_count: int
    call_retry_delay_seconds: int
    call_ring_timeout_seconds: int
    sms_fallback_enabled: bool
    ami_host: str
    ami_port: int
    ami_username: str
    ami_secret: str
    zadarma_trunk_name: str
    zadarma_sip_username: str
    zadarma_sip_password: str
    voip_dial_context: str
    voip_callerid: str


def get_or_create_app_settings(db: Session) -> AppSettings:
    """โหลด config แถวเดียว (singleton) ถ้ายังไม่มีให้สร้างจากค่า default ใน .env"""
    row = db.query(AppSettings).filter(AppSettings.id == 1).first()
    if row is not None:
        return row

    row = AppSettings(
        id=1,
        call_backend=settings.call_backend,
        call_retry_count=settings.call_retry_count,
        call_retry_delay_seconds=settings.call_retry_delay_seconds,
        call_ring_timeout_seconds=settings.call_ring_timeout_seconds,
        sms_fallback_enabled=str(settings.sms_fallback_enabled).lower(),
        ami_host=settings.ami_host,
        ami_port=settings.ami_port,
        ami_username_enc=encrypt_value(settings.ami_username) if settings.encryption_key else "",
        ami_secret_enc=encrypt_value(settings.ami_secret) if settings.encryption_key else "",
        zadarma_trunk_name=settings.zadarma_trunk_name,
        voip_dial_context=settings.voip_dial_context,
        voip_callerid=settings.voip_callerid,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def get_effective_config(db: Session) -> EffectiveConfig:
    """ค่า config ที่ decrypt แล้ว พร้อมให้ call_backends/call_worker ใช้งานจริง"""
    row = get_or_create_app_settings(db)
    return EffectiveConfig(
        call_backend=row.call_backend,
        call_retry_count=row.call_retry_count,
        call_retry_delay_seconds=row.call_retry_delay_seconds,
        call_ring_timeout_seconds=row.call_ring_timeout_seconds,
        sms_fallback_enabled=row.sms_fallback_enabled.lower() == "true",
        ami_host=row.ami_host,
        ami_port=row.ami_port,
        ami_username=decrypt_value(row.ami_username_enc),
        ami_secret=decrypt_value(row.ami_secret_enc),
        zadarma_trunk_name=row.zadarma_trunk_name,
        zadarma_sip_username=decrypt_value(row.zadarma_sip_username_enc),
        zadarma_sip_password=decrypt_value(row.zadarma_sip_password_enc),
        voip_dial_context=row.voip_dial_context,
        voip_callerid=row.voip_callerid,
    )


def get_masked_config(db: Session) -> dict:
    """ค่า config สำหรับส่งกลับ dashboard — secret ถูก mask ไว้ ไม่ส่งค่าเต็มออกไป"""
    row = get_or_create_app_settings(db)
    return {
        "call_backend": row.call_backend,
        "call_retry_count": row.call_retry_count,
        "call_retry_delay_seconds": row.call_retry_delay_seconds,
        "call_ring_timeout_seconds": row.call_ring_timeout_seconds,
        "sms_fallback_enabled": row.sms_fallback_enabled.lower() == "true",
        "ami_host": row.ami_host,
        "ami_port": row.ami_port,
        "ami_username_masked": mask_secret(decrypt_value(row.ami_username_enc)),
        "ami_secret_set": bool(row.ami_secret_enc),
        "zadarma_trunk_name": row.zadarma_trunk_name,
        "zadarma_sip_username_masked": mask_secret(decrypt_value(row.zadarma_sip_username_enc)),
        "zadarma_sip_password_set": bool(row.zadarma_sip_password_enc),
        "voip_dial_context": row.voip_dial_context,
        "voip_callerid": row.voip_callerid,
    }


def update_app_settings(db: Session, **fields) -> AppSettings:
    """
    อัปเดต config จาก dashboard
    field ที่ลงท้าย _plain (เช่น ami_username_plain) จะถูก encrypt ก่อนเก็บอัตโนมัติ
    ส่งเป็น None หรือไม่ส่ง field นั้นมา = ไม่แก้ค่าเดิม (เช่น ไม่ต้องพิมพ์ password ซ้ำทุกครั้งที่แก้อย่างอื่น)
    """
    row = get_or_create_app_settings(db)

    secret_field_map = {
        "ami_username_plain": "ami_username_enc",
        "ami_secret_plain": "ami_secret_enc",
        "zadarma_sip_username_plain": "zadarma_sip_username_enc",
        "zadarma_sip_password_plain": "zadarma_sip_password_enc",
    }
    plain_fields = set(secret_field_map.keys())
    direct_fields = {
        "call_backend", "call_retry_count", "call_retry_delay_seconds",
        "call_ring_timeout_seconds", "zadarma_trunk_name", "ami_host", "ami_port",
        "voip_dial_context", "voip_callerid",
    }

    for key, value in fields.items():
        if value is None:
            continue
        if key in plain_fields:
            setattr(row, secret_field_map[key], encrypt_value(value))
        elif key == "sms_fallback_enabled":
            row.sms_fallback_enabled = str(bool(value)).lower()
        elif key in direct_fields:
            setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return row
