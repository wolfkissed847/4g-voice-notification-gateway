"""
Secrets Crypto — encrypt/decrypt ค่าความลับที่ user กรอกผ่าน dashboard (เช่น Zadarma password)
ก่อนเก็บลง DB เพราะ config พวกนี้ไม่ได้อยู่ใน .env แล้ว (user แก้ผ่านหน้าเว็บได้)

ใช้ Fernet (symmetric encryption) — key เดียวเก็บใน .env (ENCRYPTION_KEY) เท่านั้น
ห้าม commit ENCRYPTION_KEY จริงเด็ดขาด ถ้า key หาย = decrypt ค่าที่เก็บไว้ไม่ได้ ต้องกรอกใหม่ทั้งหมด
สร้าง key ด้วย: python scripts/generate_encryption_key.py
"""
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


def _get_fernet() -> Fernet:
    if not settings.encryption_key:
        raise RuntimeError(
            "ยังไม่ได้ตั้งค่า ENCRYPTION_KEY ใน .env — รัน `python scripts/generate_encryption_key.py` "
            "แล้วนำค่าไปใส่ก่อนใช้งานฟีเจอร์ config ผ่าน dashboard"
        )
    return Fernet(settings.encryption_key.encode("utf-8"))


def encrypt_value(plain_text: str) -> str:
    """คืนค่า empty string ถ้า input เป็น empty (ไม่ encrypt ค่าว่าง เพื่อให้เช็ค 'ยังไม่ได้ตั้งค่า' ง่าย)"""
    if not plain_text:
        return ""
    return _get_fernet().encrypt(plain_text.encode("utf-8")).decode("utf-8")


def decrypt_value(encrypted_text: str) -> str:
    if not encrypted_text:
        return ""
    try:
        return _get_fernet().decrypt(encrypted_text.encode("utf-8")).decode("utf-8")
    except InvalidToken:
        # เช่น ENCRYPTION_KEY ถูกเปลี่ยนหลัง encrypt ไปแล้ว
        return ""


def mask_secret(plain_text: str, visible_chars: int = 4) -> str:
    """ใช้แสดงผลใน dashboard เช่น '••••••7890' ไม่โชว์ค่าเต็มกลับไปที่ frontend"""
    if not plain_text:
        return ""
    if len(plain_text) <= visible_chars:
        return "•" * len(plain_text)
    return "•" * (len(plain_text) - visible_chars) + plain_text[-visible_chars:]
