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

    device_id บังคับ ไม่ใช่ optional: ผู้รับสายถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์) จุดเดียว
    ไม่บอกว่าเป็นอุปกรณ์ไหน = ไม่มีทางรู้ว่าต้องโทรหาใคร ไม่มีค่าเริ่มต้นให้ถอยไปใช้อีกแล้ว

    ผลพลอยได้คือการทดสอบตรงกับของจริง 100% — เดินเส้นทางเดียวกับตอนอุปกรณ์ยิงเข้ามาเอง
    ทั้งการตรวจสิทธิ์ การหาผู้รับ และชื่ออุปกรณ์ที่ถูกพูดในสาย
    """
    device_id: int = Field(..., description="id ของอุปกรณ์ที่ต้องการจำลอง")


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


class EventTypeUpdateRequest(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=120)
    message_template: str | None = Field(None, min_length=1, max_length=MAX_MESSAGE_CHARS)
    is_active: bool | None = None


class EventTypeResponse(BaseModel):
    """
    ประเภทเหตุการณ์เป็นแค่ "คำพูด" — ไม่มี group_id/group_name อีกต่อไป
    ใครได้รับสายเป็นเรื่องของคู่ (อุปกรณ์ + เหตุการณ์) ดู ApiKeyEventTypeRef
    """
    id: int
    code: str
    display_name: str
    message_template: str
    is_active: bool


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., description="ชื่ออุปกรณ์ เช่น 'โหนดตึก A ชั้น 3' — ใช้ระบุที่มาในประวัติการโทร")
    event_type_ids: list[int] = Field(
        default_factory=list, description="event type ที่อุปกรณ์นี้ได้รับอนุญาตให้ยิง"
    )


class ApiKeyEventLink(BaseModel):
    """
    เหตุการณ์ที่อุปกรณ์ยิงได้ 1 รายการ + ผู้รับสายของคู่นี้

    เลือกได้แบบใดแบบหนึ่ง: contact_ids มีของ = เลือกเบอร์เอง (เรียงตามลำดับไล่สาย)
    ไม่งั้นใช้ทั้งกลุ่มตาม group_id — ถ้าส่งมาทั้งคู่ ฝั่ง service จะยึด contact_ids
    และล้าง group_id ทิ้ง เพื่อไม่ให้มีสองคำตอบค้างอยู่ในฐานข้อมูลพร้อมกัน
    """
    event_type_id: int
    group_id: int | None = None
    contact_ids: list[int] | None = Field(
        None, max_length=50, description="เบอร์ที่เลือกเอง เรียงตามลำดับที่จะไล่โทร"
    )


class ApiKeyUpdateRequest(BaseModel):
    """แก้ได้โดยที่ key เดิมยังใช้ได้ — ไม่ต้องแฟลช firmware ใหม่"""
    name: str | None = None
    # ส่ง event_links มาแทน event_type_ids ถ้าต้องการกำหนดกลุ่มรายเหตุการณ์ด้วย
    # (event_type_ids ยังรับอยู่เพื่อความเข้ากันได้ — ตีความว่าใช้กลุ่มเริ่มต้นทุกอัน)
    event_type_ids: list[int] | None = None
    event_links: list[ApiKeyEventLink] | None = None
    # ปิดชั่วคราวโดยไม่ลบทิ้ง — key ยังอยู่ในระบบแต่ยิงเข้ามาแล้วโดนปฏิเสธ
    # (ใช้ตอนถอดบอร์ดไปซ่อม/ย้ายที่ ไม่ต้องออก key ใหม่แล้วไปแฟลชบอร์ดใหม่ตอนเอากลับมา)
    is_active: bool | None = None


class PickedContactRef(BaseModel):
    """เบอร์ที่ถูกเลือกไว้รายตัวสำหรับคู่ (อุปกรณ์ + เหตุการณ์) เรียงตามลำดับไล่สาย"""
    id: int
    name: str | None = None
    phone_number: str
    group_id: int
    group_name: str


class ApiKeyEventTypeRef(BaseModel):
    id: int
    code: str
    display_name: str
    # ผู้รับของคู่นี้ — มีได้อย่างใดอย่างหนึ่งเท่านั้น
    #   group_id/group_name มีค่า = โทรทั้งกลุ่มนั้น
    #   contacts มีของ           = โทรเฉพาะเบอร์เหล่านี้ตามลำดับ
    #   ไม่มีทั้งคู่              = ยังตั้งค่าไม่เสร็จ หน้าเว็บต้องเตือนให้เห็น
    group_id: int | None = None
    group_name: str | None = None
    contacts: list[PickedContactRef] = Field(default_factory=list)


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
    power_on: bool | None = Field(
        None,
        description="อ่านจากขา STATUS ของโมดูล — true=ไฟติด false=ไฟดับ null=ตอบไม่ได้ (ไม่ได้ต่อ GPIO)",
    )


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
    call_answer_delay_seconds: int
    call_repeat_count: int


class AppConfigUpdateRequest(BaseModel):
    """
    ทุก field เป็น optional — ส่งเฉพาะที่ต้องการแก้ ที่เหลือคงค่าเดิม

    ขอบเขตต้องตรงกับ CFG_LIMITS ในหน้าเว็บ (frontend/src/app/pages/SystemPage.tsx)
    เดิมไม่มีการตรวจฝั่งนี้เลย ทั้งที่คอมเมนต์ฝั่งเว็บเขียนไว้ว่า "ต้องตรงกับ validation ฝั่ง /config"
    ช่อง <input min/max> กันได้แค่คนที่กรอกผ่านหน้าเว็บ ใครยิง PUT /config ตรงๆ ผ่านไปได้หมด
    ค่าที่หลุดเข้ามาแล้วเจ็บจริง:
      - ring_timeout สูงลิ่ว → dial() วนรอสายเดียวได้เป็นชั่วโมง worker เป็น thread เดียว
        ทั้งคิวหยุดรอไปด้วย และหน้าเว็บจะดูเหมือนระบบค้างโดยไม่มี error ให้เห็น
      - retry_delay = 0    → ไม่รับสายแล้วโทรซ้ำทันทีไม่มีเว้น = สแปมโทรศัพท์ปลายทาง
      - ค่าติดลบ           → retry_count ติดลบมีผลเท่ากับ 0 แต่เงียบ อ่าน config แล้วงงว่าทำไมไม่ retry
    """
    call_retry_count: int | None = Field(default=None, ge=0, le=10)
    call_retry_delay_seconds: int | None = Field(default=None, ge=5, le=300)
    call_ring_timeout_seconds: int | None = Field(default=None, ge=10, le=120)
    call_answer_delay_seconds: int | None = Field(default=None, ge=0, le=10)
    call_repeat_count: int | None = Field(default=None, ge=1, le=5)
