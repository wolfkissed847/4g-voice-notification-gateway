"""Pydantic schemas สำหรับ request/response ของ API"""
from pydantic import BaseModel, Field


class NotifyRequest(BaseModel):
    event_type_code: str = Field(..., description="รหัส event type เช่น power_outage, server_down")
    message: str | None = Field(
        None, description="ข้อความที่จะแปลงเป็นเสียงพูด — ถ้าไม่ส่งจะสร้างจาก message_template + variables"
    )
    variables: dict[str, str] = Field(
        default_factory=dict, description="ตัวแปรสำหรับแทนที่ {key} ใน message_template"
    )


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
    phone_number: str
    name: str | None = None


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
    code: str = Field(..., description="รหัสไม่ซ้ำ เช่น power_outage")
    display_name: str
    message_template: str
    group_id: int


class EventTypeUpdateRequest(BaseModel):
    display_name: str | None = None
    message_template: str | None = None
    group_id: int | None = None
    is_active: bool | None = None


class EventTypeResponse(BaseModel):
    id: int
    code: str
    display_name: str
    message_template: str
    group_id: int
    group_name: str
    is_active: bool


class ApiKeyCreateRequest(BaseModel):
    name: str = Field(..., description="ชื่ออุปกรณ์ เช่น 'โหนดตึก A ชั้น 3' — ใช้เติม {device} ในข้อความ")
    event_type_ids: list[int] = Field(
        default_factory=list, description="event type ที่อุปกรณ์นี้ได้รับอนุญาตให้ยิง"
    )


class ApiKeyUpdateRequest(BaseModel):
    """แก้ได้โดยที่ key เดิมยังใช้ได้ — ไม่ต้องแฟลช firmware ใหม่"""
    name: str | None = None
    event_type_ids: list[int] | None = None


class ApiKeyEventTypeRef(BaseModel):
    id: int
    code: str
    display_name: str


class ApiKeyResponse(BaseModel):
    id: int
    name: str
    key_prefix: str
    is_active: bool
    last_used_at: str | None = None
    created_at: str
    revoked_at: str | None = None
    allowed_event_types: list[ApiKeyEventTypeRef] = Field(default_factory=list)


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


class SystemInfoResponse(BaseModel):
    app_version: str
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
    sms_fallback_enabled: bool


class AppConfigUpdateRequest(BaseModel):
    """ทุก field เป็น optional — ส่งเฉพาะที่ต้องการแก้ ที่เหลือคงค่าเดิม"""
    call_retry_count: int | None = None
    call_retry_delay_seconds: int | None = None
    call_ring_timeout_seconds: int | None = None
    sms_fallback_enabled: bool | None = None
