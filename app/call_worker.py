"""
Call Worker — background loop ที่ดึงงานจากคิว FIFO มาโทรทีละสาย (SIM ตัวเดียว)
รวม logic: Call State Monitoring, Retry, Escalation Chain, SMS Fallback

เวอร์ชันนี้ตัด multi-SIM pool/VoIP backend ออก (ดู branch feature/voip-multi-sim
ถ้าต้องการกลับไปใช้ระบบหลาย SIM หรือ Asterisk/Zadarma)

Config (retry/timeout/SMS fallback) โหลดจาก dashboard (DB) ผ่าน config_service
ไม่ใช่จาก .env ตรงๆ — เพื่อให้ user เปลี่ยนได้จากหน้าเว็บโดยไม่ต้องแก้ไฟล์
worker เช็ค AppSettings.updated_at เป็นระยะ (ทุก config_check_interval วิ) ถ้าเปลี่ยนจะโหลด config
ใหม่อัตโนมัติ ไม่ต้อง restart process (ดู run_worker_loop)

เบอร์ escalation มาจากตาราง groups/contacts ผ่าน contacts_service — ถ้า job เก่า (ก่อน migration)
ไม่มี event_type_id จะ fallback ไปอ่านจาก .env ตามกลไกเดิมเพื่อไม่ให้ job ค้างคาพัง
"""
import logging
import time

from sqlalchemy.orm import Session

from app.config import settings as env_settings  # ใช้แค่ fallback ของ job เก่าก่อน migration
from app.config_service import EffectiveConfig, get_effective_config, get_or_create_app_settings
from app.contacts_service import get_ordered_phone_numbers
from app.database import CallJob, CallLog, CallStatus, SessionLocal
from app.gsm_module import GSMModule
from app.queue_manager import claim_next_job, update_job_status
from app.tts_service import text_to_speech
from app import worker_state

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


def process_job(db: Session, job: CallJob, gsm: GSMModule, cfg: EffectiveConfig):
    """
    ประมวลผลงานโทร 1 รายการตาม state machine:
    QUEUED/RETRYING -> dial -> CONNECTED / NO_ANSWER / BUSY
        CONNECTED -> stream audio -> DONE
        NO_ANSWER/BUSY -> retry (ถ้ายังไม่ครบรอบ) -> escalate (เบอร์ถัดไป) -> sms fallback
    """
    if job.event_type_id is not None and job.event_type is not None:
        contacts = get_ordered_phone_numbers(db, job.event_type.group_id)
    else:
        logger.warning(
            "Job %s: ไม่มี event_type_id (job เก่าก่อน migration) ใช้ .env fallback สำหรับ '%s'",
            job.id, job.priority_group,
        )
        contacts = env_settings.get_contacts(job.priority_group)

    if not contacts:
        logger.error("ไม่มีเบอร์ติดต่อสำหรับกลุ่ม %s", job.priority_group)
        update_job_status(db, job, CallStatus.FAILED)
        return

    if job.contact_index >= len(contacts):
        # escalation chain หมดแล้ว ยังไม่สำเร็จ -> SMS fallback ไปเบอร์แรก
        _try_sms_fallback(db, job, contacts[0], gsm, cfg)
        return

    current_number = contacts[job.contact_index]
    audio_path = text_to_speech(job.message)

    result = gsm.dial(current_number)
    _log_attempt(db, job, current_number, result)

    if result == "connected":
        try:
            gsm.stream_audio(audio_path)
        finally:
            gsm.hangup()
        update_job_status(db, job, CallStatus.CONNECTED)
        logger.info("Job %s: โทรติดและเล่นข้อความสำเร็จ", job.id)
        return

    # ไม่รับสาย หรือสายไม่ว่าง
    status_map = {"no_answer": CallStatus.NO_ANSWER, "busy": CallStatus.BUSY}
    update_job_status(db, job, status_map.get(result, CallStatus.NO_ANSWER))

    if job.retry_count < cfg.call_retry_count:
        logger.info(
            "Job %s: เบอร์ %s ไม่รับสาย รอ %s วิ แล้ว retry (%s/%s)",
            job.id, _mask_number(current_number),
            cfg.call_retry_delay_seconds,
            job.retry_count + 1, cfg.call_retry_count,
        )
        time.sleep(cfg.call_retry_delay_seconds)
        update_job_status(
            db, job, CallStatus.RETRYING, retry_count=job.retry_count + 1
        )
    else:
        logger.info(
            "Job %s: ครบรอบ retry แล้ว escalate ไปเบอร์ถัดไป (index %s -> %s)",
            job.id, job.contact_index, job.contact_index + 1,
        )
        update_job_status(
            db, job, CallStatus.ESCALATED,
            contact_index=job.contact_index + 1,
            retry_count=0,
        )


def _try_sms_fallback(db: Session, job: CallJob, phone_number: str, gsm: GSMModule, cfg: EffectiveConfig):
    if not cfg.sms_fallback_enabled:
        update_job_status(db, job, CallStatus.FAILED)
        return

    sms_text = f"[ALERT] {job.message}"
    success = gsm.send_sms(phone_number, sms_text)
    _log_attempt(db, job, phone_number, "sms_fallback", detail=sms_text)

    if success:
        update_job_status(db, job, CallStatus.SMS_FALLBACK_SENT)
        logger.info("Job %s: ส่ง SMS fallback สำเร็จ", job.id)
    else:
        update_job_status(db, job, CallStatus.FAILED)
        logger.error("Job %s: ส่ง SMS fallback ไม่สำเร็จ - ต้องแจ้งเตือนแอดมิน", job.id)


def _poll_gsm_status(gsm: GSMModule):
    """เช็คสัญญาณ/operator/network mode ของ GSM module — เรียกเฉพาะตอน idle เท่านั้น
    เพื่อไม่ให้ AT command ของการเช็คสถานะไปแทรกกลางขั้นตอนโทร/ส่ง SMS ที่ใช้ serial port เดียวกัน"""
    try:
        signal = gsm.get_signal_quality()
        operator, mode = gsm.get_operator_info()
        worker_state.set_gsm_status(signal, operator, mode)
    except Exception:
        logger.warning("ดึงสถานะสัญญาณ GSM ไม่สำเร็จ", exc_info=True)


def run_worker_loop(poll_interval: float = 3.0, config_check_interval: float = 10.0, gsm_status_interval: float = 30.0):
    """
    Main loop — รันแบบ background thread แยกจาก API server (SIM ตัวเดียว, ไม่มี pool)
    Config (retry/timeout) โหลดจาก dashboard (DB) ตอน start แล้วเช็คซ้ำทุก config_check_interval วิ
    เพื่อ hot-reload อัตโนมัติเมื่อมีคนแก้ผ่าน dashboard (PUT /config) โดยไม่ต้อง restart

    เช็คสัญญาณ/operator ของ GSM ทุก gsm_status_interval วิ (เฉพาะตอนคิวว่าง) ไว้โชว์ในหน้า Overview
    """
    db = SessionLocal()
    try:
        cfg = get_effective_config(db)
        cfg_updated_at = get_or_create_app_settings(db).updated_at
    finally:
        db.close()

    last_cfg_check = time.monotonic()
    last_gsm_status_check = 0.0  # บังคับให้เช็คทันทีตอน start

    worker_state.mark_started()
    gsm = GSMModule()
    gsm.connect()
    worker_state.set_gsm_connected(True, gsm.port)
    logger.info("Call worker เริ่มทำงาน โดยเชื่อมต่อโมดูลที่ %s", gsm.port)

    try:
        while True:
            db = SessionLocal()
            try:
                now = time.monotonic()
                if now - last_cfg_check >= config_check_interval:
                    last_cfg_check = now
                    row = get_or_create_app_settings(db)
                    if row.updated_at != cfg_updated_at:
                        cfg = get_effective_config(db)
                        cfg_updated_at = row.updated_at
                        logger.info("Config reloaded จาก dashboard (updated_at=%s)", cfg_updated_at)

                job = claim_next_job(db)
                if job:
                    process_job(db, job, gsm, cfg)
                else:
                    now = time.monotonic()
                    if now - last_gsm_status_check >= gsm_status_interval:
                        last_gsm_status_check = now
                        _poll_gsm_status(gsm)
                    time.sleep(poll_interval)
            finally:
                db.close()
    finally:
        worker_state.set_gsm_connected(False)
        gsm.disconnect()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker_loop()
