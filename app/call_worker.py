"""
Call Worker — background loop ที่ดึงงานจากคิว FIFO มาโทรทีละสาย (SIM ตัวเดียว)
รวม logic: Call State Monitoring, Retry, Escalation Chain

เวอร์ชันนี้ตัด multi-SIM pool/VoIP backend ออก (ดู branch feature/voip-multi-sim
ถ้าต้องการกลับไปใช้ระบบหลาย SIM หรือ Asterisk/Zadarma) และตัด SMS fallback ออกแล้ว
(6 ส.ค. 2569 — ตัดสินใจเอาแค่โทร ไม่ส่ง SMS สำรอง ดู LIMITATIONS.md) ครบ escalation chain
แล้วยังไม่มีใครรับสาย = FAILED ตรงๆ

Config (retry/timeout) โหลดจาก dashboard (DB) ผ่าน config_service
ไม่ใช่จาก .env ตรงๆ — เพื่อให้ user เปลี่ยนได้จากหน้าเว็บโดยไม่ต้องแก้ไฟล์
worker เช็ค AppSettings.updated_at เป็นระยะ (ทุก config_check_interval วิ) ถ้าเปลี่ยนจะโหลด config
ใหม่อัตโนมัติ ไม่ต้อง restart process (ดู run_worker_loop)

เบอร์ escalation มาจากตาราง groups/contacts ผ่าน contacts_service — ถ้า job เก่า (ก่อน migration)
ไม่มี event_type_id จะ fallback ไปอ่านจาก .env ตามกลไกเดิมเพื่อไม่ให้ job ค้างคาพัง
"""
import datetime
import json
import logging
import time

from sqlalchemy.orm import Session

from app.config import settings as env_settings  # ใช้แค่ fallback ของ job เก่าก่อน migration
from app.config_service import EffectiveConfig, get_effective_config, get_or_create_app_settings
from app.contacts_service import get_ordered_phone_numbers
from app.database import CallJob, CallLog, CallStatus, SessionLocal
from app.gsm_module import UART_PORT, GSMModule
from app.gsm_power import GsmPower
from app.queue_manager import claim_next_job, recover_orphaned_jobs, update_job_status
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


def _phones_from_snapshot(job) -> list[str] | None:
    """
    เบอร์ตามลำดับไล่สายจาก call_jobs.recipients — None = งานนี้ไม่มี snapshot (งานเก่า)

    แยก None ออกจาก [] ให้ชัด เพราะสองอย่างนี้ต้องทำคนละแบบ: None แปลว่า "ไม่มีข้อมูล
    ให้ถอยไปหาทางอื่น" ส่วน [] แปลว่า "ตัดสินใจแล้วว่าไม่มีใครให้โทร" ซึ่งต้องจบเป็น failed
    ไม่ใช่ไปเดาเบอร์จากที่อื่นมาโทรแทน

    JSON ที่พังถือเป็นไม่มี snapshot — ไม่ปล่อยให้ exception ล้มทั้ง worker thread
    เพราะงานเดียวที่ข้อมูลเสียไม่ควรทำให้ทั้งคิวหยุดเดิน
    """
    if not job.recipients:
        return None
    try:
        rows = json.loads(job.recipients)
        return [r["phone"] for r in rows if r.get("phone")]
    except (ValueError, TypeError, AttributeError, KeyError):
        logger.exception("Job %s: อ่าน recipients ไม่ได้ ถอยไปใช้ข้อมูลกลุ่มแทน", job.id)
        return None


def process_job(db: Session, job: CallJob, gsm: GSMModule, cfg: EffectiveConfig):
    """
    ประมวลผลงานโทร 1 รายการตาม state machine:
    QUEUED/RETRYING -> dial -> CONNECTED / NO_ANSWER / BUSY
        CONNECTED -> stream audio -> DONE
        NO_ANSWER/BUSY -> retry (ถ้ายังไม่ครบรอบ) -> escalate (เบอร์ถัดไป) -> ครบทุกเบอร์แล้ว -> FAILED
    """
    # ── เบอร์ที่จะโทร: อ่านจาก snapshot ที่ติดมากับงาน (call_jobs.recipients) ──────
    # ห้ามกลับไปอ่านกลุ่มสดๆ ตรงนี้เป็นตัวหลัก เหตุผลอยู่ที่ docstring ของ CallJob.recipients
    # โดยย่อ: ผู้รับอาจไม่ได้มาจากกลุ่มเลย (เลือกเบอร์เองรายตัว) และการอ่านสดทำให้
    # งานที่กำลังไล่สายอยู่เปลี่ยนผู้รับกลางคันถ้ามีคนแก้กลุ่มพอดี
    contacts = _phones_from_snapshot(job)
    if contacts is None and job.group_id is not None:
        # งานเก่าที่เข้าคิวไว้ก่อนมีคอลัมน์ recipients — ถอยไปอ่านจากกลุ่มตามเดิม
        logger.warning("Job %s: ไม่มี recipients (งานเก่า) ถอยไปอ่านเบอร์จากกลุ่ม", job.id)
        contacts = get_ordered_phone_numbers(db, job.group_id)
    elif contacts is None:
        logger.warning(
            "Job %s: ไม่มีทั้ง recipients และ group_id (job เก่าก่อน migration) ใช้ .env fallback สำหรับ '%s'",
            job.id, job.priority_group,
        )
        contacts = env_settings.get_contacts(job.priority_group)

    if not contacts:
        logger.error("ไม่มีเบอร์ติดต่อสำหรับผู้รับ %s", job.priority_group)
        update_job_status(db, job, CallStatus.FAILED)
        return

    if job.contact_index >= len(contacts):
        # escalation chain หมดแล้ว ไม่มีใครรับสายสักคน — ไม่มี SMS fallback แล้ว จบที่ FAILED ตรงๆ
        logger.error("Job %s: ครบทุกเบอร์แล้วไม่มีใครรับสาย", job.id)
        update_job_status(db, job, CallStatus.FAILED)
        return

    current_number = contacts[job.contact_index]

    try:
        worker_state.set_current_step(job.id, worker_state.CallStep.PREPARING_AUDIO)
        audio_path = text_to_speech(job.message)

        # อัปโหลดไฟล์เสียงเข้าโมดูล "ก่อน" โทรออกเสมอ — ขั้นตอนนี้กินเวลาราว 15-20 วินาที
        # (SIMCOM บังคับส่งทีละ 256 byte หน่วง 50ms) ถ้าทำหลังปลายสายรับแล้ว คนรับจะเจอ
        # ความเงียบยาวเป็นสิบวินาทีก่อนได้ยินเสียง จนอาจวางสายไปก่อนเพราะนึกว่าสายหลุด
        # ย้ายมาทำตอนนี้ = ใช้เวลาช่วงที่ยังไม่มีใครรอฟัง พอรับสายปุ๊บได้ยินทันที
        worker_state.set_current_step(job.id, worker_state.CallStep.UPLOADING_AUDIO, progress=0.0)
        gsm.prepare_audio(audio_path, on_progress=worker_state.set_progress)

        worker_state.set_current_step(job.id, worker_state.CallStep.DIALING)
        result = gsm.dial(current_number)
    except Exception as exc:
        # เตรียมเสียง (เช่น gTTS ต่อเน็ตไม่ได้ / อัปโหลดเข้าโมดูลไม่สำเร็จ) หรือ dial() เองพัง
        # ก่อนจะรู้ผลการโทรด้วยซ้ำ
        logger.exception("Job %s: เตรียมเสียง/โทรออกล้มเหลว", job.id)
        _log_attempt(db, job, current_number, "failed", detail=str(exc))
        update_job_status(db, job, CallStatus.FAILED)
        return

    # เก็บคำอธิบายผลลัพธ์เป็นภาษาคนไว้ใน detail — หน้าประวัติการโทรกางดูได้ทันทีว่าทำไมไม่สำเร็จ
    # ไม่ต้องไปเดาความหมายของคำว่า rejected/no_answer เอง
    RESULT_DETAIL = {
        "rejected": "ปลายสายกดปฏิเสธ หรือติดต่อเบอร์นี้ไม่ได้ (สายถูกตัดก่อนหมดเวลารอ)",
        "no_answer": f"ไม่มีใครรับสายภายใน {cfg.call_ring_timeout_seconds} วินาที",
        "busy": "สายไม่ว่าง ปลายสายกำลังคุยสายอื่นอยู่",
    }
    _log_attempt(db, job, current_number, result, detail=RESULT_DETAIL.get(result, ""))

    if result == "connected":
        try:
            worker_state.set_current_step(job.id, worker_state.CallStep.PLAYING)

            # ── เว้นช่วงก่อนเริ่มพูด ──────────────────────────────────────────
            # โมดูลรายงานว่า "รับสายแล้ว" ตั้งแต่วินาทีที่กดรับ แต่คนยังไม่ได้เอาหูแนบ
            # ถ้าเล่นเสียงทันที ประโยคต้นจะหายไปกับจังหวะยกโทรศัพท์ ซึ่งมักเป็นประโยค
            # ที่บอกว่าเกิดอะไรขึ้น = ส่วนที่สำคัญที่สุดของทั้งสาย
            if cfg.call_answer_delay_seconds > 0:
                time.sleep(cfg.call_answer_delay_seconds)

            # ── พูดซ้ำตามจำนวนรอบที่ตั้งไว้ ───────────────────────────────────
            # เช็คว่าสายยังอยู่ก่อนพูดรอบถัดไปทุกครั้ง — ถ้าปลายสายวางไปแล้วการสั่งเล่นซ้ำ
            # จะค้างรอ URC ที่ไม่มีวันมาจนครบ timeout 30 วิ ทำให้คิวงานถัดไปหยุดนิ่งไปเปล่าๆ
            for round_no in range(1, cfg.call_repeat_count + 1):
                if round_no > 1:
                    if not gsm.call_is_active():
                        logger.info("Job %s: ปลายสายวางไปแล้ว หยุดพูดซ้ำที่รอบ %s", job.id, round_no - 1)
                        break
                    time.sleep(REPEAT_GAP_SECONDS)
                logger.info("Job %s: พูดข้อความรอบที่ %s/%s", job.id, round_no, cfg.call_repeat_count)
                gsm.play_audio()
        except Exception as exc:
            # โทรติดแล้วแต่เล่นเสียงพัง (เช่น อัปโหลดไฟล์เข้าโมดูลไม่สำเร็จ) — เจอเองจริงระหว่าง
            # ทดสอบกับฮาร์ดแวร์ ต้องบันทึก detail ไว้ ไม่งั้น history จะโชว์ last_result เป็น
            # "connected" ค้างจาก _log_attempt ด้านบน ทั้งที่จริงส่งข้อความไม่สำเร็จ เข้าใจผิดได้ง่าย
            logger.exception("Job %s: เล่นเสียงเข้าสายล้มเหลว", job.id)
            _log_attempt(db, job, current_number, "failed", detail=str(exc))
            update_job_status(db, job, CallStatus.FAILED)
            return
        finally:
            gsm.hangup()
        update_job_status(db, job, CallStatus.CONNECTED)
        logger.info("Job %s: โทรติดและเล่นข้อความสำเร็จ", job.id)
        return

    # ไม่รับสาย / ปฏิเสธ / สายไม่ว่าง — ทั้งหมดยังไม่ถือว่าจบ ต้อง retry หรือไล่เบอร์ถัดไปต่อ
    # 'rejected' ใช้สถานะ NO_ANSWER ร่วมกัน (ไม่เพิ่มค่าใหม่ใน enum เพื่อเลี่ยง migration)
    # ความต่างถูกเก็บไว้ใน call_logs.result/detail ซึ่งเป็นที่ที่คนอ่านจริงอยู่แล้ว
    status_map = {
        "no_answer": CallStatus.NO_ANSWER,
        "rejected": CallStatus.NO_ANSWER,
        "busy": CallStatus.BUSY,
    }
    update_job_status(db, job, status_map.get(result, CallStatus.NO_ANSWER))

    # หน่วงเวลาก่อนลองใหม่ด้วยการนัดเวลาไว้ที่ตัว job (next_attempt_at) แทนการ time.sleep()
    # ค้าง thread — worker จะเอาเวลาช่วงรอนี้ไปโทรงานอื่นในคิวต่อได้ทันที
    # เดิม sleep ค้างไว้ 30 วิ ทำให้ทั้งคิวหยุดรอไปด้วย ทั้งที่งานอื่นไม่ได้เกี่ยวอะไรกับสายที่พลาด
    next_at = datetime.datetime.utcnow() + datetime.timedelta(seconds=cfg.call_retry_delay_seconds)

    if job.retry_count < cfg.call_retry_count:
        logger.info(
            "Job %s: เบอร์ %s ผลลัพธ์ %s นัดโทรซ้ำอีก %s วิ (%s/%s) — ระหว่างนี้คิวเดินต่อได้",
            job.id, _mask_number(current_number), result,
            cfg.call_retry_delay_seconds,
            job.retry_count + 1, cfg.call_retry_count,
        )
        update_job_status(
            db, job, CallStatus.RETRYING,
            retry_count=job.retry_count + 1,
            next_attempt_at=next_at,
        )
    else:
        # ครบ retry ของเบอร์นี้แล้ว → ไปเบอร์ถัดไปใน escalation chain
        # หน่วงเท่ากันก่อนโทรเบอร์ถัดไป กันโทรรัวติดๆ กันจนดูเหมือนสแปม
        logger.info(
            "Job %s: ครบรอบ retry แล้ว escalate ไปเบอร์ถัดไป (index %s -> %s)",
            job.id, job.contact_index, job.contact_index + 1,
        )
        update_job_status(
            db, job, CallStatus.ESCALATED,
            contact_index=job.contact_index + 1,
            retry_count=0,
            next_attempt_at=next_at,
        )


def _poll_gsm_status(gsm: GSMModule, power: GsmPower | None = None):
    """
    เช็คว่าโมดูลยังเสียบอยู่ไหม + ดึงสัญญาณ/operator/network mode — เรียกเฉพาะตอน idle เท่านั้น
    เพื่อไม่ให้ AT command ของการเช็คสถานะไปแทรกกลางขั้นตอนโทรที่ใช้ serial port เดียวกัน

    ต้องอัปเดต gsm_connected ทุกรอบด้วย ไม่ใช่แค่ค่าสัญญาณ — เดิมตั้ง True ครั้งเดียวตอน worker
    เริ่มทำงาน แล้วตั้ง False เฉพาะตอน worker ตายทั้ง thread ผลคือถอดโมดูลออกกลางคัน dashboard
    ยังขึ้น "โมดูลพร้อม" ค้างอยู่ตลอด (เจอจากการทดสอบจริง: ถอด USB แล้วหน้าเว็บยังบอกออนไลน์
    ทั้งที่ทุกค่าเป็น "ไม่ทราบ" หมดแล้ว) — สถานะที่โกหกแบบนี้อันตรายกว่าไม่มีสถานะเลย
    """
    # เขียน log เฉพาะตอน "สถานะเปลี่ยน" ไม่ใช่ทุกรอบที่เช็ค — เช็คทุก 10 วิ ถ้า log ทุกรอบ
    # ตอนถอดโมดูลทิ้งไว้ข้ามคืนจะได้ log ซ้ำๆ ราว 8,600 บรรทัด/วัน กิน SD card ของ Pi ฟรีๆ
    # โดยไม่ได้ข้อมูลเพิ่มเลย (บรรทัดที่ 2 เป็นต้นไปบอกเรื่องเดิมกับบรรทัดแรกทุกประการ)
    was_connected = worker_state.get_state().gsm_connected

    # ── ขา GPIO ใช้ได้เฉพาะกับโมดูลที่ต่อผ่านหัว GPIO เท่านั้น ──────────────────
    # ระบบสลับพอร์ตเองได้ (ดู GSMModule._autodetect_port) ถ้าตอนนี้กำลังคุยกับโมดูลที่
    # เสียบผ่าน USB อยู่ ขา PWRKEY/STATUS ที่ตั้งไว้ก็ไม่ได้ต่อกับอะไรของมันเลย
    # กดไปก็ไม่มีผล และค่า STATUS ที่อ่านได้ก็ไม่ได้บอกอะไรเกี่ยวกับโมดูลตัวนั้น
    #
    # ตัดสินจากพอร์ตที่ "ใช้งานอยู่จริง" ไม่ใช่จากค่าใน .env เพราะพอร์ตเปลี่ยนเองได้
    gpio = power if (power is not None and gsm.port == UART_PORT) else None

    # อ่านขา STATUS ไว้แสดงบนหน้าเว็บ — แยกแยะ "ดับ" ออกจาก "ค้าง" ได้ ซึ่ง AT ทำไม่ได้
    worker_state.set_gsm_power_on(gpio.is_on() if gpio is not None else None)

    if gsm.is_responsive():
        # กันสายโทรกลับ — จุดนี้เรียกเฉพาะตอน worker ว่าง (ไม่มีสายที่ระบบโทรออกค้างอยู่)
        # จึงไม่มีทางไปวางสายของตัวเอง และเจอสายเรียกเข้าภายในไม่กี่วินาทีเสมอ
        try:
            gsm.reject_incoming_call()
        except Exception:
            logger.exception("เช็ค/วางสายเรียกเข้าไม่สำเร็จ")

        try:
            signal = gsm.get_signal_quality()
            operator, mode = gsm.get_operator_info()
        except Exception:
            logger.warning("ดึงสถานะสัญญาณ GSM ไม่สำเร็จ", exc_info=True)
            signal, operator, mode = None, None, None
        worker_state.set_gsm_connected(True, gsm.port)
        worker_state.set_gsm_status(signal, operator, mode)
        if not was_connected:
            logger.info("โมดูล GSM ที่ %s กลับมาเชื่อมต่อได้แล้ว", gsm.port)
        return

    # โมดูลไม่ตอบ = ถือว่าหลุด ล้างค่าที่ค้างอยู่ทิ้งด้วย ไม่งั้นหน้าเว็บจะโชว์สัญญาณค่าเก่า
    # ของตอนที่ยังเสียบอยู่ ซึ่งอ่านแล้วเข้าใจผิดว่ายังใช้งานได้
    worker_state.set_gsm_connected(False)
    worker_state.set_gsm_status(None, None, None)
    if was_connected:
        logger.warning("โมดูล GSM ที่ %s ไม่ตอบสนอง — จะพยายามเชื่อมต่อใหม่ทุกรอบจนกว่าจะกลับมา", gsm.port)

    # ── ปลุกโมดูลเองเมื่อคุยกับมันไม่รู้เรื่อง ──────────────────────────────────
    # เคสหลักที่ออกแบบมาเพื่อรองรับ: ไฟดับแล้วกลับมา ซึ่งเป็นเหตุผลที่ระบบนี้มีอยู่
    # ตอนไฟกลับมา Pi บูตเองได้ แต่โมดูลตัวนี้ไม่ติดเอง (ทดสอบแล้ว: ถอดไฟเลี้ยงแล้วเสียบใหม่
    # ไฟเขียวไม่ติด) ถ้าไม่มีใครกด PWRKEY ระบบจะขึ้นเขียวทุกอย่างแต่โทรไม่ออกจริง
    #
    # เงื่อนไขคือ "AT ไม่ตอบ" ไม่ใช่ "STATUS ต่ำ" — เดิมผูกไว้กับ STATUS แล้วพลาด เพราะ
    # บอร์ดที่ใช้จริงมีจังหวะที่ STATUS ค้างสูงทั้งที่โมดูลไม่ทำงานแล้ว (เจอจากการทดสอบ)
    # การกด PWRKEY ตอนโมดูลติดอยู่แล้วไม่มีผลเสียอะไร แต่การไม่กดตอนมันตายคือระบบเงียบไปเฉยๆ
    #
    # คูลดาวน์ 60 วิกันกดรัว: ถ้าโมดูลเสียจริงหรือสายหลุด การกดทุกวินาทีไม่ได้ช่วยอะไร
    if gpio is not None and gpio.available:
        now = time.monotonic()
        last = getattr(_poll_gsm_status, "_last_power_on_try", 0.0)
        if now - last >= AUTO_POWER_ON_COOLDOWN:
            _poll_gsm_status._last_power_on_try = now
            streak = getattr(_poll_gsm_status, "_power_on_fail_streak", 0)
            # เตือนเสียงดังเฉพาะครั้งแรกหลังโมดูลหาย จากนั้นลดเป็น info — ถ้าโมดูลเสียจริง
            # ระบบจะพยายามทุกนาทีตลอดไป เตือนทุกครั้งเท่ากับ log 1,440 บรรทัด/วัน
            # ที่บอกเรื่องเดียวกับบรรทัดแรกทุกประการ
            log = logger.warning if streak == 0 else logger.info
            log("โมดูลไม่ตอบ — กด PWRKEY ปลุกเอง (ครั้งที่ %s)", streak + 1)

            # ไม่เอาผลของ power_on() มาเป็นเงื่อนไขว่าจะลองต่อ AT ต่อไหม — มันตัดสินจากขา
            # STATUS ซึ่งบอร์ดที่ใช้จริงเชื่อไม่ได้ (มีทั้งจังหวะที่ค้างสูงตอนโมดูลตาย และ
            # จังหวะที่ไม่ขึ้นตอนโมดูลบูตขึ้นมาแล้ว) เจอจริง: กดแล้วโมดูลกลับมาใช้งานได้
            # แต่ log รายงานว่า "เปิดโมดูลไม่สำเร็จ" เพราะ STATUS ไม่ขึ้นใน 25 วิ
            #
            # ตัวชี้ขาดว่าปลุกสำเร็จหรือไม่มีอย่างเดียวคือ "AT ตอบไหม" จึงลองต่อเสมอ
            gpio.power_on()
            if _reconnect_after_power(gsm):
                _poll_gsm_status._power_on_fail_streak = 0
                logger.warning("ปลุกโมดูลกลับมาได้เองแล้ว")
                return
            _poll_gsm_status._power_on_fail_streak = streak + 1

    # ลองต่อใหม่ทุกรอบที่ poll เผื่อผู้ใช้เสียบกลับเข้าไป หรือโมดูล reset ตัวเองหลังไฟตก
    # (สำคัญมากบน Pi ที่ไฟเลี้ยงไม่พอ โมดูลจะ re-enumerate ตัวเองเป็นระยะ)
    # ถ้าไม่มีบรรทัดนี้ พอหลุดครั้งเดียวต้อง restart ทั้ง process ถึงจะกลับมาโทรได้
    try:
        gsm.disconnect()
        gsm.connect()
    except Exception:
        return  # ยังไม่กลับมา ปล่อยไว้ให้รอบหน้าลองใหม่

    if gsm.is_responsive():
        worker_state.set_gsm_connected(True, gsm.port)
        logger.info("เชื่อมต่อโมดูล GSM ที่ %s ใหม่สำเร็จ", gsm.port)


# เว้นช่วงสั้นๆ ระหว่างการพูดซ้ำแต่ละรอบ — พูดติดกันเลยจะฟังเป็นประโยคเดียวยาวๆ
# แยกไม่ออกว่าจบรอบแรกตรงไหน ซึ่งทำให้การพูดซ้ำเสียประโยชน์ไปเกือบหมด
REPEAT_GAP_SECONDS = 1.5

# เว้นระยะระหว่างการพยายามปลุกโมดูลเอง — ไม่กดรัวทุกวินาที
# 60 วิเป็นค่าที่พอดีระหว่าง "กลับมาเร็ว" กับ "ไม่กดปุ่มโมดูลรัวๆ ตอนมันเสียจริง"
AUTO_POWER_ON_COOLDOWN = 60.0


def _restart_radio(gsm: GSMModule) -> bool:
    """
    ปิด/เปิดคลื่นวิทยุตามที่หน้าเว็บสั่ง — คืน True ถ้าสำเร็จ

    เรียกจาก worker เท่านั้น และเฉพาะจังหวะที่ไม่มีสายค้างอยู่ (ดูจุดเรียกใน loop)
    ต้องกลืน exception เองทั้งหมด ถ้าปล่อยหลุดออกไป worker thread จะตายแล้วระบบเงียบทั้งก้อน
    ซึ่งแย่กว่าปุ่มที่กดแล้วไม่สำเร็จมาก

    เคยมีขั้นไต่ระดับไปแตะขา RESET ต่อเมื่อวิธีนี้ไม่ผ่าน — ถอดออกแล้วเพราะบอร์ดที่ใช้จริง
    ต่อสาย RESET เข้า GPIO แล้วโมดูลไม่ยอมบูตเลย (ดู gsm_power.py หัวข้อ "ที่เคยมีแล้วถอดออก")
    """
    logger.warning("ได้รับคำสั่งรีสตาร์ทโมดูลจากหน้าเว็บ — เริ่มปิด/เปิดคลื่นวิทยุ")
    try:
        return gsm.restart_radio()
    except Exception:
        logger.exception("รีสตาร์ทโมดูลล้มเหลว")
        return False


# ขา STATUS ขึ้นตั้งแต่ต้นลำดับการบูต แต่เฟิร์มแวร์ยังไม่พร้อมรับ AT อีกสิบกว่าวินาที
AT_READY_TIMEOUT = 40.0
AT_READY_INTERVAL = 2.0


def _reconnect_after_power(gsm: GSMModule) -> bool:
    """
    ต่อพอร์ตใหม่หลังโมดูลเพิ่งบูต แล้วรอจนคุย AT รู้เรื่อง

    ต้องวนรอ ไม่ใช่เช็คครั้งเดียว — เดิมเช็คทีเดียวทันทีที่ STATUS ขึ้น ผลคือรายงานว่า
    ไม่สำเร็จทุกครั้งทั้งที่โมดูลติดขึ้นมาปกติดี แล้วอีกสิบกว่าวินาทีต่อมา loop ปกติก็ต่อได้เอง
    """
    deadline = time.monotonic() + AT_READY_TIMEOUT
    while time.monotonic() < deadline:
        try:
            gsm.disconnect()
            gsm.connect()
            if gsm.is_responsive():
                worker_state.set_gsm_connected(True, gsm.port)
                logger.warning("โมดูลพร้อมรับคำสั่งแล้วหลังบูต")
                return True
        except Exception:
            pass  # ยังไม่พร้อม ลองใหม่รอบหน้า
        time.sleep(AT_READY_INTERVAL)

    logger.warning("โมดูลบูตขึ้นแล้วแต่ยังไม่ตอบ AT ภายใน %.0f วิ", AT_READY_TIMEOUT)
    return False


def run_worker_loop(poll_interval: float = 1.0, config_check_interval: float = 10.0, gsm_status_interval: float = 1.0):
    """
    Main loop — รันแบบ background thread แยกจาก API server (SIM ตัวเดียว, ไม่มี pool)
    Config (retry/timeout) โหลดจาก dashboard (DB) ตอน start แล้วเช็คซ้ำทุก config_check_interval วิ
    เพื่อ hot-reload อัตโนมัติเมื่อมีคนแก้ผ่าน dashboard (PUT /config) โดยไม่ต้อง restart

    เช็คสัญญาณ/operator + ว่าโมดูลยังเสียบอยู่ไหม ทุก gsm_status_interval วิ (เฉพาะตอนคิวว่าง)

    ตั้ง 1 วิได้เพราะการเช็ค 1 รอบใช้เวลาแค่ ~100ms (คำสั่งถามค่าใช้ _query ที่คืนทันทีที่โมดูลตอบ
    ไม่ใช่ _send_at ที่หน่วงคงที่ 1 วิ/คำสั่ง — ก่อนแก้ 1 รอบกิน 2.5 วิ ตั้ง 1 วิไม่ได้เลย)
    และ _poll_gsm_status เขียน log เฉพาะตอนสถานะเปลี่ยน เดินปกติจึงไม่มี log เพิ่มเลยสักบรรทัด

    poll_interval ต้องลดลงมาด้วย เพราะ loop นี้ sleep(poll_interval) ทุกรอบ ถ้ายังเป็น 3 วิ
    ต่อให้ตั้ง gsm_status_interval=1 ก็เช็คได้จริงแค่ทุก 3 วิ — ผลพลอยได้คืองานโทรที่เข้าคิวมา
    ถูกหยิบไปโทรเร็วขึ้นจาก "ภายใน 3 วิ" เหลือ "ภายใน 1 วิ" ซึ่งดีกับระบบแจ้งเตือนฉุกเฉินอยู่แล้ว
    """
    db = SessionLocal()
    try:
        cfg = get_effective_config(db)
        cfg_updated_at = get_or_create_app_settings(db).updated_at
        # กู้งานที่ค้างสถานะ "กำลังทำงาน" จากรอบก่อน (process ตายกลางคัน) กลับเข้าคิว
        # ต้องทำก่อนเข้า loop เสมอ ไม่งั้นงานพวกนั้นค้างถาวรและหน้าเว็บจะขึ้นว่ามีสายค้างตลอด
        recovered = recover_orphaned_jobs(db)
        if recovered:
            logger.warning("กู้งานที่ค้างจากรอบก่อน %s งานกลับเข้าคิวแล้ว", recovered)
    finally:
        db.close()

    last_cfg_check = time.monotonic()
    last_gsm_status_check = 0.0  # บังคับให้เช็คทันทีตอน start

    worker_state.mark_started()
    gsm = GSMModule()

    # คุมไฟโมดูลผ่าน GPIO — ใช้ได้เฉพาะโมดูลที่ต่อผ่านหัว GPIO ถ้าปิดสวิตช์ไว้
    # (หรือเป็นโมดูลที่เสียบ USB) ตัวนี้จะตอบว่าทำไม่ได้ทุกคำสั่ง โดยไม่ทำให้ worker พัง
    power = GsmPower()

    # โมดูลที่ต่อผ่าน GPIO ไม่ได้ติดเองตอน Pi บูต — ต้องมีคนกด PWRKEY ให้
    # ถ้าไม่ปลุกตรงนี้ ระบบจะค้างที่ "โมดูลไม่พร้อม" ตลอดหลังไฟดับแล้วกลับมา
    # จนกว่าจะมีคนเดินไปกดปุ่มที่ตัวเครื่อง ซึ่งขัดกับเหตุผลที่ระบบนี้มีอยู่ตั้งแต่แรก
    if power.available and power.is_on() is False:
        logger.warning("โมดูลดับอยู่ตอน worker เริ่มทำงาน — สั่งเปิดให้อัตโนมัติ")
        power.power_on()

    # ── ต่อโมดูลไม่ได้ตอนสตาร์ต ต้องไม่ทำให้ worker ตาย ────────────────────────
    # เดิมเรียก gsm.connect() ลอยๆ ถ้าโมดูลยังไม่ได้เสียบ (หรือ Pi บูตเร็วกว่าที่ USB
    # จะ enumerate เสร็จ) มันจะโยน SerialException ออกมาแล้ว thread นี้ตายถาวร
    # ผลคือถึงจะเสียบโมดูลกลับเข้าไปทีหลัง ระบบก็ไม่มีวันโทรได้อีกเลยจนกว่าจะ restart
    # ทั้ง container — ซึ่งขัดกับที่ loop ข้างล่างออกแบบมาให้ลองต่อใหม่เองทุกวินาทีอยู่แล้ว
    try:
        gsm.connect()
        worker_state.set_gsm_connected(True, gsm.port)
        logger.info("Call worker เริ่มทำงาน โดยเชื่อมต่อโมดูลที่ %s", gsm.port)
    except Exception:
        worker_state.set_gsm_connected(False)
        logger.warning(
            "ยังต่อโมดูลที่ %s ไม่ได้ตอนเริ่มทำงาน — เข้า loop ปกติแล้วจะลองต่อใหม่ทุกรอบ "
            "(หน้าเว็บและ API ใช้งานได้ตามปกติระหว่างนี้)", gsm.port,
        )

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

                # เช็คคำขอรีสตาร์ทโมดูล "ก่อน" หยิบงานใหม่ — วางไว้ตรงนี้โดยตั้งใจ เพราะเป็น
                # จุดเดียวที่การันตีได้ว่าไม่มีสายที่กำลังคุยอยู่ (process_job ทำงานแบบ blocking
                # จนจบสายเสมอ) ปุ่มบนหน้าเว็บจึงไม่มีทางไปตัดสายที่คนกำลังฟังข้อความอยู่
                if worker_state.take_gsm_restart_request():
                    ok = _restart_radio(gsm)
                    worker_state.finish_gsm_restart(ok)
                    logger.warning("รีสตาร์ทโมดูล%s", "สำเร็จ" if ok else "ไม่สำเร็จ")
                    # บังคับให้เช็คสถานะสัญญาณใหม่ทันทีในรอบถัดไป ไม่ต้องรอครบ interval
                    # ผู้ใช้ที่เพิ่งกดปุ่มจะได้เห็นค่าใหม่บนหน้าเว็บเลย ไม่ใช่ค่าค้างจากก่อนรีสตาร์ท
                    last_gsm_status_check = 0.0

                job = claim_next_job(db)
                if job:
                    try:
                        process_job(db, job, gsm, cfg)
                    except Exception:
                        # ห้ามปล่อยให้ exception ของ job เดียวหลุดออกไปฆ่า thread ทั้งก้อน —
                        # ตอนนี้เกิดขึ้นแน่ๆ ทุกครั้งที่โทรติด เพราะ gsm.stream_audio() ยัง
                        # raise NotImplementedError อยู่ (ดูคอมเมนต์ในไฟล์นั้น) ถ้าไม่กันไว้
                        # ตรงนี้ worker thread จะตายทั้ง thread ตั้งแต่การโทรทดสอบครั้งแรก
                        # ที่ติดสาย แล้วงานที่เหลือทั้งหมดในคิวจะไม่ถูกประมวลผลอีกเลยจนกว่าจะ
                        # restart container โดยไม่มี error โผล่ให้เห็นที่ไหนเลยนอก log
                        logger.exception("Job %s: ล้มเหลวแบบไม่คาดคิดระหว่างประมวลผล — mark เป็น failed แล้วไปงานถัดไป", job.id)
                        try:
                            update_job_status(db, job, CallStatus.FAILED)
                        except Exception:
                            logger.exception("Job %s: mark เป็น failed ไม่สำเร็จด้วย — job นี้อาจค้างสถานะเดิม", job.id)
                    finally:
                        # ต้องล้างทุกทางออกของ process_job (สำเร็จ/ล้มเหลว/exception) ไม่งั้นหน้าเว็บ
                        # จะค้างแสดงขั้นตอนสุดท้ายที่ทำค้างไว้ตลอด ทั้งที่ worker ว่างไปแล้ว
                        worker_state.set_current_step(None, None)
                else:
                    now = time.monotonic()
                    if now - last_gsm_status_check >= gsm_status_interval:
                        last_gsm_status_check = now
                        _poll_gsm_status(gsm, power)
                    time.sleep(poll_interval)
            finally:
                db.close()
    finally:
        worker_state.set_gsm_connected(False)
        gsm.disconnect()
        power.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_worker_loop()
