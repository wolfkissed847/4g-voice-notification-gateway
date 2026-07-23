"""
FastAPI Entrypoint — รับ Request แจ้งเตือนจากระบบภายนอก แล้วเข้าคิวให้ call_worker ประมวลผล
รวม auth สำหรับ dashboard (single-user JWT) และ config ที่แก้ได้ผ่านเว็บ (retry/timeout/SMS fallback)

เวอร์ชันนี้เป็น SIM ตัวเดียว, GSM only (ดู branch feature/voip-multi-sim
ถ้าต้องการ multi-SIM หรือ VoIP/Asterisk)

รัน: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import logging
import os
import threading

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

from app.auth import create_access_token, get_current_user, verify_password
from app.call_worker import run_worker_loop
from app.config import settings
from app.config_service import get_masked_config, update_app_settings
from app.database import get_db, init_db
from app.queue_manager import enqueue_job, get_pending_jobs
from app.schemas import (
    AppConfigResponse, AppConfigUpdateRequest,
    LoginRequest, LoginResponse,
    NotifyRequest, NotifyResponse,
    QueueStatusItem, QueueStatusResponse,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")

app = FastAPI(
    title="4G Automated Voice Notification Gateway",
    description="Self-hosted Robo-calling Gateway สำหรับแจ้งเตือนเหตุฉุกเฉินผ่านสาย 4G (GSM, SIM ตัวเดียว)",
    version="0.3.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.dashboard_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: str = Header(...)):
    """ใช้กับ endpoint ที่ระบบภายนอก (บอร์ด/monitoring) ยิงเข้ามา (ไม่ใช่ dashboard)"""
    if x_api_key != settings.api_secret_key:
        raise HTTPException(status_code=401, detail="API key ไม่ถูกต้อง")


@app.on_event("startup")
def on_startup():
    init_db()
    # รัน call worker แบบ background thread แยกจาก API request/response cycle
    worker_thread = threading.Thread(target=run_worker_loop, daemon=True)
    worker_thread.start()
    logger.info("Call worker thread เริ่มทำงานแล้ว")


# ---------- Public: ระบบ/บอร์ดภายนอกยิงแจ้งเตือนเข้ามา (API key) ----------

@app.post("/notify", response_model=NotifyResponse, dependencies=[Depends(verify_api_key)])
def notify(request: NotifyRequest, db: Session = Depends(get_db)):
    """รับแจ้งเตือนเหตุฉุกเฉินจากระบบ/บอร์ดภายนอก แล้วเข้าคิว FIFO เพื่อรอโทร"""
    job = enqueue_job(db, message=request.message, priority_group=request.priority_group)
    return NotifyResponse(job_id=job.id, status=job.status.value)


# ---------- Dashboard Auth (single-user) ----------

@app.post("/auth/login", response_model=LoginResponse)
def login(request: LoginRequest):
    if request.username != settings.admin_username or not verify_password(request.password):
        raise HTTPException(status_code=401, detail="username หรือ password ไม่ถูกต้อง")
    token = create_access_token(username=request.username)
    return LoginResponse(access_token=token)


# ---------- Dashboard: ต้อง login (JWT) — ดูสถานะ + config เท่านั้น ไม่ใช่ช่องสั่งโทร ----------

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
    """ดึง config ปัจจุบัน (retry/timeout/SMS fallback) — แก้ได้ผ่าน dashboard ไม่ต้องแตะ .env"""
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


@app.get("/health")
def health():
    return {"status": "ok"}


# ---------- เสิร์ฟ frontend ที่ build แล้ว (Vite static bundle) ----------
# ไฟล์เหล่านี้ถูก build ด้วย GitHub Actions แล้ว copy เข้า container ตอน build image
# ไม่มี Node.js รันบน Pi เลย — ดู frontend/README.md และ Dockerfile
_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "static")

if os.path.isdir(_FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        """SPA fallback — route ไหนที่ไม่ตรงกับ API ข้างบน ให้ส่ง index.html แล้วให้ React Router จัดการเอง"""
        index_path = os.path.join(_FRONTEND_DIST, "index.html")
        return FileResponse(index_path)
