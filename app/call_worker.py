"""
Call Worker — background loop ที่ดึงงานจากคิว FIFO มาโทรทีละสาย
รวม logic: Call State Monitoring, Retry, Escalation Chain, SMS Fallback

Config (เลือก backend, retry, Zadarma/AMI ฯลฯ) โหลดจาก dashboard (DB) ผ่าน config_service
ไม่ใช่จาก .env ตรงๆ อีกต่อไป — เพื่อให้ user เปลี่ยนได้จากหน้าเว็บโดยไม่ต้องแก้ไฟล์
หมายเหตุ: worker โหลด config ครั้งเดียวตอน start เท่านั้น — เปลี่ยนค่าผ่าน dashboard แล้ว
ต้อง restart worker process จึงจะมีผล (hot-reload เป็นแผนพัฒนาต่อในอนาคต)
"""
import logging
import threading
import time

from sqlalchemy.orm import Session

from app.call_backends import get_call_backend
from app.call_backends.base import CallBackend
from app.call_backends.gsm_backend import GSMBackend
from app.config import settings as env_settings  # ใช้แค่ contacts/escalation ที่ยังอยู่ใน .env
from app.config_service import EffectiveConfig, get_effective_config
from app.database import CallJob, CallLog, CallStatus, SessionLocal
from app.device_manager import get_active_devices
from app.queue_manager import claim_next_job, update_job_status
from app.tts_service import text_to_speech

logger = logging.getLogger("call_worker")


def _mask_number(number: str) -> str:
    """เก็บ log แบบ mask บางส่วนของเบอร์ เพื่อไม่ให้เบอร์เต็มโผล่ใน log แบบเปิดเผย"""
    if len(number) <= 4:
        return "*" * len(number)
    return number[:3] + "*" * (len(number) - 6) + number[-3:]


def _log_attempt(db: Session, job: CallJob, phone_number: str, result: str, detail: str = ""):
    db.add(CallLog(
        job_id=job.id,
        phone_number_masked=_mask_number(phone_number),
        result=result,
        detail=detail,
    ))
    db.commit()


def process_job(
    db: Session, job: CallJob, backend: CallBackend, sms_backend: CallBackend | None, cfg: EffectiveConfig
):
    """
    ประมวลผลงานโทร 1 รายการตาม state machine:
    QUEUED/RETRYING -> dial -> CONNECTED / NO_ANSWER / BUSY
        CONNECTED -> stream audio -> DONE
        NO_ANSWER/BUSY -> retry (ถ้ายังไม่ครบรอบ) -> escalate (เบอร์ถัดไป) -> sms fallback

    backend: ตัวที่ใช้โทรจริง (GSM หรือ VoIP ตาม config จาก dashboard)
    sms_backend: ตัวที่ใช้ส่ง SMS fallback — ปัจจุบันมีแค่ GSM ที่รองรับ ถ้า backend หลักเป็น VoIP
                 จะพยายามใช้ GSM แยกต่างหาก (ถ้ามีโมดูลเสียบอยู่จริง)
    cfg: ค่า retry/timeout ที่ตั้งผ่าน dashboard
    """
    # หมายเหตุ: escalation contacts ยังอยู่ใน .env (ยังไม่ย้ายเข้า dashboard ในรอบนี้)
    contacts = env_settings.get_contacts(job.priority_group)
    if not contacts:
        logger.error("ไม่มีเบอร์ติดต่อสำหรับกลุ่ม %s", job.priority_group)
        update_job_status(db, job, CallStatus.FAILED)
        return

    if job.contact_index >= len(contacts):
        # escalation chain หมดแล้ว ยังไม่สำเร็จ -> SMS fallback ไปเบอร์แรก
        _try_sms_fallback(db, job, contacts[0], sms_backend, cfg)
        return

    current_number = contacts[job.contact_index]

    audio_path = text_to_speech(job.message)

    result = backend.dial(current_number)
    _log_attempt(db, job, current_number, f"{backend.name}:{result}")

    if result == "connected":
        try:
            backend.stream_audio(audio_path)
        finally:
            backend.hangup()
        update_job_status(db, job, CallStatus.CONNECTED)
        logger.info("Job %s [%s]: โทรติดและเล่นข้อความสำเร็จ", job.id, backend.name)
        return

    # ไม่รับสาย หรือสายไม่ว่าง
    status_map = {"no_answer": CallStatus.NO_ANSWER, "busy": CallStatus.BUSY}
    update_job_status(db, job, status_map.get(result, CallStatus.NO_ANSWER))

    if job.retry_count < cfg.call_retry_count:
        # ยังไม่ครบจำนวน retry -> รอแล้วโทรซ้ำเบอร์เดิม
        logger.info(
            "Job %s [%s]: เบอร์ %s ไม่รับสาย รอ %s วิ แล้ว retry (%s/%s)",
            job.id, backend.name, _mask_number(current_number),
            cfg.call_retry_delay_seconds,
            job.retry_count + 1, cfg.call_retry_count,
        )
        time.sleep(cfg.call_retry_delay_seconds)
        update_job_status(
            db, job, CallStatus.RETRYING, retry_count=job.retry_count + 1
        )
    else:
        # ครบรอบ retry แล้ว -> escalate ไปเบอร์ถัดไป
        logger.info(
            "Job %s [%s]: ครบรอบ retry แล้ว escalate ไปเบอร์ถัดไป (index %s -> %s)",
            job.id, backend.name, job.contact_index, job.contact_index + 1,
        )
        update_job_status(
            db, job, CallStatus.ESCALATED,
            contact_index=job.contact_index + 1,
            retry_count=0,
        )


def _try_sms_fallback(
    db: Session, job: CallJob, phone_number: str, sms_backend: CallBackend | None, cfg: EffectiveConfig
):
    if not cfg.sms_fallback_enabled:
        update_job_status(db, job, CallStatus.FAILED)
        return

    if sms_backend is None or not sms_backend.supports_sms:
        logger.error(
            "Job %s: ไม่มี backend ที่ส่ง SMS ได้ในสถานะปัจจุบัน (เช่น กำลังทดสอบ VoIP-only "
            "โดยไม่ได้เสียบโมดูล GSM) — ต้องแจ้งเตือนแอดมินด้วยช่องทางอื่น", job.id,
        )
        update_job_status(db, job, CallStatus.FAILED)
        return

    # ข้อความสั้น EN+TH ปน ไม่เกินความยาวที่กำหนด (default 70 ตัวอักษร)
    sms_text = f"[ALERT] {job.message}"
    success = sms_backend.send_sms(phone_number, sms_text)
    _log_attempt(db, job, phone_number, "sms_fallback", detail=sms_text)

    if success:
        update_job_status(db, job, CallStatus.SMS_FALLBACK_SENT)
        logger.info("Job %s: ส่ง SMS fallback สำเร็จ", job.id)
    else:
        update_job_status(db, job, CallStatus.FAILED)
        logger.error("Job %s: ส่ง SMS fallback ไม่สำเร็จ - ต้องแจ้งเตือนแอดมิน", job.id)


def _gsm_device_worker(
    device_id: int, backend: GSMBackend, sms_backend: CallBackend | None, cfg: EffectiveConfig, poll_interval: float
):
    """Loop ของ worker 1 ตัว ผูกกับ SIM device 1 ตัว — แย่งงานจากคิวเดียวกันกับตัวอื่น (atomic claim)"""
    logger.info("Worker สำหรับ device #%s (%s) เริ่มทำงาน", device_id, backend.label)
    while True:
        db = SessionLocal()
        try:
            job = claim_next_job(db, device_id=device_id)
            if job:
                process_job(db, job, backend, sms_backend, cfg)
            else:
                time.sleep(poll_interval)
        except Exception:
            logger.exception("Worker device #%s เจอ error ไม่คาดคิด", device_id)
            time.sleep(poll_interval)
        finally:
            db.close()


def run_gsm_pool(cfg: EffectiveConfig, poll_interval: float = 3.0):
    """
    Multi-SIM pool — spawn 1 thread ต่อ 1 SIM device ที่ลงทะเบียนไว้ใน dashboard/DB
    ทุก thread แย่งงานจากคิว FIFO เดียวกัน (claim_next_job กันชนกันด้วย lock)
    ถ้ายังไม่มี device ลงทะเบียนเลย จะ fallback ไปใช้ค่า default เดี่ยวจาก .env (dev/testing)
    """
    db = SessionLocal()
    try:
        devices = get_active_devices(db)
    finally:
        db.close()

    if not devices:
        logger.warning(
            "ยังไม่มี SIM device ลงทะเบียนใน dashboard — ใช้ค่า default เดี่ยวจาก .env แทน "
            "(ไปที่หน้า Devices ใน dashboard เพื่อเพิ่ม SIM ตัวแรก)"
        )
        backend = GSMBackend()
        backend.connect()
        _gsm_device_worker(device_id=0, backend=backend, sms_backend=backend, cfg=cfg, poll_interval=poll_interval)
        return

    threads = []
    for device in devices:
        backend = GSMBackend(serial_port=device.serial_port, baudrate=device.baudrate, label=device.label)
        try:
            backend.connect()
        except Exception as exc:
            logger.error("เชื่อมต่อ device #%s (%s) ไม่สำเร็จ: %s — ข้ามตัวนี้ไปก่อน", device.id, device.label, exc)
            continue
        thread = threading.Thread(
            target=_gsm_device_worker,
            kwargs={
                "device_id": device.id, "backend": backend, "sms_backend": backend,
                "cfg": cfg, "poll_interval": poll_interval,
            },
            daemon=True,
        )
        threads.append(thread)
        thread.start()

    if not threads:
        logger.error("ไม่มี SIM device ตัวไหนเชื่อมต่อสำเร็จเลย — worker pool หยุดทำงาน")
        return

    for thread in threads:
        thread.join()


def run_voip_worker(cfg: EffectiveConfig, poll_interval: float = 3.0):
    """
    Single worker สำหรับ VoIP backend (Zadarma trunk เดียว ไม่ทำ pool)
    ถ้าต้องการ SMS fallback จะพยายามเปิด GSM แยกไว้ (ถ้าเสียบโมดูลไว้จริง)
    """
    backend = get_call_backend(cfg)
    backend.connect()
    logger.info("Call worker เริ่มทำงานด้วย backend: %s", backend.name)

    sms_backend: CallBackend | None = backend if backend.supports_sms else None
    if sms_backend is None:
        try:
            candidate = GSMBackend()
            candidate.connect()
            sms_backend = candidate
            logger.info("เปิด GSM backend แยกสำหรับ SMS fallback สำเร็จ")
        except Exception as exc:
            logger.warning(
                "ไม่สามารถเปิด GSM backend สำหรับ SMS fallback ได้ (%s) — "
                "SMS fallback จะใช้ไม่ได้ในรอบทดสอบนี้", exc,
            )
            sms_backend = None

    try:
        while True:
            db = SessionLocal()
            try:
                job = claim_next_job(db)
                if job:
                    process_job(db, job, backend, sms_backend, cfg)
                else:
                    time.sleep(poll_interval)
            finally:
                db.close()
    finally:
        backend.disconnect()
        if sms_backend is not None and sms_backend is not backend:
            sms_backend.disconnect()


def run_worker_loop(poll_interval: float = 3.0):
    """
    Entry point — โหลด config จาก dashboard (DB) แล้วเลือกว่าจะรัน multi-SIM pool (gsm)
    หรือ single worker (voip)
    """
    db = SessionLocal()
    try:
        cfg = get_effective_config(db)
    finally:
        db.close()

    logger.info("Call worker เริ่มทำงานด้วย call_backend='%s' (ตั้งค่าจาก dashboard)", cfg.call_backend)

    if cfg.call_backend.lower() == "gsm":
        run_gsm_pool(cfg, poll_interval)
    else:
        run_voip_worker(cfg, poll_interval)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker_loop()
