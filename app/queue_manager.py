"""
Queue Manager — จัดการ FIFO queue ของงานโทร
เนื่องจากฮาร์ดแวร์ GSM โทรได้ทีละ 1 สาย จึงต้อง serialize งานทั้งหมดผ่านตารางนี้
(worker เดียว แต่ยังใช้ atomic claim ไว้ เผื่ออนาคตกลับไปทำ multi-SIM ใน branch feature/voip-multi-sim)
"""
import threading

from sqlalchemy.orm import Session

from app.database import CallJob, CallStatus

_claim_lock = threading.Lock()


def enqueue_job(
    db: Session,
    message: str,
    event_type_id: int,
    priority_group: str,
    api_key_id: int | None = None,
    source_device: str | None = None,
) -> CallJob:
    """
    priority_group และ source_device เป็น snapshot ณ ตอนสั่งโทร ใช้แสดงผลใน history เท่านั้น
    (api_key_id เป็น FK จริงไว้ filter/นับการใช้งานรายอุปกรณ์)
    """
    job = CallJob(
        message=message,
        event_type_id=event_type_id,
        priority_group=priority_group,
        api_key_id=api_key_id,
        source_device=source_device,
        contact_index=0,
        retry_count=0,
        status=CallStatus.QUEUED,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def claim_next_job(db: Session) -> CallJob | None:
    """ดึงงานถัดไปแบบ atomic แล้ว mark เป็น IN_PROGRESS ทันที (FIFO)"""
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
