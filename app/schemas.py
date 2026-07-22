"""Pydantic schemas สำหรับ request/response ของ API"""
from pydantic import BaseModel, Field


class NotifyRequest(BaseModel):
    message: str = Field(..., description="ข้อความแจ้งเตือนที่จะแปลงเป็นเสียงพูด (ภาษาไทย)")
    priority_group: str = Field(
        ..., description="กลุ่ม escalation ที่จะใช้ เช่น network_team, power_team"
    )


class NotifyResponse(BaseModel):
    job_id: int
    status: str
    message: str = "เข้าคิวเรียบร้อยแล้ว"


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


class DeviceCreateRequest(BaseModel):
    label: str = Field(..., description="ชื่อเรียกใน dashboard เช่น 'SIM-1 (GOMO)'")
    serial_port: str = Field(..., description="เช่น /dev/ttyUSB2")
    baudrate: int = 115200


class DeviceResponse(BaseModel):
    id: int
    label: str
    serial_port: str
    baudrate: int
    status: str


class AppConfigResponse(BaseModel):
    call_backend: str
    call_retry_count: int
    call_retry_delay_seconds: int
    call_ring_timeout_seconds: int
    sms_fallback_enabled: bool
    ami_host: str
    ami_port: int
    ami_username_masked: str
    ami_secret_set: bool
    zadarma_trunk_name: str
    zadarma_sip_username_masked: str
    zadarma_sip_password_set: bool
    voip_dial_context: str
    voip_callerid: str


class AppConfigUpdateRequest(BaseModel):
    """
    ทุก field เป็น optional — ส่งเฉพาะที่ต้องการแก้ ที่เหลือคงค่าเดิม
    field ที่ลงท้าย _plain คือ secret ตัวจริง (จะถูก encrypt ก่อนเก็บ) — ไม่ต้องส่งซ้ำถ้าไม่ได้เปลี่ยน
    """
    call_backend: str | None = Field(None, description="'gsm' หรือ 'voip'")
    call_retry_count: int | None = None
    call_retry_delay_seconds: int | None = None
    call_ring_timeout_seconds: int | None = None
    sms_fallback_enabled: bool | None = None
    ami_host: str | None = None
    ami_port: int | None = None
    ami_username_plain: str | None = None
    ami_secret_plain: str | None = None
    zadarma_trunk_name: str | None = None
    zadarma_sip_username_plain: str | None = None
    zadarma_sip_password_plain: str | None = None
    voip_dial_context: str | None = None
    voip_callerid: str | None = None
