"""
Config loader — โหลดค่าคอนฟิกทั้งหมดจาก .env
ห้าม hardcode ค่าจริง (เบอร์โทร, secret key) ในไฟล์นี้หรือไฟล์อื่นใดในโค้ด

เวอร์ชันนี้ตัด VoIP/multi-SIM ออก (ดู branch feature/voip-multi-sim ถ้าต้องการกลับไปใช้)
ค่าที่ user แก้บ่อย (retry/timeout) ย้ายไปอยู่ใน AppSettings (DB) ผ่าน dashboard แล้ว
.env เหลือไว้สำหรับค่า bootstrap ที่ตั้งครั้งเดียวตอน deploy เท่านั้น
"""
import json
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # GSM Module (SIM ตัวเดียว)
    gsm_serial_port: str = "/dev/ttyUSB2"
    gsm_baudrate: int = 115200

    # Database
    database_url: str = "sqlite:///./gateway.db"

    # API Security (สำหรับ /notify ที่ระบบภายนอกยิงเข้ามา)
    api_secret_key: str = "changeme"

    # Dashboard Auth (single-user login)
    admin_username: str = "admin"
    admin_password_hash: str = ""  # bcrypt hash — สร้างด้วย: python scripts/hash_password.py
    jwt_secret_key: str = "changeme-generate-a-long-random-string"
    jwt_expire_minutes: int = 60 * 12  # 12 ชั่วโมง

    # CORS — origin ของ Next.js dashboard (dev: http://localhost:3000)
    dashboard_origin: str = "http://localhost:3000"

    # Encryption key (bootstrap only) — เผื่ออนาคตมี secret อื่นต้องเก็บใน DB
    encryption_key: str = ""

    # ค่า default สำหรับ AppSettings ตอนสร้างแถวแรก (หลังจากนั้นแก้ผ่าน dashboard แทน)
    call_retry_count: int = 2
    call_retry_delay_seconds: int = 30
    call_ring_timeout_seconds: int = 25
    sms_fallback_enabled: bool = True

    # TTS
    tts_language: str = "th"
    audio_cache_dir: str = "./audio_cache"

    # Escalation contacts (JSON string list ต่อกลุ่ม)
    network_team_contacts: str = "[]"
    power_team_contacts: str = "[]"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def get_contacts(self, priority_group: str) -> list[str]:
        """คืนรายชื่อเบอร์โทรตามลำดับ escalation ของกลุ่มที่ระบุ"""
        mapping = {
            "network_team": self.network_team_contacts,
            "power_team": self.power_team_contacts,
        }
        raw = mapping.get(priority_group, "[]")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return []


settings = Settings()
