"""แยกประเภทเหตุการณ์ออกจากกลุ่ม + ให้เลือกผู้รับเป็นเบอร์รายตัวได้

Revision ID: b7c4d1e9f230
Revises: a1b2c3d4e5f6
Create Date: 2026-08-13

ทำไมต้องมี
──────────
โครงเดิมผูกกันเป็นลูกโซ่: ประเภทเหตุการณ์ต้องรู้จัก "กลุ่มเริ่มต้น" และอุปกรณ์เลือกผู้รับ
ได้แค่ระดับ "ทั้งกลุ่ม" เท่านั้น ทำให้เกิดปัญหาสองด้านพร้อมกัน

  1. ประเภทเหตุการณ์ควรเป็นแค่ "คำพูด" (รหัส + ชื่อ + ข้อความที่จะพูด) แต่ถูกบังคับให้
     ตอบคำถามว่าโทรหาใคร ทั้งที่ตอนสร้างยังไม่รู้เลยว่าอุปกรณ์ตัวไหนจะหยิบไปใช้
     ผลข้างเคียงคือมี "ผู้รับ" ซ่อนอยู่สองที่ ตอบคำถามว่าใครจะได้รับสายต้องไล่ดูสองจุดเสมอ

  2. เลือกได้แค่ทั้งกลุ่มหยาบเกินไป — กลุ่ม 'ทีมช่าง' มี 5 คน แต่เรื่อง 'ปั๊มตึก A ดับ'
     ควรโทรหาแค่ 2 คนที่ดูแลตึกนั้น ทางออกเดียวที่มีคือแตกกลุ่มใหม่ทุกครั้งที่ผู้รับ
     ต่างกันนิดเดียว จนได้กลุ่มซ้ำซ้อนที่สมาชิกเหลื่อมกัน แล้วเบอร์คนเดิมไปโผล่หลายกลุ่ม
     เปลี่ยนเบอร์ทีต้องไล่แก้ทุกกลุ่ม

หลังเปลี่ยน ผู้รับถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์) จุดเดียว เลือกได้ว่าจะเอาทั้งกลุ่ม
(api_key_event_types.group_id) หรือเจาะเป็นเบอร์รายตัว (api_key_event_contacts)

ลำดับขั้นสำคัญ
──────────────
ต้อง backfill กลุ่มเริ่มต้นของเหตุการณ์ลงไปที่ลิงก์ของอุปกรณ์ให้เสร็จ **ก่อน** ลบคอลัมน์ทิ้ง
ไม่งั้นอุปกรณ์ที่พึ่งค่าสำรองอยู่จะกลายเป็น "ไม่รู้ว่าโทรหาใคร" ทันทีที่ deploy
โดยไม่มีอะไรเตือน — คำขอที่ยิงเข้ามาจะถูกปฏิเสธทั้งหมดจนกว่าจะมีคนไปตั้งค่าใหม่ด้วยมือ
"""
from alembic import op
import sqlalchemy as sa

revision = "b7c4d1e9f230"
down_revision = "a1b2c3d4e5f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── 1. ย้ายกลุ่มเริ่มต้นของเหตุการณ์ไปไว้ที่ลิงก์ของอุปกรณ์ ก่อนที่จะลบต้นทางทิ้ง ──
    op.execute(
        """
        UPDATE api_key_event_types
           SET group_id = (
               SELECT e.group_id FROM event_types e
                WHERE e.id = api_key_event_types.event_type_id
           )
         WHERE group_id IS NULL
        """
    )

    # ── 2. ประเภทเหตุการณ์เลิกรู้จักกลุ่ม ──────────────────────────────────────
    with op.batch_alter_table("event_types") as batch_op:
        batch_op.drop_index("ix_event_types_group_id")
        batch_op.drop_column("group_id")

    # ── 3. ตารางเบอร์ที่เลือกเองรายคู่ (อุปกรณ์ + เหตุการณ์) ──────────────────
    # FK ผูกกลับไปที่คู่แบบ composite — ลบสิทธิ์ของอุปกรณ์ หรือลบอุปกรณ์/เหตุการณ์ทิ้ง
    # แถวพวกนี้หายตามเองโดยไม่ต้องไล่ลบในโค้ด (PRAGMA foreign_keys=ON ถูกตั้งทุก connection
    # ที่ app/database.py แล้ว จึงพึ่ง CASCADE ได้จริง ไม่ใช่แค่ประกาศไว้เฉยๆ)
    op.create_table(
        "api_key_event_contacts",
        sa.Column("api_key_id", sa.Integer(), nullable=False),
        sa.Column("event_type_id", sa.Integer(), nullable=False),
        sa.Column("contact_id", sa.Integer(), nullable=False),
        sa.Column("order_index", sa.Integer(), nullable=False, server_default="0"),
        sa.ForeignKeyConstraint(
            ["api_key_id", "event_type_id"],
            ["api_key_event_types.api_key_id", "api_key_event_types.event_type_id"],
            name="fk_api_key_event_contacts_link",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["contact_id"], ["contacts.id"],
            name="fk_api_key_event_contacts_contact_id_contacts",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint(
            "api_key_id", "event_type_id", "contact_id",
            name="pk_api_key_event_contacts",
        ),
    )

    # ── 4. งานโทรเก็บรายชื่อผู้รับที่ตัดสินใจแล้วติดตัวไป ────────────────────
    # งานเก่าเป็น NULL โดยตั้งใจ — call_worker ถอยไปอ่านจาก group_id ให้เอง
    # ไม่ backfill เพราะจะเป็นการเดา: กลุ่มวันนี้อาจไม่ใช่คนกลุ่มเดียวกับตอนที่โทรจริง
    with op.batch_alter_table("call_jobs") as batch_op:
        batch_op.add_column(sa.Column("recipients", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("call_jobs") as batch_op:
        batch_op.drop_column("recipients")

    op.drop_table("api_key_event_contacts")

    with op.batch_alter_table("event_types") as batch_op:
        batch_op.add_column(sa.Column("group_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_event_types_group_id_groups", "groups", ["group_id"], ["id"]
        )
        batch_op.create_index("ix_event_types_group_id", ["group_id"])
