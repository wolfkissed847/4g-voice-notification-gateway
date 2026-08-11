"""
Event Types Service — CRUD ของประเภทเหตุการณ์ที่ /notify รับเข้ามา (event_type_code)
แต่ละ event type ผูกกับ group เดียว และมี message_template ของตัวเอง
"""
from sqlalchemy.orm import Session

from app.database import EventType


# ตัวคั่นระหว่าง "ไม่ได้ส่ง field นี้มา" กับ "ส่งมาเป็น null เพื่อสั่งล้างค่า"
# ใช้ None เป็น default ไม่ได้ เพราะ None คือค่าที่ผู้ใช้ต้องการตั้งจริง (= ไม่มีกลุ่มเริ่มต้น)
_UNSET = object()


class DuplicateEventTypeCodeError(Exception):
    """code ซ้ำกับ event type ที่มีอยู่แล้ว"""


class MissingTemplateVariableError(Exception):
    """ข้อความ template ต้องการตัวแปรที่ไม่ได้ส่งมาใน variables"""


def list_event_types(db: Session) -> list[EventType]:
    return db.query(EventType).order_by(EventType.display_name.asc()).all()


def get_event_type(db: Session, event_type_id: int) -> EventType | None:
    return db.query(EventType).filter(EventType.id == event_type_id).first()


def get_event_type_by_code(db: Session, code: str) -> EventType | None:
    return db.query(EventType).filter(EventType.code == code).first()


def create_event_type(
    db: Session, code: str, display_name: str, message_template: str, group_id: int | None = None
) -> EventType:
    if get_event_type_by_code(db, code) is not None:
        raise DuplicateEventTypeCodeError(f"event type code '{code}' มีอยู่แล้ว")
    event_type = EventType(
        code=code, display_name=display_name, message_template=message_template, group_id=group_id
    )
    db.add(event_type)
    db.commit()
    db.refresh(event_type)
    return event_type


def update_event_type(
    db: Session,
    event_type_id: int,
    display_name: str | None = None,
    message_template: str | None = None,
    group_id=_UNSET,
    is_active: bool | None = None,
) -> EventType | None:
    event_type = get_event_type(db, event_type_id)
    if event_type is None:
        return None
    if display_name is not None:
        event_type.display_name = display_name
    if message_template is not None:
        event_type.message_template = message_template
    if group_id is not _UNSET:
        # ส่ง group_id=null มา = สั่งล้างกลุ่มเริ่มต้นทิ้ง ซึ่งต้องทำได้ตั้งแต่กลุ่มกลายเป็น optional
        event_type.group_id = group_id
    if is_active is not None:
        event_type.is_active = str(is_active).lower()
    db.commit()
    db.refresh(event_type)
    return event_type


def delete_event_type(db: Session, event_type_id: int) -> bool:
    event_type = get_event_type(db, event_type_id)
    if event_type is None:
        return False
    db.delete(event_type)
    db.commit()
    return True


def render_message(
    template: str, variables: dict[str, str], device_name: str | None = None
) -> str:
    """
    แทนที่ {key} ใน template ด้วยค่าจาก variables — ถ้าขาดตัวแปรที่จำเป็นจะ raise ชัดเจน

    `{device}` ถูกเติมให้อัตโนมัติจากชื่ออุปกรณ์เจ้าของ API key ที่ยิงเข้ามา
    อุปกรณ์จึงไม่ต้องส่งชื่อตัวเองมาใน payload เลย — ผลคือย้ายจุดติดตั้งหรือเปลี่ยนชื่อโหนด
    แก้ที่ dashboard ได้ทันที ไม่ต้องเอาบอร์ดกลับมาแฟลช firmware ใหม่

    ถ้า payload ส่ง device มาเองด้วยจะให้ค่าจาก payload ชนะ (เผื่อกรณี gateway ตัวเดียว
    รายงานแทนอุปกรณ์ปลายทางหลายตัว)
    """
    merged = {"device": device_name or "ไม่ระบุอุปกรณ์", **variables}
    try:
        return template.format(**merged)
    except KeyError as exc:
        missing_key = exc.args[0]
        raise MissingTemplateVariableError(
            f"ข้อความ template ต้องการตัวแปร '{{{missing_key}}}' แต่ไม่ได้ส่งมาใน variables"
        ) from exc
    except (IndexError, ValueError) as exc:
        # {} ว่าง หรือวงเล็บปีกกาไม่สมดุล เช่น "อุณหภูมิ {temp" — เดิมหลุดออกไปเป็น 500
        # ทั้งที่เป็นความผิดของแม่แบบข้อความที่ผู้ดูแลพิมพ์เอง ต้องบอกให้รู้ว่าพิมพ์ผิดตรงไหน
        raise MissingTemplateVariableError(
            "แม่แบบข้อความเขียนไม่ถูกต้อง — ตัวแปรต้องเขียนเป็น {ชื่อตัวแปร} เช่น {device} "
            f"และวงเล็บปีกกาต้องครบคู่ (รายละเอียด: {exc})"
        ) from exc
