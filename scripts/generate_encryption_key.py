"""
Generate ENCRYPTION_KEY สำหรับใส่ใน .env — ใช้ครั้งเดียวตอน setup ครั้งแรก
รัน: python scripts/generate_encryption_key.py
"""
from cryptography.fernet import Fernet

if __name__ == "__main__":
    key = Fernet.generate_key().decode("utf-8")
    print("\nคัดลอกบรรทัดนี้ไปใส่ใน .env:\n")
    print(f"ENCRYPTION_KEY={key}")
    print(
        "\n⚠️  เก็บ key นี้ไว้ให้ดี ถ้าหายจะ decrypt ค่าที่ตั้งผ่าน dashboard (Zadarma/AMI credential) "
        "ไม่ได้ ต้องกรอกใหม่ทั้งหมด"
    )
