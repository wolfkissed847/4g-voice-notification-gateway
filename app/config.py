"""
Config loader — โหลดค่าคอนฟิกทั้งหมดจาก .env
ห้าม hardcode ค่าจริง (เบอร์โทร, secret key) ในไฟล์นี้หรือไฟล์อื่นใดในโค้ด

เวอร์ชันนี้ตัด VoIP/multi-SIM ออก (ดู branch feature/voip-multi-sim ถ้าต้องการกลับไปใช้)
ค่าที่ user แก้บ่อย (retry/timeout) ย้ายไปอยู่ใน AppSettings (DB) ผ่าน dashboard แล้ว
เบอร์ escalation และ API key ย้ายเข้าตาราง groups/contacts/api_keys แล้วเช่นกัน (ดู scripts/migrate_schema.py)
.env เหลือไว้สำหรับค่า bootstrap ที่ตั้งครั้งเดียวตอน deploy เท่านั้น (GSM port, DB URL, JWT secret, admin login, TTS)
"""
import json
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # commit ที่ image นี้ถูก build มา — Dockerfile รับผ่าน ARG แล้วตั้งเป็น env ให้
    # (ดู .github/workflows/deploy.yml ที่ส่ง github.sha เข้ามา)
    #
    # ที่ต้องมีคู่กับเลขเวอร์ชัน: เลขเวอร์ชันเป็นค่าที่คนตั้งเอง ถ้าลืมบั๊มมันจะค้างอยู่ค่าเดิม
    # ตลอดไปแม้ deploy ไปแล้ว 50 รอบ ส่วนค่านี้มาจาก git โดยตรง จึงตอบคำถาม
    # "โค้ดที่รันอยู่ตอนนี้คืออันล่าสุดหรือยัง" ได้จริงโดยไม่ต้องเชื่อว่าใครจำบั๊มเลข
    # "dev" = build จากเครื่องตัวเองโดยไม่ผ่าน CI
    app_git_sha: str = "dev"

    # GSM Module (SIM ตัวเดียว)
    gsm_serial_port: str = "/dev/ttyUSB2"
    gsm_baudrate: int = 115200

    # Database
    database_url: str = "sqlite:///./gateway.db"
    # เวลารอเมื่อ SQLite ถูกล็อกโดยอีก thread (worker vs API) ก่อนจะยอมแพ้เป็น "database is locked"
    sqlite_busy_timeout_ms: int = 5000

    # API Security — เดิมเป็น key เดียวจาก .env, ตอนนี้ /notify ตรวจกับตาราง api_keys แทน
    # (สร้าง/revoke ได้หลายอันจาก dashboard) เหลือ field นี้ไว้เผื่อ script bootstrap/migration เท่านั้น
    api_secret_key: str = "changeme"

    # Dashboard Auth (single-user login)
    admin_username: str = "admin"
    admin_password_hash: str = ""  # bcrypt hash — สร้างด้วย: python scripts/hash_password.py
    jwt_secret_key: str = "changeme-generate-a-long-random-string"
    jwt_expire_minutes: int = 60 * 12  # 12 ชั่วโมง

    # หน้าเอกสาร API อัตโนมัติของ FastAPI (/docs, /redoc, /openapi.json)
    #
    # ปิดเป็นค่าเริ่มต้นเพราะระบบนี้เปิดออกอินเทอร์เน็ตผ่านโดเมนสาธารณะ และหน้านั้นไม่มีการ
    # ยืนยันตัวตนใดๆ กั้นอยู่ ใครเปิดก็เห็นรายชื่อ endpoint ทั้งหมด รูปแบบข้อมูลที่ต้องส่ง
    # และชื่อฟิลด์ครบถ้วน ซึ่งเป็นแผนที่ให้คนที่จะลองโจมตีฟรีๆ
    # ผู้ดูแลที่ต้องการใช้จริงตั้ง ENABLE_API_DOCS=true ใน .env ได้ (แนะนำให้เปิดเฉพาะตอน dev)
    enable_api_docs: bool = False

    # CORS — origin ของ Vite dashboard (dev: `npm run dev` รันที่ http://localhost:5173 โดย default)
    dashboard_origin: str = "http://localhost:5173"

    # Encryption key (bootstrap only) — เผื่ออนาคตมี secret อื่นต้องเก็บใน DB
    encryption_key: str = ""

    # ค่า default สำหรับ AppSettings ตอนสร้างแถวแรก (หลังจากนั้นแก้ผ่าน dashboard แทน)
    call_retry_count: int = 2
    call_retry_delay_seconds: int = 30
    call_ring_timeout_seconds: int = 25

    # TTS
    tts_language: str = "th"
    audio_cache_dir: str = "./audio_cache"

    # Escalation contacts (JSON string list ต่อกลุ่ม) — เดิมเป็นแหล่งความจริงเดียว
    # ตอนนี้ย้ายเข้าตาราง groups/contacts แล้ว (ดู app/contacts_service.py)
    # เหลือไว้แค่เป็น fallback ให้ call_worker.py กับ job เก่าที่สร้างก่อน migration เท่านั้น
    network_team_contacts: str = "[]"
    power_team_contacts: str = "[]"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    def get_contacts(self, priority_group: str) -> list[str]:
        """Fallback สำหรับ call_worker กับ CallJob เก่าที่ยังไม่มี event_type_id (ก่อน migration)"""
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
