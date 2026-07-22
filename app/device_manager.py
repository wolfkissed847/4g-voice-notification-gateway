"""
Device Manager — จัดการ registry ของ SIM device หลายตัว (multi-SIM pool)
ใช้เฉพาะ backend gsm — VoIP ใช้ trunk เดียวจาก Zadarma ไม่ต้องมี pool
"""
from sqlalchemy.orm import Session

from app.database import DeviceStatus, SimDevice


def list_devices(db: Session) -> list[SimDevice]:
    return db.query(SimDevice).order_by(SimDevice.id.asc()).all()


def get_active_devices(db: Session) -> list[SimDevice]:
    """คืนเฉพาะอุปกรณ์ที่เปิดใช้งานอยู่ (ไม่รวม disabled) — worker pool ใช้ตัวนี้ตอน start"""
    return (
        db.query(SimDevice)
        .filter(SimDevice.status != DeviceStatus.DISABLED)
        .order_by(SimDevice.id.asc())
        .all()
    )


def add_device(db: Session, label: str, serial_port: str, baudrate: int = 115200) -> SimDevice:
    device = SimDevice(
        label=label, serial_port=serial_port, baudrate=baudrate, status=DeviceStatus.OFFLINE
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return device


def update_device_status(db: Session, device_id: int, status: DeviceStatus) -> SimDevice | None:
    device = db.query(SimDevice).filter(SimDevice.id == device_id).first()
    if device is None:
        return None
    device.status = status
    db.commit()
    db.refresh(device)
    return device


def remove_device(db: Session, device_id: int) -> bool:
    device = db.query(SimDevice).filter(SimDevice.id == device_id).first()
    if device is None:
        return False
    db.delete(device)
    db.commit()
    return True
