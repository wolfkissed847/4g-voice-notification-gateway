"""เก็บกลุ่มผู้รับที่ตัดสินใจแล้วไว้ที่ตัวงานโทร (call_jobs.group_id)

Revision ID: a1b2c3d4e5f6
Revises: eee2373d7984
Create Date: 2026-08-11

ทำไมต้องมี
──────────
กลุ่มที่จะโทรหาจริงมาจากคู่ (อุปกรณ์ + เหตุการณ์) ซึ่งรู้ได้เฉพาะตอนรับคำขอเท่านั้น
เดิมเก็บไว้แค่ "ชื่อกลุ่ม" (priority_group) ซึ่งเป็นข้อความสำหรับแสดงผล ไม่ใช่ค่าที่อ้างอิงกลับได้
call_worker จึงไปอ่าน event_types.group_id เอาเอง ซึ่งเป็น "กลุ่มเริ่มต้นของเหตุการณ์" คนละค่ากัน
ผลที่เกิดขึ้นจริง 2 อย่าง:
  1. อุปกรณ์ที่ตั้งกลุ่มเฉพาะของตัวเองไว้ → ระบบโทรหากลุ่มอื่น
  2. เหตุการณ์ที่ไม่ได้ตั้งกลุ่มเริ่มต้น (โมเดลที่ใช้อยู่ตอนนี้) → หาเบอร์ไม่เจอ ปิดงานเป็น
     failed ทันทีโดยไม่โทรสักครั้ง

backfill
────────
งานเก่าเทียบชื่อกลุ่มจาก priority_group กลับไปหา groups.id ให้ เท่าที่ชื่อยังตรงกันอยู่
(ชื่อที่ถูกเปลี่ยนหรือกลุ่มที่ถูกลบไปแล้วจะเป็น NULL ซึ่งถูกต้อง — ไม่มีข้อมูลก็ไม่ควรเดา)
"""
from alembic import op
import sqlalchemy as sa

revision = "a1b2c3d4e5f6"
down_revision = "eee2373d7984"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("call_jobs") as batch_op:
        batch_op.add_column(sa.Column("group_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_call_jobs_group_id_groups", "groups", ["group_id"], ["id"], ondelete="SET NULL"
        )
    op.create_index("ix_call_jobs_group_id", "call_jobs", ["group_id"])

    op.execute(
        """
        UPDATE call_jobs
           SET group_id = (SELECT g.id FROM groups g WHERE g.name = call_jobs.priority_group)
         WHERE group_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_call_jobs_group_id", table_name="call_jobs")
    with op.batch_alter_table("call_jobs") as batch_op:
        batch_op.drop_constraint("fk_call_jobs_group_id_groups", type_="foreignkey")
        batch_op.drop_column("group_id")
