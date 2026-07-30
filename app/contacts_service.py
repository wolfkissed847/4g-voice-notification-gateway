"""
Contacts Service — CRUD ของ Group/Contact (escalation chain)
แทนที่การ hardcode เบอร์โทรใน .env ทั้งหมด — call_worker ต้องเรียกผ่านที่นี่เท่านั้น
"""
from sqlalchemy.orm import Session

from app.database import Contact, EventType, Group


class GroupInUseError(Exception):
    """ลบ group ไม่ได้เพราะยังมี event type ผูกอยู่"""


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
    if db.query(EventType).filter(EventType.group_id == group_id).count() > 0:
        raise GroupInUseError(f"กลุ่ม '{group.name}' ยังมี event type ผูกอยู่ ลบไม่ได้")
    db.delete(group)
    db.commit()
    return True


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
    contact = Contact(group_id=group_id, phone_number=phone_number, name=name, order_index=max_index)
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
        contact.phone_number = phone_number
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
