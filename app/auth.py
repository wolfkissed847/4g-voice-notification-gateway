"""
Auth — single-user login (admin คนเดียว) สำหรับ Next.js dashboard
ใช้ JWT ธรรมดา ไม่มีระบบ signup/multi-user เพราะ scope ของโปรเจคระบุไว้ชัดว่า "login เพื่อใช้ได้คนเดียว"

รหัสผ่านจริงเก็บเป็น bcrypt hash ใน .env (ADMIN_PASSWORD_HASH) ไม่ hardcode/plain text เด็ดขาด
สร้าง hash ด้วย: python scripts/hash_password.py
"""
import datetime

import bcrypt
import jwt
from fastapi import Header, HTTPException

from app.config import settings

ALGORITHM = "HS256"


def verify_password(plain_password: str) -> bool:
    if not settings.admin_password_hash:
        return False
    return bcrypt.checkpw(
        plain_password.encode("utf-8"), settings.admin_password_hash.encode("utf-8")
    )


def create_access_token(username: str) -> str:
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": username, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=ALGORITHM)


def decode_token(token: str) -> str:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[ALGORITHM])
        return payload["sub"]
    except jwt.PyJWTError:
        raise HTTPException(status_code=401, detail="Token ไม่ถูกต้องหรือหมดอายุ กรุณา login ใหม่")


def get_current_user(authorization: str = Header(...)) -> str:
    """Dependency สำหรับ protect route ของ dashboard — ต้องส่ง 'Authorization: Bearer <token>'"""
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="ต้องส่ง Bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    return decode_token(token)
