"""
เข้ารหัสค่าลับที่ต้องเอากลับมาอ่านทีหลังได้ (ต่างจากรหัสผ่านที่ hash ทางเดียวพอ)

ตอนนี้ใช้กับ API key ของอุปกรณ์อย่างเดียว — ระบบต้องโชว์ key เต็มซ้ำได้เรื่อยๆ เพราะ
ผู้ใช้ไม่อยากถอดบอร์ดมาแฟลชโค้ดใหม่ทุกครั้งที่ลืม key

── ทำไมไม่เก็บเป็น plaintext ตรงๆ ────────────────────────────────────────────
ไฟล์ฐานข้อมูลคือของที่ "หลุดออกนอกเครื่อง" ได้ง่ายที่สุด — มันถูกสำรองอัตโนมัติทุกวัน
ก็อปข้ามเครื่องเวลาย้ายระบบ และเคยเกือบถูก commit ขึ้น repo สาธารณะมาแล้วในโปรเจกต์นี้
(ดู docs/ปัญหา.md) ส่วนไฟล์ .env ไม่ได้อยู่ในเส้นทางพวกนั้นเลยสักทาง

เข้ารหัสด้วยกุญแจที่อยู่ใน .env จึงทำให้ "ได้ไฟล์ DB ไปอย่างเดียว" ยังใช้ key ไม่ได้
ต้องได้ .env ไปด้วย ซึ่งเป็นคนละเส้นทางกัน — ไม่ได้กันทุกกรณี แต่กันกรณีที่เกิดจริงบ่อยที่สุด
"""
import base64
import hashlib
import logging

from cryptography.fernet import Fernet, InvalidToken

from app.config import settings

logger = logging.getLogger(__name__)


def _fernet() -> Fernet:
    """
    ใช้ ENCRYPTION_KEY ถ้าตั้งไว้ ไม่งั้นสร้างจาก JWT_SECRET_KEY ให้อัตโนมัติ

    ที่ยอม derive ให้เองเพราะถ้าบังคับให้ตั้ง ENCRYPTION_KEY ก่อนถึงจะใช้งานได้
    คนที่อัปเกรดจากเวอร์ชันก่อนหน้าจะเจอระบบพังทันทีที่ deploy โดยไม่รู้สาเหตุ
    (ค่าเดิมใน .env ไม่มีบรรทัดนี้) — derive แล้วใช้งานได้เลยโดยไม่ต้องแก้ .env

    ⚠️ ถ้าเปลี่ยน JWT_SECRET_KEY ทีหลังโดยไม่ได้ตั้ง ENCRYPTION_KEY ไว้ จะถอดรหัส
    key เก่าไม่ได้ (หน้าเว็บจะถอยไปแสดงแค่ตัวหน้าของ key ตามเดิม ไม่ได้พังทั้งระบบ)
    """
    raw = settings.encryption_key.strip()
    if raw:
        return Fernet(raw.encode("utf-8"))
    derived = base64.urlsafe_b64encode(hashlib.sha256(settings.jwt_secret_key.encode("utf-8")).digest())
    return Fernet(derived)


def encrypt(plaintext: str) -> str | None:
    """คืน None ถ้าเข้ารหัสไม่ได้ — ผู้เรียกต้องยอมให้ค่าว่างได้ ห้ามล้มทั้งคำขอเพราะเรื่องนี้"""
    try:
        return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")
    except Exception:
        logger.exception("เข้ารหัสค่าลับไม่สำเร็จ — จะเก็บเป็นค่าว่างแทน")
        return None


def decrypt(token: str | None) -> str | None:
    """
    คืน None เมื่อถอดไม่ได้ ซึ่งเป็นเรื่องปกติ ไม่ใช่ error ของระบบ:
      - key ที่สร้างไว้ก่อนมีฟีเจอร์นี้ (ไม่มีค่าเข้ารหัสเก็บไว้)
      - เปลี่ยน JWT_SECRET_KEY/ENCRYPTION_KEY หลังจากเข้ารหัสไปแล้ว
    ทั้งสองกรณีหน้าเว็บถอยไปแสดงแค่ตัวหน้าของ key ได้ตามปกติ
    """
    if not token:
        return None
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
    except Exception:
        logger.exception("ถอดรหัสค่าลับไม่สำเร็จแบบไม่คาดคิด")
        return None
