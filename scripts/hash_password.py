"""
สคริปต์ช่วย generate bcrypt hash ของรหัสผ่าน admin เพื่อใส่ใน .env (ADMIN_PASSWORD_HASH)
รัน: python scripts/hash_password.py
"""
import getpass

import bcrypt

if __name__ == "__main__":
    password = getpass.getpass("ตั้งรหัสผ่าน admin: ")
    confirm = getpass.getpass("ยืนยันรหัสผ่านอีกครั้ง: ")
    if password != confirm:
        print("รหัสผ่านไม่ตรงกัน ลองใหม่อีกครั้ง")
    else:
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        print("\nคัดลอกบรรทัดนี้ไปใส่ใน .env:\n")
        print(f"ADMIN_PASSWORD_HASH={hashed}")
