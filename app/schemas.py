"""Pydantic schemas สำหรับ request/response ของ API"""
from pydantic import BaseModel, Field, field_validator


# ── เพดานความยาวข้อความที่ยอมให้เข้าคิว ────────────────────────────────────────
# ข้อความยิ่งยาว ไฟล์เสียงยิ่งใหญ่ และการอัปโหลดเข้าโมดูล 4G ส่งได้แค่ 256 ไบต์/50 มิลลิวินาที
# (≈5 KB/วินาที ดู gsm_module._try_cftranrx) ข้อความ 500 ตัวอักษรใช้เวลารวมราวครึ่งนาที
# ซึ่งเป็นเพดานที่สมเหตุสมผลของ "ข้อความแจ้งเตือนที่คนฟังทางโทรศัพท์รู้เรื่อง" อยู่แล้ว
#
# ถ้าไม่จำกัด อุปกรณ์ที่ถือ key อยู่ (หรือ key ที่หลุดออกไป) ยิงข้อความยาวหลักหมื่นตัวอักษร
# เข้ามาเพียงครั้งเดียวก็ยึดสายที่มีอยู่เส้นเดียวไว้ได้เป็นสิบนาที — งานแจ้งเตือนจริงที่ตามมา
# ทั้งหมดต้องรอคิวอยู่ข้างหลัง ซึ่งขัดกับเหตุผลที่ระบบนี้มีอยู่
MAX_MESSAGE_CHARS = 500
MAX_VARIABLE_VALUE_CHARS = 200
MAX_VARIABLES = 20


class NotifyRequest(BaseModel):
    event_type_code: str = Field(..., min_length=1, max_length=64,
                                 description="รหัส event type เช่น power_outage, server_down")
    message: str | None = Field(
        None, max_length=MAX_MESSAGE_CHARS,
        description="ข้อความที่จะแปลงเป็นเสียงพูด — ถ้าไม่ส่งจะสร้างจาก message_template + variables"
    )
    variables: dict[str, str] = Field(
        default_factory=dict, max_length=MAX_VARIABLES,
        description="ตัวแปรสำหรับแทนที่ {key} ใน message_template"
    )

    @field_validator("variables")
    @classmethod
    def _cap_variable_values(cls, v: dict[str, str]) -> dict[str, str]:
        """ตัวแปรแต่ละตัวก็ต้องมีเพดาน ไม่งั้นเลี่ยงเพดานข้อความได้ด้วยการยัดค่ายาวๆ ใส่ตัวแปรแทน"""
        for key, value in v.items():
            if len(value) > MAX_VARIABLE_VALUE_CHARS:
                raise ValueError(
                    f"ค่าของตัวแปร '{key}' ยาวเกิน {MAX_VARIABLE_VALUE_CHARS} ตัวอักษร"
                )
        return v


class TestNotifyRequest(NotifyRequest):
    """
    คำขอทดสอบจากหน้าเว็บ — เหมือน /notify แต่ระบุได้ว่า "ทดสอบในนามอุปกรณ์ตัวไหน"

    จำเป็นตั้งแต่กลุ่มผู้รับย้ายไปผูกที่คู่ (อุปกรณ์ + เหตุการณ์) เพราะถ้าไม่บอกว่าเป็นอุปกรณ์ไหน
    ระบบไม่มีทางรู้เลยว่าต้องโทรหากลุ่มไหน — ปุ่มทดสอบบนหน้าอุปกรณ์จึงต้องส่งค่านี้มาด้วย
    ไม่งั้นจะทดสอบไม่ตรงกับที่อุปกรณ์จริงจะทำ ซึ่งทำให้การทดสอบไม่มีความหมาย
    """
    device_id: int | None = Field(None, description="id ของอุปกรณ์ที่ต้องการจำลอง (null = ทดสอบกลางๆ)")


class NotifyResponse(BaseModel):
    job_id: int
    status: str
    message: str = "เข้าคิวเรียบร้อยแล้ว"


class GroupCreateRequest(BaseModel):
    name: str
    description: str | None = None


class GroupUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class GroupResponse(BaseModel):
    id: int
    name: str
    description: str | None = None
    contact_count: int = 0


class ContactCreateRequest(BaseModel):
    phone_number: str = Field(..., min_length=8, max_length=24)
    name: str | None = Field(None, max_length=120)


class ContactUpdateRequest(BaseModel):
    phone_number: str | None = None
    name: str | None = None


class ContactResponse(BaseModel):
    id: int
    group_id: int
    name: str | None = None
    phone_number: str
    order_index: int


class ContactReorderRequest(BaseModel):
    ordered_ids: list[int] = Field(..., description="ลำดับ contact id ใหม่ทั้งหมดในกลุ่มนี้")


class EventTypeCreateRequest(BaseModel):
    code: str = Field(..., min_length=1, max_length=64, description="รหัสไม่ซ้ำ เช่น power_outage")
    display_name: str = Field(..., min_length=1, max_length=120)
    message_template: str = Field(..., min_length=1, max_length=MAX_MESSAGE_CHARS)
    # ไม่บังคับแล้ว — กลุ่มผู้รับจริงเลือกที่หน้าตั้งค่าอุปกรณ์ (ต่ออุปกรณ์ต่อเหตุการณ์)
    # ค่านี้เหลือไว้เป็นกลุ่มสำรองสำหรับการทดสอบจาก dashboard ที่ไม่ได้ยิงผ่านอุปกรณ์
    group_id: int | None = None


class EventTypeUpdateRequest(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=120)
    message_template: str | None = Field(None, min_length=1, max_length=MAX_MESSAGE_CHARS)
    group_id: int | None = None
    is_active: bool | None = None


class EventTypeResponse(BaseModel):
    id: int
    code: str
    display_name: str
    message_template: str
    group_id: int | None = None
    group_name: str | None = None
    is_active: bool


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., description="ชื่ออุปกรณ์ เช่น 'โหนดตึก A ชั้น 3' — ใช้เติม {device} ในข้อความ")
    event_type_ids: list[int] = Field(
        default_factory=list, description="event type ที่อุปกรณ์นี้ได้รับอนุญาตให้ยิง"
    )


class ApiKeyEventLink(BaseModel):
    """เหตุการณ์ที่อุปกรณ์ยิงได้ 1 รายการ + กลุ่มที่จะโทรหาเมื่อยิงเหตุการณ์นั้น"""
    event_type_id: int
    group_id: int | None = None


class ApiKeyUpdateRequest(BaseModel):
    """แก้ได้โดยที่ key เดิมยังใช้ได้ — ไม่ต้องแฟลช firmware ใหม่"""
    name: str | None = None
    # ส่ง event_links มาแทน event_type_ids ถ้าต้องการกำหนดกลุ่มรายเหตุการณ์ด้วย
    # (event_type_ids ยังรับอยู่เพื่อความเข้ากันได้ — ตีความว่าใช้กลุ่มเริ่มต้นทุกอัน)
    event_type_ids: list[int] | None = None
    event_links: list[ApiKeyEventLink] | None = None


class ApiKeyEventTypeRef(BaseModel):
    id: int
    code: str
    display_name: str
    # กลุ่มที่อุปกรณ์ตัวนี้จะโทรหาเมื่อยิงเหตุการณ์นี้ (null = ใช้กลุ่มเริ่มต้นของเหตุการณ์)
    group_id: int | None = None
    group_name: str | None = None


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_active: bool
    last_used_at: str | None = None
    created_at: str
    revoked_at: str | None = None
    allowed_event_types: list[ApiKeyEventTypeRef] = Field(default_factory=list)


class ApiKeyRevealResponse(BaseModel):
    key: str | None = Field(None, description="key เต็ม — null ถ้าถอดรหัสไม่ได้ (key เก่าที่เก็บแค่ hash)")


class ApiKeyCreateResponse(ApiKeyResponse):
    plaintext_key: str = Field(..., description="แสดงให้เห็นครั้งเดียวตอนสร้าง — copy เก็บไว้ทันที")


class HistoryItem(BaseModel):
    job_id: int
    event_type_code: str | None = None
    event_type_display_name: str | None = None
    group_name: str
    # ชื่ออุปกรณ์ต้นทาง ณ ตอนที่สั่งโทร (null = สั่งทดสอบจาก dashboard ไม่ได้มาจากอุปกรณ์)
    source_device: str | None = None
    message: str
    status: str
    retry_count: int
    contact_index: int
    created_at: str
    updated_at: str
    last_result: str | None = None
    last_phone_masked: str | None = None
    last_detail: str | None = Field(None, description="รายละเอียดผลลัพธ์ล่าสุด เช่น error message ตอนล้มเหลว")


class SystemInfoResponse(BaseModel):
    app_version: str
    app_git_sha: str = Field("dev", description="commit 7 ตัวแรกที่ image นี้ถูก build มา")
    worker_started_at: str | None = None
    gsm_connected: bool
    gsm_port: str | None = None
    db_size_bytes: int | None = None


class GsmDetailResponse(BaseModel):
    connected: bool
    signal_quality: int | None = Field(None, description="RSSI ดิบ 0-31 ตาม AT+CSQ, None = ไม่ทราบ")
    operator: str | None = Field(None, description="ชื่อ operator เช่น AIS, dtac, TrueMove")
    network_mode: str | None = Field(None, description="เช่น '4G (LTE)', '3G (UMTS)'")
    port: str | None = None
    updated_at: str | None = None
    restarting: bool = Field(False, description="worker กำลังปิด/เปิดคลื่นวิทยุอยู่ตอนนี้")
    restart_result: str | None = Field(None, description="ผลของการรีสตาร์ทครั้งล่าสุด: 'ok' | 'failed'")
    restart_at: str | None = Field(None, description="เวลาที่รีสตาร์ทเสร็จครั้งล่าสุด (UTC)")


class GsmRestartResponse(BaseModel):
    accepted: bool = Field(description="รับคำสั่งไว้แล้วหรือไม่ — False = มีคำสั่งค้างอยู่ก่อนแล้ว")
    message: str


class PiDetailResponse(BaseModel):
    cpu_percent: float | None = None
    mem_percent: float | None = None
    mem_used_mb: float | None = None
    mem_total_mb: float | None = None
    cpu_temp_c: float | None = Field(None, description="อุณหภูมิ CPU °C — None ถ้าอ่านไม่ได้ (เช่นไม่ใช่ Linux)")


class HistoryResponse(BaseModel):
    total_count: int
    page: int
    page_size: int
    items: list[HistoryItem]


class QueueStatusItem(BaseModel):
    job_id: int
    status: str
    priority_group: str
    retry_count: int
    created_at: str


class QueueStatusResponse(BaseModel):
    total_pending: int
    items: list[QueueStatusItem]
    # ขั้นตอนย่อยที่ worker กำลังทำอยู่ ณ วินาทีนี้ (null = ว่างงาน)
    # สถานะใน items บอกได้แค่ "in_progress" ซึ่งกินเวลายาวและมีหลายขั้นตอนซ่อนอยู่ข้างใน
    # 2 ฟิลด์นี้ให้หน้า Signal Flow Monitor ไล่ไฟทีละขั้นตามงานจริงได้
    current_job_id: int | None = None
    current_step: str | None = Field(
        None, description="preparing_audio | uploading_audio | dialing | playing | waiting_retry"
    )
    current_progress: float | None = Field(
        None, description="ความคืบหน้าภายในขั้นตอนปัจจุบัน 0.0-1.0 (null = ขั้นนี้วัดไม่ได้)"
    )


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AppConfigResponse(BaseModel):
    call_retry_count: int
    call_retry_delay_seconds: int
    call_ring_timeout_seconds: int


class AppConfigUpdateRequest(BaseModel):
    """ทุก field เป็น optional — ส่งเฉพาะที่ต้องการแก้ ที่เหลือคงค่าเดิม"""
    call_retry_count: int | None = None
    call_retry_delay_seconds: int | None = None
    call_ring_timeout_seconds: int | None = None
