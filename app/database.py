"""
Database models (SQLAlchemy) — ใช้ SQLite เป็น FIFO Queue สำหรับงานโทร
เวอร์ชันนี้ตัดสิทธิ multi-SIM/VoIP ออก (ดู branch feature/voip-multi-sim ถ้าต้องการกลับไปใช้)
เหลือ SIM ตัวเดียว โทรผ่าน GSM AT command เท่านั้น
"""
import datetime
import enum

from sqlalchemy import (
    create_engine, Column, Integer, String, DateTime, Enum, Text
)
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import settings

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


class AppSettings(Base):
    """
    Config ที่ user แก้ผ่าน dashboard ได้ (ไม่ต้องแก้ .env/SSH เข้าเครื่อง)
    เป็น singleton — มีแถวเดียวเสมอ (id=1)
    """
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)

    call_retry_count = Column(Integer, default=2)
    call_retry_delay_seconds = Column(Integer, default=30)
    call_ring_timeout_seconds = Column(Integer, default=25)
    sms_fallback_enabled = Column(String, default="true")  # เก็บเป็น string กัน bool เพี้ยนข้าม DB

    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CallStatus(str, enum.Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    CONNECTED = "connected"          # โทรติดและเล่นเสียงจบ
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    RETRYING = "retrying"
    ESCALATED = "escalated"
    SMS_FALLBACK_SENT = "sms_fallback_sent"
    FAILED = "failed"                # หมดทางแล้ว ทำอะไรต่อไม่ได้


class CallJob(Base):
    """งานโทร 1 รายการในคิว FIFO"""
    __tablename__ = "call_jobs"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    priority_group = Column(String, nullable=False)  # เช่น network_team, power_team
    contact_index = Column(Integer, default=0)        # ตำแหน่งเบอร์ปัจจุบันใน escalation chain
    retry_count = Column(Integer, default=0)
    status = Column(Enum(CallStatus), default=CallStatus.QUEUED)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CallLog(Base):
    """ประวัติผลลัพธ์ของแต่ละความพยายามโทร (audit trail)"""
    __tablename__ = "call_logs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, index=True)
    phone_number_masked = Column(String)  # เก็บแบบ mask บางส่วนเพื่อความปลอดภัยใน log
    result = Column(String)
    detail = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)


def init_db():
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
