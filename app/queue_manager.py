"""
Queue Manager — จัดการ FIFO queue ของงานโทร
เนื่องจากฮาร์ดแวร์ GSM แต่ละตัวโทรได้ทีละ 1 สาย แต่ตอนนี้รองรับหลายตัวพร้อมกัน (multi-SIM pool)
จึงต้องมี lock กันหลาย worker thread ดึงงานเดียวกันไปพร้อมกัน (race condition)
"""
import threading

from sqlalchemy.orm import Session

from app.database import CallJob, CallStatus

_claim_lock = threading.Lock()


def enqueue_job(db: Session, message: str, priority_group: str) -> CallJob:
    job = CallJob(
        message=message,
        priority_group=priority_group,
        contact_index=0,
        retry_count=0,
        status=CallStatus.QUEUED,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def get_next_job(db: Session) -> CallJob | None:
    """ดึงงานที่เก่าที่สุดซึ่งยังรอโทร (FIFO) — ใช้ตอน worker ว่าง (ไม่ claim, ใช้ดูเฉยๆ)"""
    return (
        db.query(CallJob)
        .filter(CallJob.status.in_([CallStatus.QUEUED, CallStatus.RETRYING]))
        .order_by(CallJob.created_at.asc())
        .first()
    )


def claim_next_job(db: Session, device_id: int | None = None) -> CallJob | None:
    """
    ดึงงานถัดไปแบบ atomic แล้ว mark เป็น IN_PROGRESS ทันทีในขั้นตอนเดียว
    ใช้ตอนมี worker หลายตัว (multi-SIM) แย่งงานจากคิวเดียวกัน — ป้องกันสองตัวโทรงานเดียวกันซ้ำ
    """
    with _claim_lock:
        job = (
            db.query(CallJob)
            .filter(CallJob.status.in_([CallStatus.QUEUED, CallStatus.RETRYING]))
            .order_by(CallJob.created_at.asc())
            .first()
        )
        if job is None:
            return None
        job.status = CallStatus.IN_PROGRESS
        if device_id is not None:
            job.device_id = device_id
        db.commit()
        db.refresh(job)
        return job


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
            CallStatus.QUEUED, CallStatus.RETRYING, CallStatus.IN_PROGRESS
        ]))
        .order_by(CallJob.created_at.asc())
        .all()
    )
