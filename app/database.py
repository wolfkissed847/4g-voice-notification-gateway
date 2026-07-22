"""
Database models (SQLAlchemy) — ใช้ SQLite เป็น FIFO Queue สำหรับงานโทร
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


class AppSettings(Base):
    """
    Config ที่ user แก้ผ่าน dashboard ได้ (ไม่ต้องแก้ .env/SSH เข้าเครื่อง)
    เป็น singleton — มีแถวเดียวเสมอ (id=1) โหลดครั้งแรกจากค่า default ใน .env แล้วจากนั้นแก้ผ่าน API

    ฟิลด์ที่ลงท้าย _enc คือค่าที่ encrypt ไว้แล้ว (ดู app/secrets_crypto.py) — ห้าม decrypt ใน model นี้
    ต้องผ่าน service layer (app/config_service.py) เท่านั้น
    """
    __tablename__ = "app_settings"

    id = Column(Integer, primary_key=True, default=1)

    # เลือก backend หลัก — เปลี่ยนตรงนี้ผ่าน dashboard แทนแก้ .env
    call_backend = Column(String, default="gsm")  # "gsm" | "voip"

    # Call logic (แก้ได้ผ่าน dashboard)
    call_retry_count = Column(Integer, default=2)
    call_retry_delay_seconds = Column(Integer, default=30)
    call_ring_timeout_seconds = Column(Integer, default=25)
    sms_fallback_enabled = Column(String, default="true")  # เก็บเป็น string กัน bool เพี้ยนข้าม DB

    # VoIP: Asterisk AMI (secret เก็บแบบ encrypted)
    ami_host = Column(String, default="127.0.0.1")
    ami_port = Column(Integer, default=5038)
    ami_username_enc = Column(Text, default="")
    ami_secret_enc = Column(Text, default="")

    # VoIP: Zadarma trunk
    zadarma_trunk_name = Column(String, default="zadarma-trunk")
    zadarma_sip_username_enc = Column(Text, default="")
    zadarma_sip_password_enc = Column(Text, default="")
    voip_dial_context = Column(String, default="from-gateway")
    voip_callerid = Column(String, default="IT-Alert")

    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class DeviceStatus(str, enum.Enum):
    IDLE = "idle"
    BUSY = "busy"
    OFFLINE = "offline"
    DISABLED = "disabled"


class SimDevice(Base):
    """
    อุปกรณ์ SIMCOM แต่ละตัวที่เสียบไว้ (เฉพาะ backend gsm — VoIP ไม่ใช้ตารางนี้)
    ระบบ multi-SIM ใช้ตารางนี้เป็น registry ให้ worker pool รู้ว่ามีกี่ตัว/ตัวไหนว่าง
    """
    __tablename__ = "sim_devices"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)          # ชื่อเรียกใน dashboard เช่น "SIM-1 (GOMO)"
    serial_port = Column(String, nullable=False, unique=True)  # เช่น /dev/ttyUSB2
    baudrate = Column(Integer, default=115200)
    status = Column(Enum(DeviceStatus), default=DeviceStatus.OFFLINE)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CallJob(Base):
    """
    งานโทร 1 รายการในคิว FIFO
    priority_group ใช้ map ไปหา escalation contact list ใน config
    """
    __tablename__ = "call_jobs"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    priority_group = Column(String, nullable=False)  # เช่น network_team, power_team
    contact_index = Column(Integer, default=0)        # ตำแหน่งเบอร์ปัจจุบันใน escalation chain
    retry_count = Column(Integer, default=0)
    status = Column(Enum(CallStatus), default=CallStatus.QUEUED)
    device_id = Column(Integer, nullable=True)        # SIM device ที่รับงานนี้ไป (เฉพาะ backend gsm)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class CallLog(Base):
    """ประวัติผลลัพธ์ของแต่ละความพยายามโทร (audit trail) """
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
