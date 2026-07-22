"""
Config loader — โหลดค่าคอนฟิกทั้งหมดจาก .env
ห้าม hardcode ค่าจริง (เบอร์โทร, secret key) ในไฟล์นี้หรือไฟล์อื่นใดในโค้ด
"""
import json
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Call Backend Selector — "gsm" (ซิมธรรมดา) หรือ "voip" (Asterisk + Zadarma)
    call_backend: str = "gsm"

    # GSM Module
    gsm_serial_port: str = "/dev/ttyUSB2"
    gsm_baudrate: int = 115200

    # VoIP (Asterisk AMI + Zadarma trunk)
    ami_host: str = "127.0.0.1"
    ami_port: int = 5038
    ami_username: str = ""
    ami_secret: str = ""
    zadarma_trunk_name: str = "zadarma-trunk"
    voip_dial_context: str = "from-gateway"
    voip_callerid: str = "IT-Alert"

    # Database
    database_url: str = "sqlite:///./gateway.db"

    # API Security (สำหรับ /notify ที่ระบบภายนอกยิงเข้ามา)
    api_secret_key: str = "changeme"

    # Dashboard Auth (single-user login สำหรับ Next.js dashboard)
    admin_username: str = "admin"
    admin_password_hash: str = ""  # bcrypt hash — สร้างด้วยสคริปต์ scripts/hash_password.py
    jwt_secret_key: str = "changeme-generate-a-long-random-string"
    jwt_expire_minutes: int = 60 * 12  # 12 ชั่วโมง

    # CORS — origin ของ Next.js dashboard (dev: http://localhost:3000)
    dashboard_origin: str = "http://localhost:3000"

    # Encryption key (bootstrap only) — ใช้ encrypt ความลับที่ user กรอกผ่าน dashboard ก่อนเก็บลง DB
    # (Zadarma/AMI credential ฯลฯ) สร้างด้วย: python scripts/generate_encryption_key.py
    encryption_key: str = ""

    # Call logic
    call_retry_count: int = 2
    call_retry_delay_seconds: int = 30
    call_ring_timeout_seconds: int = 25

    # SMS fallback
    sms_fallback_enabled: bool = True
    sms_max_length: int = 70

    # TTS
    tts_language: str = "th"
    audio_cache_dir: str = "./audio_cache"

    # Escalation contact groups (JSON string list in .env)
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
