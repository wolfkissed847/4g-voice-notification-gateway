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
