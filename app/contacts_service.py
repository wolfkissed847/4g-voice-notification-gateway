"""
Contacts Service — CRUD ของ Group/Contact (escalation chain)
แทนที่การ hardcode เบอร์โทรใน .env ทั้งหมด — call_worker ต้องเรียกผ่านที่นี่เท่านั้น
"""
import re

from sqlalchemy.orm import Session

from app.database import ApiKeyEventType, Contact, Group


class GroupInUseError(Exception):
    """ลบ group ไม่ได้เพราะยังถูกใช้เป็นผู้รับสายของคู่ (อุปกรณ์ + เหตุการณ์) อยู่"""


def list_groups(db: Session) -> list[Group]:
    return db.query(Group).order_by(Group.name.asc()).all()


def get_group(db: Session, group_id: int) -> Group | None:
    return db.query(Group).filter(Group.id == group_id).first()


def create_group(db: Session, name: str, description: str | None = None) -> Group:
    group = Group(name=name, description=description)
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def update_group(db: Session, group_id: int, name: str | None = None, description: str | None = None) -> Group | None:
    group = get_group(db, group_id)
    if group is None:
        return None
    if name is not None:
        group.name = name
    if description is not None:
        group.description = description
    db.commit()
    db.refresh(group)
    return group


def delete_group(db: Session, group_id: int) -> bool:
    group = get_group(db, group_id)
    if group is None:
        return False
    # เดิมเช็คกับ EventType.group_id ซึ่งถูก drop ไปแล้วตั้งแต่ revision b7c4d1e9f230
    # (ประเภทเหตุการณ์ไม่รู้จักกลุ่มอีกต่อไป) ผลคือบรรทัดนี้โยน AttributeError ทุกครั้งที่กดลบ
    # → 500 ที่ไม่มีใครดักไว้ ลบกลุ่มไม่ได้เลยสักกลุ่มตั้งแต่ 13 ส.ค. 2569
    #
    # ที่ต้องกันไว้จริงๆ คือ api_key_event_types.group_id ซึ่งเป็นตัวชี้ว่า
    # "คู่ (อุปกรณ์ + เหตุการณ์) นี้โทรหากลุ่มไหน" — FK ตัวนั้นไม่ได้ตั้ง ondelete ไว้
    # ปล่อยให้ลบจึงได้ FOREIGN KEY constraint failed เป็น 500 อีกแบบหนึ่งแทน
    in_use = db.query(ApiKeyEventType).filter(ApiKeyEventType.group_id == group_id).count()
    if in_use > 0:
        raise GroupInUseError(
            f"ลบ '{group.name}' ไม่ได้ เพราะยังถูกตั้งเป็นผู้รับสายอยู่ {in_use} จุด — "
            "ไปที่หน้าอุปกรณ์แล้วเปลี่ยนผู้รับสายของเหตุการณ์ที่ใช้กลุ่มนี้ก่อน"
        )
    db.delete(group)
    db.commit()
    return True


class InvalidPhoneNumberError(Exception):
    """เบอร์โทรผิดรูปแบบ — ห้ามปล่อยให้ลงฐานข้อมูล"""


# อนุญาตเฉพาะเครื่องหมาย + นำหน้า (เบอร์แบบสากล) และตัวเลข 8-15 หลัก
_PHONE_OK = re.compile(r"^\+?\d{8,15}$")


def normalize_phone_number(raw: str) -> str:
    """
    ตัดตัวคั่นที่คนพิมพ์ติดมา (ช่องว่าง ขีด วงเล็บ) แล้วตรวจว่าเหลือแต่ตัวเลขจริง

    ── ทำไมต้องตรวจตรงนี้ ────────────────────────────────────────────────────
    เบอร์ในตารางนี้ถูกเอาไปต่อท้ายคำสั่ง AT ตรงๆ เป็น `ATD<เบอร์>;` ที่ app/gsm_module.py
    ถ้าปล่อยให้มีอักขระขึ้นบรรทัดใหม่ปนเข้าไปได้ ข้อความหนึ่งบรรทัดจะกลายเป็นสองคำสั่ง
    เช่น เบอร์ที่มีอักขระขึ้นบรรทัดใหม่คั่นแล้วตามด้วย ATD ของเบอร์อื่น จะสั่งโมดูลโทรออกไปยังเบอร์ที่ไม่ได้ตั้งใจ
    นอกจากเรื่องความปลอดภัยแล้ว เบอร์ที่มีขีดหรือช่องว่าง (081-234-5678) ก็โทรไม่ออกอยู่ดี
    เพราะโมดูลไม่รู้จักอักขระพวกนี้ — ตรวจตั้งแต่ตอนบันทึกจึงได้ทั้งสองอย่างในที่เดียว
    """
    cleaned = re.sub(r"[\s\-().]", "", (raw or "").strip())
    if not _PHONE_OK.match(cleaned):
        raise InvalidPhoneNumberError(
            f"เบอร์โทร '{raw}' ไม่ถูกต้อง — ต้องเป็นตัวเลข 8-15 หลัก "
            "(ใส่ + นำหน้าได้สำหรับเบอร์ต่างประเทศ) ห้ามมีตัวอักษรหรือขึ้นบรรทัดใหม่"
        )
    return cleaned


def list_contacts(db: Session, group_id: int) -> list[Contact]:
    return (
        db.query(Contact)
        .filter(Contact.group_id == group_id)
        .order_by(Contact.order_index.asc())
        .all()
    )


def create_contact(db: Session, group_id: int, phone_number: str, name: str | None = None) -> Contact:
    max_index = (
        db.query(Contact)
        .filter(Contact.group_id == group_id)
        .count()
    )
    contact = Contact(
        group_id=group_id, phone_number=normalize_phone_number(phone_number),
        name=name, order_index=max_index,
    )
    db.add(contact)
    db.commit()
    db.refresh(contact)
    return contact


def get_contact(db: Session, contact_id: int) -> Contact | None:
    return db.query(Contact).filter(Contact.id == contact_id).first()


def update_contact(
    db: Session, contact_id: int, phone_number: str | None = None, name: str | None = None
) -> Contact | None:
    contact = get_contact(db, contact_id)
    if contact is None:
        return None
    if phone_number is not None:
        contact.phone_number = normalize_phone_number(phone_number)
    if name is not None:
        contact.name = name
    db.commit()
    db.refresh(contact)
    return contact


def delete_contact(db: Session, contact_id: int) -> bool:
    contact = get_contact(db, contact_id)
    if contact is None:
        return False
    db.delete(contact)
    db.commit()
    return True


def reorder_contacts(db: Session, group_id: int, ordered_ids: list[int]) -> list[Contact]:
    """เขียน order_index ใหม่ทั้งกลุ่มตามลำดับ id ที่ frontend ส่งมา"""
    contacts_by_id = {c.id: c for c in list_contacts(db, group_id)}
    for index, contact_id in enumerate(ordered_ids):
        contact = contacts_by_id.get(contact_id)
        if contact is not None:
            contact.order_index = index
    db.commit()
    return list_contacts(db, group_id)


def get_ordered_phone_numbers(db: Session, group_id: int) -> list[str]:
    """คืนเบอร์โทรตามลำดับ escalation ของกลุ่ม — ใช้โดย call_worker.py"""
    return [c.phone_number for c in list_contacts(db, group_id)]
