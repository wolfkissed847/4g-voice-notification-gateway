"""เพิ่มค่าตั้งค่า: เว้นช่วงก่อนพูด และจำนวนรอบที่พูดซ้ำ

Revision ID: c3f8a1b2d4e6
Revises: b7c4d1e9f230

ทั้งสองค่าเป็นของ app_settings ซึ่งเป็นตารางแถวเดียว (singleton) จึงเติมคอลัมน์
พร้อมค่า default แล้วเซ็ตให้แถวที่มีอยู่ในคราวเดียว ไม่ต้องมีขั้นตอน backfill แยก

ค่า default ที่เลือก:
  call_answer_delay_seconds = 2  คนรับสายต้องยกหูขึ้นแนบหูก่อน วัดจากพฤติกรรมจริง
                                 ประมาณ 2 วินาที ถ้าพูดทันทีประโยคต้นจะหายไปเลย
  call_repeat_count = 2          ฟังรอบเดียวมักจับใจความไม่ครบ โดยเฉพาะตอนเพิ่งตื่น
                                 หรืออยู่ในที่เสียงดัง ซึ่งเป็นสถานการณ์ปกติของงานนี้
"""

from alembic import op
import sqlalchemy as sa

revision = "c3f8a1b2d4e6"
down_revision = "b7c4d1e9f230"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # server_default ต้องมี ไม่งั้นแถวที่มีอยู่แล้วจะได้ NULL แล้ว worker อ่านมาคำนวณไม่ได้
    # (SQLite เติมคอลัมน์ใหม่ให้แถวเดิมเป็น NULL เสมอถ้าไม่บอก default)
    op.add_column(
        "app_settings",
        sa.Column("call_answer_delay_seconds", sa.Integer(), nullable=True, server_default="2"),
    )
    op.add_column(
        "app_settings",
        sa.Column("call_repeat_count", sa.Integer(), nullable=True, server_default="2"),
    )
    op.execute(
        "UPDATE app_settings SET call_answer_delay_seconds = 2 WHERE call_answer_delay_seconds IS NULL"
    )
    op.execute("UPDATE app_settings SET call_repeat_count = 2 WHERE call_repeat_count IS NULL")


def downgrade() -> None:
    # SQLite ลบคอลัมน์ตรงๆ ไม่ได้ ต้องให้ alembic สร้างตารางใหม่แล้วย้ายข้อมูลให้
    with op.batch_alter_table("app_settings") as batch:
        batch.drop_column("call_repeat_count")
        batch.drop_column("call_answer_delay_seconds")
