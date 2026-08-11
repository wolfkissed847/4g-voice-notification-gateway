"""
Queue Manager — จัดการ FIFO queue ของงานโทร
เนื่องจากฮาร์ดแวร์ GSM โทรได้ทีละ 1 สาย จึงต้อง serialize งานทั้งหมดผ่านตารางนี้
(worker เดียว แต่ยังใช้ atomic claim ไว้ เผื่ออนาคตกลับไปทำ multi-SIM ใน branch feature/voip-multi-sim)
"""
import datetime
import threading

from sqlalchemy.orm import Session

from app.database import CallJob, CallStatus

_claim_lock = threading.Lock()


def enqueue_job(
    db: Session,
    message: str,
    event_type_id: int,
    priority_group: str,
    group_id: int | None = None,
    api_key_id: int | None = None,
    source_device: str | None = None,
    event_type_code: str | None = None,
    event_type_name: str | None = None,
) -> CallJob:
    """
    priority_group และ source_device เป็น snapshot ณ ตอนสั่งโทร ใช้แสดงผลใน history เท่านั้น
    (api_key_id เป็น FK จริงไว้ filter/นับการใช้งานรายอุปกรณ์)

    group_id คือกลุ่มที่ "ตัดสินใจแล้ว" ว่าจะโทรหาใคร — ต่างจาก priority_group ที่เป็นแค่ชื่อ
    สำหรับแสดงผล ค่านี้เป็นตัวที่ worker ใช้หาเบอร์จริง จึงต้องส่งมาทุกครั้ง
    """
    job = CallJob(
        message=message,
        event_type_id=event_type_id,
        priority_group=priority_group,
        group_id=group_id,
        api_key_id=api_key_id,
        source_device=source_device,
        event_type_code=event_type_code,
        event_type_name=event_type_name,
        contact_index=0,
        retry_count=0,
        status=CallStatus.QUEUED,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next_job(db: Session) -> CallJob | None:
    """
    ดึงงานถัดไปแบบ atomic แล้ว mark เป็น IN_PROGRESS ทันที (FIFO)

    ── สองเงื่อนไขที่สำคัญ ────────────────────────────────────────────────────
    1. ต้องรวม ESCALATED ด้วย ไม่ใช่แค่ QUEUED/RETRYING
       process_job ตั้งสถานะเป็น ESCALATED ตอนครบ retry ของเบอร์หนึ่งแล้วต้องไปเบอร์ถัดไป
       แต่เดิม filter ไม่มี ESCALATED งานจึงค้างตรงนั้นถาวร ไม่มีใครหยิบไปโทรเบอร์ที่ 2 เลย
       = ระบบไล่เบอร์สำรองไม่เคยทำงานจริง (ไม่เคยถูกจับได้เพราะยังไม่ได้ทดสอบกับฮาร์ดแวร์)

    2. ข้ามงานที่ยังไม่ถึงเวลา retry (next_attempt_at อยู่ในอนาคต)
       ทำให้หน่วงเวลา retry ได้โดยไม่ต้อง time.sleep() ค้าง thread — worker เอาเวลาว่างช่วงนั้น
       ไปโทรงานอื่นในคิวต่อได้เลย เดิม sleep ค้างไว้ งานที่ไม่เกี่ยวกันเลยต้องรอไปด้วยทั้งคิว
    """
    now = datetime.datetime.utcnow()
    with _claim_lock:
        job = (
            db.query(CallJob)
            .filter(CallJob.status.in_([CallStatus.QUEUED, CallStatus.RETRYING, CallStatus.ESCALATED]))
            .filter((CallJob.next_attempt_at.is_(None)) | (CallJob.next_attempt_at <= now))
            .order_by(CallJob.created_at.asc())
            .first()
        )
        if job is None:
            return None
        job.status = CallStatus.IN_PROGRESS
        db.commit()
        db.refresh(job)
        return job


def recover_orphaned_jobs(db: Session) -> int:
    """
    คืนงานที่ค้างสถานะ IN_PROGRESS กลับเข้าคิว — เรียกครั้งเดียวตอน worker เริ่มทำงาน

    ทำไมต้องมี: IN_PROGRESS แปลว่า "มี worker ถืองานนี้อยู่" แต่ถ้า process ตายกลางคัน
    (รีสตาร์ทเซิร์ฟเวอร์ตอนกำลังโทร / ไฟดับ / container restart) จะไม่มีใครมาปิดสถานะให้
    งานนั้นค้างถาวร: claim_next_job ไม่แตะเพราะคิดว่ามีคนทำอยู่ แต่ get_pending_jobs ยังนับว่า
    ค้างคิว ผลคือหน้าเว็บขึ้น "กำลังต่อสาย" ค้างตลอดไปทั้งที่ไม่มีอะไรเกิดขึ้นจริง

    ปลอดภัยเพราะระบบนี้มี worker เดียว (ซิมใบเดียว) — เจอ IN_PROGRESS ตอนเพิ่งสตาร์ท
    แปลว่าเป็นงานค้างจากรอบก่อนแน่นอน ไม่มีทางเป็นงานที่ worker อื่นกำลังทำอยู่จริง
    """
    orphans = db.query(CallJob).filter(CallJob.status == CallStatus.IN_PROGRESS).all()
    for job in orphans:
        job.status = CallStatus.QUEUED
        job.next_attempt_at = None
    if orphans:
        db.commit()
    return len(orphans)


def update_job_status(db: Session, job: CallJob, status: CallStatus, **kwargs) -> CallJob:
    job.status = status
    for key, value in kwargs.items():
        setattr(job, key, value)
    db.commit()
    db.refresh(job)
    return job


def get_pending_jobs(db: Session) -> list[CallJob]:
    return (
        db.query(CallJob)
        .filter(CallJob.status.in_([
            CallStatus.QUEUED, CallStatus.RETRYING, CallStatus.ESCALATED, CallStatus.IN_PROGRESS
        ]))
        .order_by(CallJob.created_at.asc())
        .all()
    )
