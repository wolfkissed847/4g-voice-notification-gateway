"""
Database models (SQLAlchemy) — ใช้ SQLite เป็น FIFO Queue สำหรับงานโทร
เวอร์ชันนี้ตัดสิทธิ multi-SIM/VoIP ออก (ดู branch feature/voip-multi-sim ถ้าต้องการกลับไปใช้)
เหลือ SIM ตัวเดียว โทรผ่าน GSM AT command เท่านั้น
"""
import datetime
import enum
import logging
import os

from sqlalchemy import (
    ForeignKeyConstraint,
    create_engine, event, Column, ForeignKey, Integer, MetaData, String, DateTime, Enum, Text
)
from sqlalchemy.engine import Engine
from sqlalchemy.orm import declarative_base, relationship, sessionmaker

from app.config import settings

logger = logging.getLogger("database")

# ── ขนาด connection pool ──────────────────────────────────────────────────────
# ค่าเริ่มต้นของ SQLAlchemy คือ pool_size=5 + overflow 10 = เปิดพร้อมกันได้ 15 connection
# และถ้าเต็ม คำขอที่ 16 จะ "รอเงียบๆ 30 วินาที" แล้วค่อยโยน TimeoutError ออกมาเป็น 500
#
# วัดจริงด้วย tests/concurrency_sweep.py แล้วพบว่า ที่ 50 คำขอพร้อมกันแบบยิงต่อเนื่อง
# เริ่มมีคำขอตกเป็น 500 และที่ 80 คำขอพร้อมกันตกไป 346 จาก 1,600 ครั้ง (22%)
# โดยบางคำขอค้างอยู่เกิน 60 วินาทีก่อนจะได้คำตอบ
#
# สำหรับระบบแจ้งเตือนเหตุฉุกเฉิน การค้าง 30 วินาทีแล้วค่อยตอบ error แย่กว่าการตอบ error
# ทันที เพราะอุปกรณ์ปลายทางส่วนใหญ่ตั้ง timeout ไว้สั้นกว่านั้น มันจะเลิกรอไปก่อน
# แล้วเข้าใจว่าส่งไม่สำเร็จทั้งที่งานอาจเข้าคิวไปแล้ว — กลายเป็นยิงซ้ำโดยไม่จำเป็น
#
# จึงขยายจำนวน connection ให้รับ burst ได้จริง และลดเวลารอลงเหลือ 10 วินาที
# หมายเหตุ: การเพิ่มตัวเลขนี้ไม่ได้ทำให้ SQLite เขียนเร็วขึ้น (การเขียนถูก serialize อยู่ดี)
# แต่ทำให้คำขอไปรอที่ระดับฐานข้อมูลซึ่งมี busy_timeout ของตัวเอง แทนที่จะตายคาที่ประตู pool
_SQLITE_POOL = {"pool_size": 20, "max_overflow": 30, "pool_timeout": 10}

engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False} if "sqlite" in settings.database_url else {},
    **(_SQLITE_POOL if "sqlite" in settings.database_url else {}),
)


@event.listens_for(Engine, "connect")
def _configure_sqlite_connection(dbapi_connection, connection_record):
    """
    ตั้งค่า PRAGMA ที่ต้องตั้งใหม่ทุก connection (SQLite ไม่จำข้ามการเชื่อมต่อ ยกเว้น journal_mode)

    - foreign_keys=ON: SQLite ไม่บังคับ FK constraint โดย default ต้องเปิดเองทุก connection
    - journal_mode=WAL: จำเป็นเพราะ call_worker thread commit ถี่มาก (ทุกครั้งที่ log attempt
      และทุกครั้งที่เปลี่ยน job status) พร้อมกับที่ API thread อ่าน/เขียน DB เดียวกัน
      โหมด default (delete) ให้ writer ตัวเดียวล็อกทั้งไฟล์ = API ค้างรอ worker บน SD card ที่ช้า
      WAL ให้ reader อ่านได้ระหว่างมีคนเขียน (ค่านี้ persist ในไฟล์ ตั้งซ้ำไม่มีผลเสีย)
    - synchronous=NORMAL: ปลอดภัยพอเมื่อใช้ร่วมกับ WAL และลดการ fsync ซึ่งกิน SD card ของ Pi
    - busy_timeout: ถ้ายังชนกันจริงให้รอเป็น ms แทนที่จะโยน "database is locked" ทันที
    """
    if "sqlite" not in settings.database_url:
        return
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute(f"PRAGMA busy_timeout={settings.sqlite_busy_timeout_ms}")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# ตั้งชื่อ constraint ให้อัตโนมัติทุกตัว — จำเป็นสำหรับ SQLite โดยเฉพาะ
# เพราะ SQLite ไม่มี ALTER TABLE จริง Alembic ต้องสร้างตารางใหม่แล้ว copy ข้อมูล (batch mode)
# ซึ่งทำไม่ได้ถ้า constraint ไม่มีชื่อ (ValueError: Constraint must have a name)
# ตั้งไว้ตรงนี้ครั้งเดียวดีกว่าไปตั้งชื่อเองทีละตัวในทุก migration ที่จะเขียนต่อจากนี้
_NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}
Base = declarative_base(metadata=MetaData(naming_convention=_NAMING_CONVENTION))


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

    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Group(Base):
    """กลุ่มผู้รับ escalation เช่น 'ทีมช่าง', 'ผู้บริหาร'"""
    __tablename__ = "groups"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Contact(Base):
    """เบอร์ติดต่อ 1 รายการในกลุ่ม เรียงลำดับ escalation ด้วย order_index"""
    __tablename__ = "contacts"

    id = Column(Integer, primary_key=True, index=True)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String, nullable=True)
    phone_number = Column(String, nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    group = relationship("Group", backref="contacts")


class EventType(Base):
    """
    ประเภทเหตุการณ์ที่ระบบภายนอกยิงเข้ามาผ่าน /notify (เช่น power_outage, server_down)

    เก็บ "ข้อความที่จะพูด" อย่างเดียว — ไม่รู้จักกลุ่มหรือเบอร์ใดๆ ทั้งสิ้น
    เป็นคลังคำพูดกลางที่อุปกรณ์หลายตัวหยิบไปใช้ร่วมกันได้ ใครยิงแล้วโทรหาใคร
    เป็นเรื่องของคู่ (อุปกรณ์ + เหตุการณ์) ทั้งหมด ดู ApiKeyEventType
    """
    __tablename__ = "event_types"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String, nullable=False, unique=True, index=True)
    display_name = Column(String, nullable=False)
    message_template = Column(Text, nullable=False)
    is_active = Column(String, default="true")  # เก็บเป็น string ตามรูปแบบเดิมของ AppSettings
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ApiKeyEventType(Base):
    """
    ตารางเชื่อม: key อันนี้ได้รับอนุญาตให้ยิง event type ไหนบ้าง (many-to-many)

    ถ้าไม่มีตารางนี้ key ทุกอันจะสั่งได้ทุกการแจ้งเตือนในระบบ — อุปกรณ์ 1 ตัวที่หายไป
    จากไซต์งานจะกลายเป็นสิทธิ์สั่งให้ระบบโทรได้ทุกเรื่อง ซึ่งเกินกว่าที่อุปกรณ์นั้นต้องใช้จริง
    """
    __tablename__ = "api_key_event_types"

    api_key_id = Column(
        Integer, ForeignKey("api_keys.id", ondelete="CASCADE"), primary_key=True
    )
    event_type_id = Column(
        Integer, ForeignKey("event_types.id", ondelete="CASCADE"), primary_key=True
    )
    # ── ผู้รับสายของคู่นี้ เลือกได้แบบใดแบบหนึ่ง ───────────────────────────────
    #   1) ทั้งกลุ่ม      → group_id ชี้ไปที่กลุ่ม, ตาราง api_key_event_contacts ว่าง
    #   2) เลือกเบอร์เอง  → group_id = NULL, เบอร์ที่เลือกอยู่ใน api_key_event_contacts
    # ไม่มีทั้งสองอย่าง = ยังตั้งค่าไม่เสร็จ ระบบจะปฏิเสธคำขอพร้อมบอกว่าต้องไปตั้งตรงไหน
    #
    # เดิมมีทางที่สามคือ "ถอยไปใช้กลุ่มเริ่มต้นของเหตุการณ์" ซึ่งตัดทิ้งแล้ว —
    # ประเภทเหตุการณ์ไม่รู้จักกลุ่มอีกต่อไป (ดู EventType) การมีค่าเริ่มต้นซ่อนอยู่อีกชั้น
    # ทำให้ตอบคำถาม "ยิงเหตุการณ์นี้แล้วใครจะได้รับสาย" ต้องไล่ดูสองที่เสมอ
    group_id = Column(Integer, ForeignKey("groups.id"), nullable=True, index=True)

    # มี relationship ไว้เพื่ออ่านชื่อกลุ่มได้จากตัว link เอง ไม่ต้องส่ง session ไปด้วย
    # (ชั้นที่แปลงเป็น response ไม่มี db ให้ใช้ และไม่ควรต้องมี)
    group = relationship("Group")
    contacts = relationship(
        "ApiKeyEventContact",
        order_by="ApiKeyEventContact.order_index",
        cascade="all, delete-orphan",
        backref="link",
    )


class ApiKeyEventContact(Base):
    """
    เบอร์ที่ "เลือกเอง" สำหรับคู่ (อุปกรณ์ + เหตุการณ์) — ใช้แทนการโทรทั้งกลุ่ม

    มีไว้เพราะการเลือกได้แค่ระดับกลุ่มหยาบเกินไปในการใช้งานจริง: กลุ่ม 'ทีมช่าง' มี 5 คน
    แต่เรื่อง 'ปั๊มน้ำตึก A ดับ' ควรโทรหาแค่ 2 คนที่ดูแลตึกนั้น การบังคับให้แตกกลุ่มใหม่
    ทุกครั้งที่ผู้รับต่างไปนิดเดียว ทำให้เกิดกลุ่มซ้ำๆ ที่มีสมาชิกเหลื่อมกันเต็มไปหมด
    แล้วเบอร์คนเดิมไปโผล่หลายกลุ่ม เปลี่ยนเบอร์ทีต้องไล่แก้ทุกกลุ่ม

    order_index = ลำดับการไล่สาย (escalation) ของคู่นี้โดยเฉพาะ ไม่เกี่ยวกับลำดับในกลุ่มต้นทาง
    คนเดียวกันจึงเป็นเบอร์แรกของเหตุการณ์หนึ่งและเป็นเบอร์สำรองของอีกเหตุการณ์ได้

    FK ผูกกลับไปที่คู่ (api_key_id, event_type_id) แบบ composite ทำให้ลบสิทธิ์ของอุปกรณ์
    หรือลบตัวอุปกรณ์/เหตุการณ์ทิ้ง แถวพวกนี้หายตามเองโดยไม่ต้องไล่ลบในโค้ด
    ส่วน contact_id ผูกกับเบอร์ตรงๆ — ลบเบอร์ออกจากกลุ่มแล้วเบอร์นั้นหลุดจากทุกอุปกรณ์ทันที
    ซึ่งเป็นสิ่งที่ต้องการ: เบอร์ที่ถูกลบต้องไม่มีทางถูกโทรอีก
    """
    __tablename__ = "api_key_event_contacts"

    api_key_id = Column(Integer, primary_key=True)
    event_type_id = Column(Integer, primary_key=True)
    contact_id = Column(
        Integer, ForeignKey("contacts.id", ondelete="CASCADE"), primary_key=True
    )
    order_index = Column(Integer, nullable=False, default=0)

    __table_args__ = (
        ForeignKeyConstraint(
            ["api_key_id", "event_type_id"],
            ["api_key_event_types.api_key_id", "api_key_event_types.event_type_id"],
            ondelete="CASCADE",
        ),
    )

    contact = relationship("Contact")


class ApiKey(Base):
    """
    API key = ตัวตนของ "อุปกรณ์ 1 ตัว" ที่ยิง /notify เข้ามา (ไม่ใช่ต่อประเภทการแจ้งเตือน)

    เก็บเฉพาะ hash (sha256) ในฐานข้อมูล plaintext จะโชว์ให้ผู้ใช้เห็นแค่ตอนสร้างครั้งเดียว

    ที่เลือกให้ 1 key = 1 อุปกรณ์ เพราะ:
    - ชื่ออุปกรณ์ (`name`) อยู่ในฐานข้อมูล ไม่ใช่ใน firmware — ย้ายจุดติดตั้งหรือเปลี่ยนชื่อ
      แก้จาก dashboard ได้เลย ไม่ต้องเอาบอร์ดกลับมาแฟลชใหม่ (ดู event_types_service.render_message)
    - อุปกรณ์หาย/ถูกขโมย revoke แค่ key ของตัวนั้น ตัวอื่นในไซต์เดียวกันไม่กระทบ
    - last_used_at กลายเป็น heartbeat รายอุปกรณ์ — เห็นได้ว่าบอร์ดตัวไหนเงียบไปนานแล้ว
    """
    __tablename__ = "api_keys"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)  # ชื่ออุปกรณ์ เช่น "โหนดตึก A ชั้น 3" — ใช้เติม {device} ในข้อความ
    key_prefix = Column(String, nullable=False, index=True)
    key_hash = Column(String, nullable=False)
    is_active = Column(String, default="true")
    last_used_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    revoked_at = Column(DateTime, nullable=True)

    # event type ที่ key นี้ยิงได้ — ลบ key หรือลบ event type แล้วแถวเชื่อมหายตาม (CASCADE)
    # key เต็มที่เข้ารหัสไว้ (ดู app/crypto.py) — มีไว้เพื่อโชว์ซ้ำได้โดยไม่ต้องออก key ใหม่
    # ไม่ได้ใช้ตรวจสอบสิทธิ์ การตรวจยังใช้ key_hash เหมือนเดิม (เทียบ hash ไม่ต้องถอดรหัส)
    # null = key ที่สร้างไว้ก่อนมีฟีเจอร์นี้ หน้าเว็บจะถอยไปแสดงแค่ตัวหน้าของ key
    key_encrypted = Column(Text, nullable=True)

    # relationship แบบ secondary ใช้อ่าน "ยิงอะไรได้บ้าง" ได้สะดวก แต่พา group_id มาด้วยไม่ได้
    # จึงมี event_type_links ควบคู่ไว้สำหรับอ่านกลุ่มที่ผูกรายคู่ (อุปกรณ์+เหตุการณ์)
    event_type_links = relationship(
        "ApiKeyEventType", cascade="all, delete-orphan", backref="api_key"
    )
    allowed_event_types = relationship(
        "EventType", secondary="api_key_event_types", backref="allowed_api_keys", viewonly=True
    )


class CallStatus(str, enum.Enum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    CONNECTED = "connected"          # โทรติดและเล่นเสียงจบ
    NO_ANSWER = "no_answer"
    BUSY = "busy"
    RETRYING = "retrying"
    ESCALATED = "escalated"          # ครบ retry ของเบอร์นี้แล้ว รอ worker หยิบไปโทรเบอร์ถัดไป
    FAILED = "failed"                # หมดทางแล้ว ทำอะไรต่อไม่ได้ (ครบทุกเบอร์ในกลุ่มแล้วไม่มีใครรับ — เอาแค่โทร ไม่มี SMS fallback แล้ว)
    CANCELLED = "cancelled"          # user สั่งยกเลิกจาก dashboard ก่อนที่ worker จะหยิบไปโทร


class CallJob(Base):
    """งานโทร 1 รายการในคิว FIFO"""
    __tablename__ = "call_jobs"

    id = Column(Integer, primary_key=True, index=True)
    message = Column(Text, nullable=False)
    # SET NULL + เก็บ snapshot ชื่อ/รหัสไว้ ด้วยเหตุผลเดียวกับ api_key_id ด้านล่าง:
    # ลบประเภทเหตุการณ์ทิ้งแล้วประวัติการโทรเดิมต้องไม่หายและต้องยังอ่านรู้เรื่องว่าเป็นเหตุอะไร
    # เดิมเป็น NO ACTION ทำให้ลบประเภทเหตุการณ์ที่เคยมีการโทรไม่ได้เลย (FK constraint failed → 500)
    event_type_id = Column(Integer, ForeignKey("event_types.id", ondelete="SET NULL"), nullable=True)
    event_type_code = Column(String, nullable=True)
    event_type_name = Column(String, nullable=True)
    # กลุ่มผู้รับที่ "ตัดสินใจแล้ว" ตอนรับคำขอ — worker ต้องใช้ค่านี้เท่านั้นในการหาเบอร์
    #
    # ที่ต้องมีคอลัมน์นี้: กลุ่มจริงมาจากคู่ (อุปกรณ์ + เหตุการณ์) ซึ่งคำนวณได้เฉพาะตอนรับคำขอ
    # เพราะตอนนั้นเท่านั้นที่รู้ว่าอุปกรณ์ไหนยิงเข้ามา เดิมไม่ได้เก็บไว้ worker จึงไปอ่าน
    # event_types.group_id เอาเองซึ่งเป็น "กลุ่มเริ่มต้นของเหตุการณ์" คนละค่ากัน ผลคือ
    # กลุ่มรายอุปกรณ์ไม่เคยถูกใช้จริง และเหตุการณ์ที่ไม่ได้ตั้งกลุ่มเริ่มต้นจะหาเบอร์ไม่เจอ
    # แล้วปิดงานเป็น failed ทันทีโดยไม่โทรเลยสักครั้ง
    #
    # SET NULL ด้วยเหตุผลเดียวกับ api_key_id/event_type_id — ลบกลุ่มแล้วประวัติต้องไม่หาย
    # (ชื่อกลุ่ม ณ ตอนนั้นถูกเก็บไว้ใน priority_group อยู่แล้ว)
    group_id = Column(Integer, ForeignKey("groups.id", ondelete="SET NULL"), nullable=True, index=True)
    priority_group = Column(String, nullable=False)  # snapshot ป้ายชื่อผู้รับตอนสั่งโทร (สำหรับแสดงผลใน history)
    # รายชื่อผู้รับที่ "ตัดสินใจเสร็จแล้ว" ตอนรับคำขอ — JSON: [{"name": ..., "phone": ...}, ...]
    # เรียงตามลำดับการไล่สาย worker เดินตามลิสต์นี้ด้วย contact_index ตรงๆ
    #
    # ที่ต้อง snapshot ไม่ใช่ไปอ่านกลุ่มสดๆ ตอนจะโทรแต่ละครั้ง:
    #   - ผู้รับอาจไม่ได้มาจากกลุ่มเลย (เลือกเบอร์เองรายตัว) จึงไม่มี group_id ให้ไปอ่าน
    #   - งานหนึ่งกินเวลาหลายนาที ถ้ามีคนแก้กลุ่มระหว่างนั้น เบอร์ที่เหลือจะเปลี่ยนกลางคัน
    #     และ contact_index ที่ชี้อยู่จะกระโดดไปคนละคนโดยไม่มีอะไรบอก
    #   - ประวัติย้อนหลังต้องตอบได้ว่า "ตอนนั้นโทรหาใครบ้าง" ไม่ใช่ "ตอนนี้กลุ่มนั้นมีใคร"
    recipients = Column(Text, nullable=True)
    # อุปกรณ์ที่เป็นต้นเหตุ — api_key_id ไว้ filter/นับการใช้งานรายอุปกรณ์
    # ส่วน source_device เป็น snapshot ชื่อ ณ ตอนนั้น ด้วยเหตุผลเดียวกับ priority_group
    # (เปลี่ยนชื่ออุปกรณ์ทีหลังแล้วประวัติเก่าต้องไม่เปลี่ยนตาม)
    api_key_id = Column(Integer, ForeignKey("api_keys.id", ondelete="SET NULL"), nullable=True, index=True)
    source_device = Column(String, nullable=True)
    contact_index = Column(Integer, default=0)        # ตำแหน่งเบอร์ปัจจุบันใน escalation chain
    retry_count = Column(Integer, default=0)
    status = Column(Enum(CallStatus), default=CallStatus.QUEUED, index=True)
    # เวลาที่เร็วที่สุดที่ worker หยิบ job นี้ไปโทรได้ (null = ได้เลย)
    # ใช้หน่วง retry แบบไม่บล็อกคิว — เดิม call_worker เรียก time.sleep(retry_delay) ค้างทั้ง thread
    # ทำให้ job อื่นที่รออยู่ในคิวหยุดรอไปด้วยทั้งที่ไม่เกี่ยวกัน
    next_attempt_at = Column(DateTime, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    event_type = relationship("EventType")
    group = relationship("Group")


class CallLog(Base):
    """ประวัติผลลัพธ์ของแต่ละความพยายามโทร (audit trail)"""
    __tablename__ = "call_logs"

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, index=True)
    phone_number_masked = Column(String)  # เก็บแบบ mask บางส่วนเพื่อความปลอดภัยใน log
    result = Column(String)
    detail = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=datetime.datetime.utcnow)


_MIGRATIONS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations")


def _alembic_config():
    """
    สร้าง Alembic Config ในหน่วยความจำ ไม่อ่าน alembic.ini
    (ตั้ง script_location เองตรงนี้ — เลี่ยงปัญหา configparser อ่าน .ini เป็น encoding ของ locale)
    """
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", _MIGRATIONS_DIR)
    cfg.set_main_option("sqlalchemy.url", settings.database_url)
    return cfg


def init_db():
    """
    ทำให้ schema ตรงกับ head revision — ใช้ทาง Alembic ทางเดียวทั้งตอนติดตั้งใหม่และตอน deploy ทับ

    เดิมฟังก์ชันนี้เรียก Base.metadata.create_all() ซึ่ง "สร้างตารางที่ยังไม่มี" เท่านั้น
    ไม่เคย ALTER ตารางที่มีอยู่แล้ว ผลคือเวลาเพิ่มคอลัมน์ใน model (เช่น call_jobs.event_type_id)
    DB เดิมจะไม่มีคอลัมน์นั้นแต่ไม่มี error ใดๆ ตอน start — พังตอน query ครั้งแรกเป็น
    OperationalError: no such column แทน ซึ่งเกิดขึ้นจริงมาแล้วกับ gateway.db ตัวก่อนหน้านี้
    """
    from alembic import command

    command.upgrade(_alembic_config(), "head")
    logger.info("Schema เป็นเวอร์ชันล่าสุดแล้ว (alembic head)")


def detect_schema_drift() -> list:
    """
    เทียบ model ในโค้ดกับ schema จริงใน DB แล้วคืนรายการความต่าง (ว่าง = ตรงกัน)

    ครอบเคสที่ Alembic upgrade ช่วยไม่ได้: มีคนแก้ model แล้วลืมสร้าง revision
    upgrade จะผ่านฉลุยแต่ schema ยังไม่ตรง — ต้องจับตอน start ไม่ใช่ตอน user ยิง request
    """
    from alembic.autogenerate import compare_metadata
    from alembic.runtime.migration import MigrationContext

    with engine.connect() as conn:
        context = MigrationContext.configure(conn, opts={"compare_type": True})
        return compare_metadata(context, Base.metadata)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
