"""
FastAPI Entrypoint — รับ Request แจ้งเตือนจากระบบภายนอก แล้วเข้าคิวให้ call_worker ประมวลผล
รวม auth สำหรับ dashboard (single-user JWT) และ device management (multi-SIM)
รัน: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import logging
import threading

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, verify_password
from app.call_worker import run_worker_loop
from app.config import settings
from app.config_service import get_masked_config, update_app_settings
from app.database import get_db, init_db
from app.device_manager import add_device, list_devices, remove_device
from app.queue_manager import enqueue_job, get_pending_jobs
from app.schemas import (
    AppConfigResponse, AppConfigUpdateRequest,
    DeviceCreateRequest, DeviceResponse,
    LoginRequest, LoginResponse,
    NotifyRequest, NotifyResponse,
    QueueStatusItem, QueueStatusResponse,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(
    title="4G Automated Voice Notification Gateway",
    description="Self-hosted Robo-calling Gateway สำหรับแจ้งเตือนเหตุฉุกเฉินผ่านสาย 4G/VoIP",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.dashboard_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: str = Header(...)):
    """ใช้กับ endpoint ที่ระบบ monitoring ภายนอกยิงเข้ามา (ไม่ใช่ dashboard)"""
    if x_api_key != settings.api_secret_key:
        raise HTTPException(status_code=401, detail="API key ไม่ถูกต้อง")


@app.on_event("startup")
def on_startup():
    init_db()
    # รัน call worker แบบ background thread แยกจาก API request/response cycle
    worker_thread = threading.Thread(target=run_worker_loop, daemon=True)
    worker_thread.start()
    logger.info("Call worker thread เริ่มทำงานแล้ว")


# ---------- Public: ระบบภายนอกยิงแจ้งเตือน (API key) ----------

@app.post("/notify", response_model=NotifyResponse, dependencies=[Depends(verify_api_key)])
def notify(request: NotifyRequest, db: Session = Depends(get_db)):
    """รับแจ้งเตือนเหตุฉุกเฉิน แล้วเข้าคิว FIFO เพื่อรอโทร"""
    job = enqueue_job(db, message=request.message, priority_group=request.priority_group)
    return NotifyResponse(job_id=job.id, status=job.status.value)


# ---------- Dashboard Auth (single-user) ----------

@app.post("/auth/login", response_model=LoginResponse)
def login(request: LoginRequest):
    if request.username != settings.admin_username or not verify_password(request.password):
        raise HTTPException(status_code=401, detail="username หรือ password ไม่ถูกต้อง")
    token = create_access_token(username=request.username)
    return LoginResponse(access_token=token)


# ---------- Dashboard: ต้อง login (JWT) ----------

@app.get("/queue/status", response_model=QueueStatusResponse)
def queue_status(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """เช็คสถานะงานที่ยังค้างอยู่ในคิว"""
    jobs = get_pending_jobs(db)
    items = [
        QueueStatusItem(
            job_id=j.id,
            status=j.status.value,
            priority_group=j.priority_group,
            retry_count=j.retry_count,
            created_at=j.created_at.isoformat(),
        )
        for j in jobs
    ]
    return QueueStatusResponse(total_pending=len(items), items=items)


@app.get("/config", response_model=AppConfigResponse)
def get_config(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """
    ดึง config ปัจจุบัน (เลือก backend, Zadarma/AMI ฯลฯ) — secret ถูก mask ไว้
    นี่คือหน้าที่ user ทั่วไป config VoIP ได้ง่ายๆ ผ่าน dashboard โดยไม่ต้องแก้ .env
    """
    return AppConfigResponse(**get_masked_config(db))


@app.put("/config", response_model=AppConfigResponse)
def update_config(
    request: AppConfigUpdateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    """
    แก้ config ผ่าน dashboard — ส่งเฉพาะ field ที่ต้องการเปลี่ยน
    หมายเหตุ: worker ต้อง restart ถึงจะเห็นค่าใหม่ (hot-reload เป็นแผนพัฒนาต่อ)
    """
    update_app_settings(db, **request.model_dump(exclude_unset=True))
    return AppConfigResponse(**get_masked_config(db))


@app.get("/devices", response_model=list[DeviceResponse])
def get_devices(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """รายชื่อ SIM device ทั้งหมดที่ลงทะเบียนไว้ (multi-SIM pool)"""
    devices = list_devices(db)
    return [
        DeviceResponse(
            id=d.id, label=d.label, serial_port=d.serial_port,
            baudrate=d.baudrate, status=d.status.value,
        )
        for d in devices
    ]


@app.post("/devices", response_model=DeviceResponse)
def create_device(
    request: DeviceCreateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    """
    เพิ่ม SIM device ใหม่เข้า pool
    หมายเหตุ: ต้อง restart worker (หรือ endpoint reload ในอนาคต) เพื่อให้ worker pool เห็น device ใหม่
    """
    device = add_device(db, label=request.label, serial_port=request.serial_port, baudrate=request.baudrate)
    return DeviceResponse(
        id=device.id, label=device.label, serial_port=device.serial_port,
        baudrate=device.baudrate, status=device.status.value,
    )


@app.delete("/devices/{device_id}")
def delete_device(device_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    success = remove_device(db, device_id)
    if not success:
        raise HTTPException(status_code=404, detail="ไม่พบ device นี้")
    return {"deleted": True}


@app.get("/health")
def health():
    return {"status": "ok"}
