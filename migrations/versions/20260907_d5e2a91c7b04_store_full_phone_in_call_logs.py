"""เก็บเบอร์เต็มในประวัติการโทร แทนเบอร์ที่ถูก mask

Revision ID: d5e2a91c7b04
Revises: c3f8a1b2d4e6

ตาราง call_logs เคยเก็บเบอร์แบบ mask (081***678) ตั้งแต่ตอน insert เพราะกลัวเบอร์
เต็มโผล่ใน log ที่คนนอกอ่านได้ แต่ที่จริงตารางนี้ไม่ใช่ log ไฟล์ — มันคือ "ประวัติ
การโทร" ที่ผู้ใช้เปิดดูในเว็บหลังล็อกอินแล้ว และเป็นแหล่งเดียวที่ตอบได้ว่าเมื่อกี้
ระบบโทรหาเบอร์ไหนไปบ้าง เบอร์ที่อ่านไม่ครบจึงทำให้หน้านั้นตอบคำถามหลักของตัวเองไม่ได้
ต้องไปไล่เดาจากหน้ากลุ่มผู้รับว่าใครคือ 081***678

(เบอร์ทั้งหมดในระบบอยู่ในตาราง contacts แบบเต็มอยู่แล้ว การ mask ที่นี่จึงไม่ได้
 ปิดอะไรที่ยังไม่เปิดอยู่ดี — แค่ทำให้หน้าประวัติใช้งานยากขึ้นเฉยๆ)

เปลี่ยนชื่อคอลัมน์ด้วย ไม่ใช่แค่เลิก mask — ชื่อ phone_number_masked ที่เก็บเบอร์เต็ม
คือกับดักที่คนอ่านโค้ดรอบหน้าจะเชื่อชื่อมันแล้วเอาไปใช้ผิด

แถวเก่า 40 แถวที่ mask ไว้แล้วกู้กลับไม่ได้ (ข้อมูลถูกทิ้งตอนเขียน ไม่ได้ซ่อนไว้)
จึงยังเป็น 081***678 ต่อไป เฉพาะสายที่โทรหลังอัปเดตนี้เท่านั้นที่เห็นเบอร์เต็ม
"""

from alembic import op
import sqlalchemy as sa

revision = "d5e2a91c7b04"
down_revision = "c3f8a1b2d4e6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # batch mode: SQLite ทำ ALTER TABLE ได้จำกัด Alembic จะสร้างตารางใหม่แล้วก๊อปข้อมูลให้
    # (ตารางนี้มีไม่กี่สิบแถว ต้นทุนการก๊อปไม่มีนัยสำคัญ)
    with op.batch_alter_table("call_logs") as batch:
        batch.alter_column(
            "phone_number_masked",
            new_column_name="phone_number",
            existing_type=sa.String(),
        )


def downgrade() -> None:
    with op.batch_alter_table("call_logs") as batch:
        batch.alter_column(
            "phone_number",
            new_column_name="phone_number_masked",
            existing_type=sa.String(),
        )
