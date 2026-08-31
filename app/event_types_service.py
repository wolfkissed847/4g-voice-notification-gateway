"""
Event Types Service — CRUD ของประเภทเหตุการณ์ที่ /notify รับเข้ามา (event_type_code)

ประเภทเหตุการณ์เป็น "คลังคำพูดกลาง" ล้วนๆ — รหัส + ชื่อ + ข้อความที่จะพูด เท่านั้น
ไม่รู้จักกลุ่มหรือเบอร์ใดๆ ทั้งสิ้น สร้างทิ้งไว้เฉยๆ โดยยังไม่ผูกกับอะไรเลยก็ได้

ผู้รับสายถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์) จุดเดียวในตาราง api_key_event_types
ปั๊มตึก A กับปั๊มตึก B จึงใช้เหตุการณ์ "ปั๊มหยุดทำงาน" ตัวเดียวกันแต่โทรหาคนละคนได้
เดิมที่นี่มี group_id เป็น "กลุ่มเริ่มต้น" อีกชั้น ตัดทิ้งแล้วเพราะทำให้คำถามว่า
"ยิงเหตุการณ์นี้แล้วใครได้รับสาย" ต้องไล่ดูสองที่เสมอ และคำตอบขึ้นกับว่าที่ไหนถูกตั้งไว้ก่อน
"""
from sqlalchemy.orm import Session

from app.database import EventType


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
    db: Session, code: str, display_name: str, message_template: str
) -> EventType:
    if get_event_type_by_code(db, code) is not None:
        raise DuplicateEventTypeCodeError(f"event type code '{code}' มีอยู่แล้ว")
    event_type = EventType(
        code=code, display_name=display_name, message_template=message_template
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
    is_active: bool | None = None,
) -> EventType | None:
    event_type = get_event_type(db, event_type_id)
    if event_type is None:
        return None
    if display_name is not None:
        event_type.display_name = display_name
    if message_template is not None:
        event_type.message_template = message_template
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


def render_message(template: str, variables: dict[str, str]) -> str:
    """
    แทนที่ {key} ใน template ด้วยค่าจาก variables — ถ้าขาดตัวแปรที่จำเป็นจะ raise ชัดเจน

    ทุกตัวแปรมาจาก payload ที่ยิงเข้ามาเท่านั้น ไม่มีตัวไหนถูกเติมให้เบื้องหลัง
    เดิม `{device}` ถูกเติมอัตโนมัติจากชื่ออุปกรณ์เจ้าของ API key ซึ่งอ่านแม่แบบแล้ว
    เดาไม่ออกว่าตัวไหนต้องส่งตัวไหนไม่ต้อง และกฎ "payload ชนะ" ยิ่งทำให้ประโยคที่พูดจริง
    ขึ้นกับสิ่งที่มองไม่เห็นในหน้าตั้งค่า ตอนนี้กฎเหลือข้อเดียว: เขียน {x} ในแม่แบบ
    ก็ต้องส่ง x มาใน variables เสมอ

    ชื่ออุปกรณ์ยังถูกบันทึกลงประวัติการโทรให้เอง (source_device) — ที่เลิกทำคือการเอาไป
    ยัดในประโยคที่พูด ไม่ใช่การรู้ว่าใครเป็นคนแจ้ง
    """
    try:
        return template.format(**variables)
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
