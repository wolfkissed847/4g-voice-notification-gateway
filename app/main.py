"""
FastAPI Entrypoint — รับ Request แจ้งเตือนจากระบบภายนอก แล้วเข้าคิวให้ call_worker ประมวลผล
รวม auth สำหรับ dashboard (single-user JWT) และ config ที่แก้ได้ผ่านเว็บ (retry/timeout)

เวอร์ชันนี้เป็น SIM ตัวเดียว, GSM only (ดู branch feature/voip-multi-sim
ถ้าต้องการ multi-SIM หรือ VoIP/Asterisk)

รัน: uvicorn app.main:app --host 0.0.0.0 --port 8000
"""
import datetime
import logging
import os
import threading

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session

import app.api_key_service as api_key_service
import app.contacts_service as contacts_service
import app.event_types_service as event_types_service
import app.worker_state as worker_state
from app.auth import create_access_token, get_current_user, verify_password
from app.call_worker import run_worker_loop
from app.config import settings
from app.config_service import get_masked_config, update_app_settings
from app.database import ApiKey, CallJob, CallLog, detect_schema_drift, get_db, init_db
from app.queue_manager import enqueue_job, get_pending_jobs
from app.schemas import (
    ApiKeyCreateRequest, ApiKeyCreateResponse, ApiKeyEventTypeRef, ApiKeyResponse,
    ApiKeyRevealResponse, ApiKeyUpdateRequest,
    AppConfigResponse, AppConfigUpdateRequest,
    ContactCreateRequest, ContactReorderRequest, ContactResponse, ContactUpdateRequest,
    EventTypeCreateRequest, EventTypeResponse, EventTypeUpdateRequest,
    GroupCreateRequest, GroupResponse, GroupUpdateRequest,
    HistoryItem, HistoryResponse,
    LoginRequest, LoginResponse,
    NotifyRequest, NotifyResponse,
    GsmDetailResponse, GsmRestartResponse, PiDetailResponse,
    QueueStatusItem, QueueStatusResponse,
    SystemInfoResponse,
)
from app.system_metrics import get_pi_metrics

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("main")


def _iso_utc(dt: datetime.datetime | None) -> str | None:
    """
    datetime ทุกตัวที่เก็บใน DB เป็น UTC จริง แต่เป็น naive (ไม่มี tzinfo) เพราะ SQLite ไม่รองรับ
    timezone-aware column ดีนัก (ตั้งใจไม่แตะ database.py — ความเสี่ยงสูงกว่าประโยชน์ที่ได้)

    ปัญหาเดิม: .isoformat() ตรงๆ บน naive datetime ได้ string ไม่มี timezone suffix เช่น
    "2026-08-05T10:00:00" — ฝั่งเว็บ (`new Date(...)`) ตีความ string แบบนี้เป็น "เวลา local
    ของเครื่องที่เปิดเว็บ" ไม่ใช่ UTC ตามสเปก ISO 8601/JS ทำให้เวลาที่แสดงเพี้ยนไป 7 ชม. (UTC+7)

    แก้ที่ชั้น serialize นี้ที่เดียว: แปะ tzinfo=UTC ก่อน isoformat() ได้ string ลงท้าย "+00:00"
    ฝั่งเว็บจะตีความถูกเป็น UTC แล้วแปลงเป็นเวลา local ของเบราว์เซอร์ให้เองอัตโนมัติ
    """
    if dt is None:
        return None
    return dt.replace(tzinfo=datetime.timezone.utc).isoformat()



def _link_group_id(key, event_type_id: int) -> int | None:
    """กลุ่มที่ผูกไว้เฉพาะคู่ (อุปกรณ์นี้ + เหตุการณ์นี้) — None = ใช้กลุ่มเริ่มต้นของเหตุการณ์"""
    for link in key.event_type_links:
        if link.event_type_id == event_type_id:
            return link.group_id
    return None


def _link_group_name(db: Session, key, event_type_id: int) -> str | None:
    gid = _link_group_id(key, event_type_id)
    if gid is None:
        return None
    group = contacts_service.get_group(db, gid)
    return group.name if group else None


app = FastAPI(
    title="4G Automated Voice Notification Gateway",
    description="Self-hosted Robo-calling Gateway สำหรับแจ้งเตือนเหตุฉุกเฉินผ่านสาย 4G (GSM, SIM ตัวเดียว)",
    # บั๊มทุกครั้งที่แก้อะไรที่ผู้ใช้เห็นผล — ดูคู่กับ app_git_sha ที่มาจาก git โดยตรง
    # 0.4.0: ปุ่มรีสตาร์ทโมดูล, ค่าการโทรบันทึกอัตโนมัติ, มิเตอร์ Pi, สำรอง DB อัตโนมัติ,
    #        แก้ DB หายตอน deploy, แก้ธีมกระพริบ, การ์ดติดตามสัญญาณในหน้าคิว
    version="0.4.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.dashboard_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def verify_api_key(x_api_key: str = Header(...), db: Session = Depends(get_db)):
    """
    ใช้กับ endpoint ที่ระบบภายนอก (บอร์ด/monitoring) ยิงเข้ามา (ไม่ใช่ dashboard)
    คืนตัว ApiKey เพราะ /notify ต้องรู้ว่าอุปกรณ์ไหนยิงเข้ามา และยิงอะไรได้บ้าง
    """
    api_key = api_key_service.verify_and_touch(db, x_api_key)
    if api_key is None:
        raise HTTPException(status_code=401, detail="API key ไม่ถูกต้อง หรืออุปกรณ์นี้ถูกลบออกจากระบบแล้ว")
    return api_key


@app.on_event("startup")
def on_startup():
    init_db()  # alembic upgrade head — สร้าง schema ให้ครบ/อัปเกรดให้ตรงกับโค้ดก่อนรับ request แรก

    drift = detect_schema_drift()
    if drift:
        # ไม่ raise เพื่อไม่ให้ dashboard ล่มทั้งตัว แต่ log ระดับ ERROR ให้เห็นชัด
        # เพราะ drift แบบนี้จะไปโผล่เป็น OperationalError: no such column ตอน user ยิง request
        logger.error(
            "Schema ใน DB ไม่ตรงกับ model ในโค้ด (%s จุด) — น่าจะแก้ model แล้วลืมสร้าง revision: %s\n"
            "แก้ด้วย: alembic revision --autogenerate -m \"<อธิบายสิ่งที่เปลี่ยน>\" แล้ว restart",
            len(drift), drift,
        )

    # รัน call worker แบบ background thread แยกจาก API request/response cycle
    worker_thread = threading.Thread(target=run_worker_loop, daemon=True)
    worker_thread.start()
    logger.info("Call worker thread เริ่มทำงานแล้ว")


# ---------- Public: ระบบ/บอร์ดภายนอกยิงแจ้งเตือนเข้ามา (API key) ----------

def _resolve_and_enqueue(db: Session, request: NotifyRequest, api_key=None) -> CallJob:
    """
    ใช้ร่วมกันโดย /notify (API key = อุปกรณ์จริง) และ /test/notify (JWT = กดทดสอบจาก dashboard)
    api_key=None หมายถึงมาจาก dashboard ซึ่งข้ามการตรวจสิทธิ์เพราะคนกดคือผู้ดูแลระบบเอง
    """
    event_type = event_types_service.get_event_type_by_code(db, request.event_type_code)
    if event_type is None:
        raise HTTPException(status_code=404, detail=f"ไม่พบ event type '{request.event_type_code}'")
    if event_type.is_active != "true":
        raise HTTPException(status_code=400, detail=f"event type '{request.event_type_code}' ถูกปิดใช้งานอยู่")

    # อุปกรณ์ยิงได้เฉพาะการแจ้งเตือนที่ผูกไว้กับ key ของตัวเองเท่านั้น
    # ตอบ 403 (ไม่ใช่ 404) เพราะ key ถูกต้องจริง แค่ไม่มีสิทธิ์ — และไม่ปิดบังว่ามี event type นี้อยู่
    # เนื่องจากผู้ที่ถือ key เป็นอุปกรณ์ของเราเองที่ config ไว้ ไม่ใช่บุคคลภายนอกที่ไม่รู้จัก
    device_name = None
    if api_key is not None:
        allowed_ids = {e.id for e in api_key.allowed_event_types}
        if event_type.id not in allowed_ids:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"อุปกรณ์ '{api_key.name}' ไม่ได้รับอนุญาตให้ยิง event type "
                    f"'{request.event_type_code}' — เพิ่มสิทธิ์ได้ที่หน้า API Keys ใน dashboard"
                ),
            )
        device_name = api_key.name

    if request.message:
        message = request.message
    else:
        try:
            message = event_types_service.render_message(
                event_type.message_template, request.variables, device_name=device_name
            )
        except event_types_service.MissingTemplateVariableError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    # ── กลุ่มที่จะโทรหา: ของอุปกรณ์ตัวนี้ก่อน แล้วค่อยถอยไปกลุ่มเริ่มต้นของเหตุการณ์ ──
    # อุปกรณ์คนละตัวใช้เหตุการณ์เดียวกันแต่โทรหาคนละกลุ่มได้ (ปั๊มตึก A แจ้งช่างตึก A)
    # ถ้าไม่ได้ตั้งไว้เลยทั้งสองที่ = ยังตั้งค่าไม่ครบ ต้องบอกให้ชัดว่าต้องไปตั้งตรงไหน
    group = None
    if api_key is not None:
        link_group_id = api_key_service.group_for(api_key, event_type.id)
        if link_group_id is not None:
            group = contacts_service.get_group(db, link_group_id)
    if group is None:
        group = event_type.group
    if group is None:
        raise HTTPException(
            status_code=400,
            detail=(
                f"เหตุการณ์ '{event_type.code}' ยังไม่ได้ผูกกลุ่มผู้รับ — "
                "ตั้งได้ที่หน้าตั้งค่าอุปกรณ์ (เลือกกลุ่มข้างเหตุการณ์นี้)"
            ),
        )

    return enqueue_job(
        db,
        message=message,
        event_type_id=event_type.id,
        priority_group=group.name,
        api_key_id=api_key.id if api_key is not None else None,
        source_device=device_name,
    )


@app.post("/notify", response_model=NotifyResponse)
def notify(
    request: NotifyRequest,
    db: Session = Depends(get_db),
    api_key=Depends(verify_api_key),
):
    """รับแจ้งเตือนเหตุฉุกเฉินจากอุปกรณ์ภายนอก แล้วเข้าคิว FIFO เพื่อรอโทร"""
    job = _resolve_and_enqueue(db, request, api_key=api_key)
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
            created_at=_iso_utc(j.created_at),
        )
        for j in jobs
    ]
    state = worker_state.get_state()
    return QueueStatusResponse(
        total_pending=len(items),
        items=items,
        current_job_id=state.current_job_id,
        current_step=state.current_step,
        current_progress=state.current_progress,
    )


@app.get("/config", response_model=AppConfigResponse)
def get_config(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """ดึง config ปัจจุบัน (retry/timeout) — แก้ได้ผ่าน dashboard ไม่ต้องแตะ .env"""
    return AppConfigResponse(**get_masked_config(db))


@app.put("/config", response_model=AppConfigResponse)
def update_config(
    request: AppConfigUpdateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    """
    แก้ config ผ่าน dashboard — ส่งเฉพาะ field ที่ต้องการเปลี่ยน
    worker จะเห็นค่าใหม่เองภายในไม่กี่วินาที ไม่ต้อง restart (ดู call_worker.run_worker_loop)
    """
    update_app_settings(db, **request.model_dump(exclude_unset=True))
    return AppConfigResponse(**get_masked_config(db))


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/system/info", response_model=SystemInfoResponse)
def system_info(_user: str = Depends(get_current_user)):
    """สถานะรันไทม์ของระบบ (Overview → System Info) — worker uptime, GSM, ขนาด DB"""
    state = worker_state.get_state()

    # นับไฟล์พ่วงของโหมด WAL ด้วย ไม่ใช่แค่ .db
    #
    # โหมด WAL เขียนของใหม่ลง .db-wal ก่อน แล้วค่อยยุบเข้า .db เป็นระยะ ช่วงที่โทรถี่ๆ
    # ไฟล์ -wal โตได้ถึงหลาย MB ก่อนถูกยุบ ถ้านับแค่ .db ตัวเลขบนหน้าเว็บจะต่ำกว่า
    # พื้นที่ที่ใช้จริงในจังหวะนั้น ซึ่งผิดวัตถุประสงค์ของการมีตัวเลขนี้
    # (มีไว้เฝ้าดูว่า SD card จะเต็มไหม)
    db_size_bytes = None
    db_path = settings.database_url.removeprefix("sqlite:///")
    if db_path and os.path.isfile(db_path):
        db_size_bytes = sum(
            os.path.getsize(p)
            for p in (db_path, f"{db_path}-wal", f"{db_path}-shm")
            if os.path.isfile(p)
        )

    return SystemInfoResponse(
        app_version=app.version,
        app_git_sha=settings.app_git_sha[:7],
        worker_started_at=_iso_utc(state.started_at),
        gsm_connected=state.gsm_connected,
        gsm_port=state.gsm_port,
        db_size_bytes=db_size_bytes,
    )


@app.get("/system/gsm", response_model=GsmDetailResponse)
def system_gsm(_user: str = Depends(get_current_user)):
    """รายละเอียด GSM module (mode/operator/signal) — ค่าจาก cache ที่ worker เช็คล่าสุดตอน idle"""
    state = worker_state.get_state()
    return GsmDetailResponse(
        connected=state.gsm_connected,
        signal_quality=state.gsm_signal_quality,
        operator=state.gsm_operator,
        network_mode=state.gsm_network_mode,
        port=state.gsm_port,
        updated_at=_iso_utc(state.gsm_status_updated_at),
        restarting=state.gsm_restarting,
        restart_result=state.gsm_restart_result,
        restart_at=_iso_utc(state.gsm_restart_at),
    )


@app.post("/system/gsm/restart", response_model=GsmRestartResponse, status_code=202)
def system_gsm_restart(_user: str = Depends(get_current_user)):
    """
    สั่งรีสตาร์ทโมดูล 4G (ปิด-เปิดคลื่นวิทยุ) — ใช้ตอนโมดูลค้าง/หาเครือข่ายไม่เจอ

    ตอบ 202 ทันทีโดยไม่รอให้เสร็จ เพราะขั้นตอนนี้กินเวลาถึง 30 วินาที ถ้ารอจะค้าง
    HTTP connection ไว้จนหมดเวลา timeout ของเบราว์เซอร์/Cloudflare ก่อนได้คำตอบ
    ให้หน้าเว็บ poll /system/gsm ดูค่า restarting/restart_result เอาแทน

    ตัวที่ลงมือทำจริงคือ call worker ไม่ใช่ request นี้ — พอร์ต serial เปิดได้ทีละ thread
    และ worker ถือไว้ตลอด ถ้าเขียนสวนเข้าไปคำสั่งสองชุดจะปนกันในสายเดียว
    worker จะหยิบไปทำในจังหวะที่ไม่มีสายค้างอยู่ จึงไม่ตัดสายที่กำลังคุยกันอยู่
    """
    if not worker_state.get_state().gsm_connected:
        raise HTTPException(status_code=409, detail="โมดูลยังไม่เชื่อมต่อ — รีสตาร์ทไม่ได้")
    if not worker_state.request_gsm_restart():
        return GsmRestartResponse(accepted=False, message="มีคำสั่งรีสตาร์ทค้างอยู่แล้ว รอให้รอบนี้เสร็จก่อน")
    return GsmRestartResponse(accepted=True, message="รับคำสั่งแล้ว โมดูลจะรีสตาร์ทภายในไม่กี่วินาที")


@app.get("/system/pi", response_model=PiDetailResponse)
def system_pi(_user: str = Depends(get_current_user)):
    """สถานะทรัพยากรเครื่อง Raspberry Pi (CPU/RAM/อุณหภูมิ) — อ่านสดทุกครั้งที่เรียก"""
    return PiDetailResponse(**get_pi_metrics())


# ---------- Dashboard: Groups / Contacts (escalation chain) ----------

def _group_to_response(group) -> GroupResponse:
    return GroupResponse(
        id=group.id, name=group.name, description=group.description, contact_count=len(group.contacts)
    )


def _contact_to_response(contact) -> ContactResponse:
    return ContactResponse(
        id=contact.id, group_id=contact.group_id, name=contact.name,
        phone_number=contact.phone_number, order_index=contact.order_index,
    )


@app.get("/groups", response_model=list[GroupResponse])
def list_groups(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    return [_group_to_response(g) for g in contacts_service.list_groups(db)]


@app.post("/groups", response_model=GroupResponse)
def create_group(
    request: GroupCreateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    group = contacts_service.create_group(db, name=request.name, description=request.description)
    return _group_to_response(group)


@app.put("/groups/{group_id}", response_model=GroupResponse)
def update_group(
    group_id: int, request: GroupUpdateRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    group = contacts_service.update_group(db, group_id, name=request.name, description=request.description)
    if group is None:
        raise HTTPException(status_code=404, detail="ไม่พบกลุ่มนี้")
    return _group_to_response(group)


@app.delete("/groups/{group_id}", status_code=204)
def delete_group(group_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    try:
        deleted = contacts_service.delete_group(db, group_id)
    except contacts_service.GroupInUseError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="ไม่พบกลุ่มนี้")


@app.get("/groups/{group_id}/contacts", response_model=list[ContactResponse])
def list_contacts(group_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    return [_contact_to_response(c) for c in contacts_service.list_contacts(db, group_id)]


@app.post("/groups/{group_id}/contacts", response_model=ContactResponse)
def create_contact(
    group_id: int, request: ContactCreateRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    contact = contacts_service.create_contact(
        db, group_id=group_id, phone_number=request.phone_number, name=request.name
    )
    return _contact_to_response(contact)


@app.put("/contacts/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: int, request: ContactUpdateRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    contact = contacts_service.update_contact(
        db, contact_id, phone_number=request.phone_number, name=request.name
    )
    if contact is None:
        raise HTTPException(status_code=404, detail="ไม่พบเบอร์ติดต่อนี้")
    return _contact_to_response(contact)


@app.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    if not contacts_service.delete_contact(db, contact_id):
        raise HTTPException(status_code=404, detail="ไม่พบเบอร์ติดต่อนี้")


@app.put("/groups/{group_id}/contacts/reorder", response_model=list[ContactResponse])
def reorder_contacts(
    group_id: int, request: ContactReorderRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    contacts = contacts_service.reorder_contacts(db, group_id, request.ordered_ids)
    return [_contact_to_response(c) for c in contacts]


# ---------- Dashboard: Event Types ----------

def _event_type_to_response(event_type) -> EventTypeResponse:
    return EventTypeResponse(
        id=event_type.id, code=event_type.code, display_name=event_type.display_name,
        message_template=event_type.message_template, group_id=event_type.group_id,
        group_name=event_type.group.name if event_type.group else None,
        is_active=event_type.is_active == "true",
    )


@app.get("/event-types", response_model=list[EventTypeResponse])
def list_event_types(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    return [_event_type_to_response(e) for e in event_types_service.list_event_types(db)]


@app.post("/event-types", response_model=EventTypeResponse)
def create_event_type(
    request: EventTypeCreateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    try:
        event_type = event_types_service.create_event_type(
            db, code=request.code, display_name=request.display_name,
            message_template=request.message_template, group_id=request.group_id,
        )
    except event_types_service.DuplicateEventTypeCodeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _event_type_to_response(event_type)


@app.put("/event-types/{event_type_id}", response_model=EventTypeResponse)
def update_event_type(
    event_type_id: int, request: EventTypeUpdateRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    event_type = event_types_service.update_event_type(db, event_type_id, **request.model_dump(exclude_unset=True))
    if event_type is None:
        raise HTTPException(status_code=404, detail="ไม่พบ event type นี้")
    return _event_type_to_response(event_type)


@app.delete("/event-types/{event_type_id}", status_code=204)
def delete_event_type(
    event_type_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    if not event_types_service.delete_event_type(db, event_type_id):
        raise HTTPException(status_code=404, detail="ไม่พบ event type นี้")


# ---------- Dashboard: API Keys (สำหรับระบบภายนอกยิง /notify) ----------

def _api_key_to_response(api_key) -> ApiKeyResponse:
    return ApiKeyResponse(
        id=api_key.id, name=api_key.name, key_prefix=api_key.key_prefix,
        is_active=api_key.is_active == "true",
        last_used_at=_iso_utc(api_key.last_used_at),
        created_at=_iso_utc(api_key.created_at),
        revoked_at=_iso_utc(api_key.revoked_at),
        allowed_event_types=[
            ApiKeyEventTypeRef(
                id=e.id,
                code=e.code,
                display_name=e.display_name,
                group_id=_link_group_id(key, e.id),
                group_name=_link_group_name(db, key, e.id),
            )
            for e in api_key.allowed_event_types
        ],
    )


@app.get("/api-keys", response_model=list[ApiKeyResponse])
def list_api_keys(db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    return [_api_key_to_response(k) for k in api_key_service.list_api_keys(db)]


@app.post("/api-keys", response_model=ApiKeyCreateResponse)
def create_api_key(
    request: ApiKeyCreateRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    """สร้าง key ประจำอุปกรณ์ 1 ตัว — plaintext แสดงครั้งเดียวตรงนี้ เอาไปฝังใน firmware"""
    try:
        api_key, plaintext = api_key_service.create_api_key(
            db, name=request.name, event_type_ids=request.event_type_ids
        )
    except api_key_service.UnknownEventTypeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    base = _api_key_to_response(api_key)
    return ApiKeyCreateResponse(**base.model_dump(), plaintext_key=plaintext)


@app.put("/api-keys/{key_id}", response_model=ApiKeyResponse)
def update_api_key(
    key_id: int, request: ApiKeyUpdateRequest,
    db: Session = Depends(get_db), _user: str = Depends(get_current_user),
):
    """
    เปลี่ยนชื่ออุปกรณ์ / สิทธิ์การแจ้งเตือน โดย key เดิมยังใช้งานได้ต่อ
    (ย้ายบอร์ดไปติดตั้งที่อื่นแล้วเปลี่ยนชื่อที่นี่ ไม่ต้องเอาบอร์ดกลับมาแฟลชใหม่)
    """
    try:
        api_key = api_key_service.update_api_key(
            db, key_id,
            name=request.name,
            event_type_ids=request.event_type_ids,
            event_links=[l.model_dump() for l in request.event_links] if request.event_links is not None else None,
        )
    except api_key_service.UnknownEventTypeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if api_key is None:
        raise HTTPException(status_code=404, detail="ไม่พบ API key นี้")
    return _api_key_to_response(api_key)


@app.get("/api-keys/{key_id}/reveal", response_model=ApiKeyRevealResponse)
def reveal_api_key(key_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """
    ขอดู key เต็มของอุปกรณ์ (ต้องล็อกอิน dashboard ก่อน)

    key ถูกเก็บแบบเข้ารหัสด้วยกุญแจใน .env ไม่ใช่ plaintext — ดู app/crypto.py ว่าทำไม
    คืน key=null สำหรับอุปกรณ์ที่สร้างไว้ก่อนมีฟีเจอร์นี้ (ตอนนั้นเก็บแค่ hash)
    หน้าเว็บจะถอยไปแสดงแค่ตัวหน้าของ key และเสนอให้ออก key ใหม่
    """
    if not db.query(ApiKey).filter(ApiKey.id == key_id).first():
        raise HTTPException(status_code=404, detail="ไม่พบอุปกรณ์นี้")
    return ApiKeyRevealResponse(key=api_key_service.reveal_key(db, key_id))


@app.delete("/api-keys/{key_id}", status_code=204)
def delete_api_key(key_id: int, db: Session = Depends(get_db), _user: str = Depends(get_current_user)):
    """ลบอุปกรณ์ออกจากฐานข้อมูลจริง — ประวัติการโทรเดิมยังอยู่ครบ (ดู api_key_service.delete_api_key)"""
    if not api_key_service.delete_api_key(db, key_id):
        raise HTTPException(status_code=404, detail="ไม่พบ API key นี้")


# ---------- Dashboard: ทดสอบยิงแจ้งเตือนจากหน้าเว็บ (JWT ไม่ใช่ API key) ----------

@app.post("/test/notify", response_model=NotifyResponse)
def test_notify(
    request: NotifyRequest, db: Session = Depends(get_db), _user: str = Depends(get_current_user)
):
    """เข้าคิวจริงเหมือน /notify ทุกประการ ใช้สำหรับกดทดสอบจากหน้า Event Types โดยไม่ต้องยิง API ภายนอก"""
    job = _resolve_and_enqueue(db, request)
    return NotifyResponse(job_id=job.id, status=job.status.value)


# ---------- Dashboard: ประวัติการโทร (real data, พร้อม filter + pagination) ----------

@app.get("/history", response_model=HistoryResponse)
def get_history(
    db: Session = Depends(get_db),
    _user: str = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    status: str | None = None,
    group_id: int | None = None,
    event_type_id: int | None = None,
    date_from: datetime.datetime | None = None,
    date_to: datetime.datetime | None = None,
    q: str | None = None,
):
    query = db.query(CallJob)

    if status:
        query = query.filter(CallJob.status == status)
    if event_type_id:
        query = query.filter(CallJob.event_type_id == event_type_id)
    if group_id:
        query = query.filter(CallJob.event_type.has(group_id=group_id))
    if date_from:
        query = query.filter(CallJob.created_at >= date_from)
    if date_to:
        query = query.filter(CallJob.created_at <= date_to)
    if q:
        query = query.filter(CallJob.message.ilike(f"%{q}%"))

    total_count = query.count()
    jobs = (
        query.order_by(CallJob.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    items = []
    for job in jobs:
        last_log = (
            db.query(CallLog)
            .filter(CallLog.job_id == job.id)
            .order_by(CallLog.timestamp.desc())
            .first()
        )
        items.append(HistoryItem(
            job_id=job.id,
            event_type_code=job.event_type.code if job.event_type else None,
            event_type_display_name=job.event_type.display_name if job.event_type else None,
            group_name=job.priority_group,
            source_device=job.source_device,
            message=job.message,
            status=job.status.value,
            retry_count=job.retry_count,
            contact_index=job.contact_index,
            created_at=_iso_utc(job.created_at),
            updated_at=_iso_utc(job.updated_at),
            last_result=last_log.result if last_log else None,
            last_phone_masked=last_log.phone_number_masked if last_log else None,
            last_detail=last_log.detail if last_log else None,
        ))

    return HistoryResponse(total_count=total_count, page=page, page_size=page_size, items=items)


# ---------- เสิร์ฟ frontend ที่ build แล้ว (Vite static bundle) ----------
# ไฟล์เหล่านี้ถูก build ด้วย GitHub Actions แล้ว copy เข้า container ตอน build image
# ไม่มี Node.js รันบน Pi เลย — ดู frontend/README.md และ Dockerfile
_FRONTEND_DIST = os.path.join(os.path.dirname(__file__), "..", "static")

# path ที่ต้องปล่อยให้ FastAPI จัดการเองเสมอ แม้เบราว์เซอร์จะขอเป็น HTML
# (เอกสาร API ต้องเปิดดูในเบราว์เซอร์ได้จริง ไม่ใช่โดนกลืนไปเป็นหน้าเว็บ dashboard)
_NON_SPA_PREFIXES = ("/assets", "/docs", "/redoc", "/openapi.json", "/health")

if os.path.isdir(_FRONTEND_DIST):
    app.mount("/assets", StaticFiles(directory=os.path.join(_FRONTEND_DIST, "assets")), name="assets")

    @app.middleware("http")
    async def spa_navigation(request: Request, call_next):
        """
        ส่ง index.html ให้ทุกครั้งที่ "เบราว์เซอร์เปิดหน้าเว็บ" ไม่ว่า path นั้นจะชนกับ API หรือไม่

        ── ปัญหาที่แก้ ────────────────────────────────────────────────────────
        หน้าเว็บกับ API ใช้ path ซ้ำกันอยู่ 3 คู่: /history, /event-types, /api-keys
        ตอนกดเมนูในเว็บไม่มีปัญหาเพราะ React Router เปลี่ยนหน้าเองฝั่ง client
        แต่พอผู้ใช้ "กด F5" หรือ "เปิด URL ตรงๆ" เบราว์เซอร์จะยิงมาที่เซิร์ฟเวอร์จริง
        แล้วไปโดน endpoint ของ API รับไปก่อน (ประกาศไว้ก่อน catch-all)
        ผลคือได้ JSON error แทนหน้าเว็บ:
            GET /history → 422 {"detail":[{"loc":["header","authorization"] ...}]}
        เพราะ API ตัวนั้นบังคับให้ส่ง header ยืนยันตัวตนมาด้วย ซึ่งการเปิด URL เปล่าๆ ไม่มี

        ── ทำไมแยกด้วย header Accept ──────────────────────────────────────────
        "เบราว์เซอร์เปิดหน้าเว็บ" กับ "โค้ดเรียก API" ต่างกันชัดเจนตรงนี้:
          - เปิดหน้าเว็บ/กด F5 → Accept: text/html,application/xhtml+xml,...
          - fetch() ในหน้าเว็บ  → Accept: */*   (ค่า default ของ fetch)
          - อุปกรณ์ยิง /notify   → เป็น POST ไม่ใช่ GET จึงไม่เข้าเงื่อนไขตั้งแต่แรก
        จึงไม่ต้องมีรายชื่อ route ของหน้าเว็บให้ต้องตามแก้ทุกครั้งที่เพิ่มหน้าใหม่
        (ซึ่งถ้าลืมแก้ก็จะกลับมาเจอบั๊กเดิมแบบเงียบๆ อีก)
        """
        if (
            request.method == "GET"
            and "text/html" in request.headers.get("accept", "")
            and not request.url.path.startswith(_NON_SPA_PREFIXES)
        ):
            return FileResponse(os.path.join(_FRONTEND_DIST, "index.html"))
        return await call_next(request)

    @app.get("/{full_path:path}")
    def serve_frontend(full_path: str):
        """SPA fallback — route ไหนที่ไม่ตรงกับ API ข้างบน ให้ส่ง index.html แล้วให้ React Router จัดการเอง"""
        index_path = os.path.join(_FRONTEND_DIST, "index.html")
        return FileResponse(index_path)
