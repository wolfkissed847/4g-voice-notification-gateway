"""drop sms fallback

ตัดสินใจ 6 ส.ค. 2569: เอาแค่โทรอย่างเดียว ไม่มี SMS fallback แล้ว (ดู LIMITATIONS.md)
ลบ app_settings.sms_fallback_enabled — ไม่มี field อื่นอ้างอิงคอลัมน์นี้แล้วหลังลบโค้ดฝั่ง
config_service.py/schemas.py ออก (CallStatus.SMS_FALLBACK_SENT ก็ตัดออกจากโค้ดแล้วเช่นกัน
แต่เป็นแค่ Python enum ไม่ใช่ DB constraint จึงไม่ต้อง migrate อะไรเพิ่มสำหรับส่วนนั้น)

Revision ID: 6780eb253ed8
Revises: 5ca0b780423c
Create Date: 2026-08-06 14:56:49.479280

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6780eb253ed8'
down_revision: Union[str, Sequence[str], None] = '5ca0b780423c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_STATUS_WITH_SMS = (
    'QUEUED', 'IN_PROGRESS', 'CONNECTED', 'NO_ANSWER', 'BUSY',
    'RETRYING', 'ESCALATED', 'SMS_FALLBACK_SENT', 'FAILED', 'CANCELLED',
)
_STATUS_WITHOUT_SMS = (
    'QUEUED', 'IN_PROGRESS', 'CONNECTED', 'NO_ANSWER', 'BUSY',
    'RETRYING', 'ESCALATED', 'FAILED', 'CANCELLED',
)


def upgrade() -> None:
    """Upgrade schema."""
    # ต้องแปลงข้อมูลก่อนแก้ schema — job เก่าที่จบด้วย SMS_FALLBACK_SENT ยังค้างอยู่ใน DB ได้
    # ถ้าปล่อยไว้ SQLAlchemy จะ LookupError ตอนอ่านแถวนั้นขึ้นมาเป็น enum (ค่าหายไปจาก CallStatus แล้ว)
    # ทำให้ /history พังทั้งหน้าเพราะแถวเดียว — map เป็น FAILED ซึ่งตรงความหมายที่สุด (สุดท้ายก็โทรไม่ติด)
    op.execute("UPDATE call_jobs SET status = 'FAILED' WHERE status = 'SMS_FALLBACK_SENT'")
    op.execute("UPDATE call_logs SET result = 'failed' WHERE result = 'sms_fallback'")

    with op.batch_alter_table('app_settings', schema=None) as batch_op:
        batch_op.drop_column('sms_fallback_enabled')

    # ความยาว VARCHAR ของคอลัมน์ enum อิงค่าที่ยาวที่สุด — พอตัด SMS_FALLBACK_SENT (17 ตัว) ออก
    # จะเหลือ IN_PROGRESS (11 ตัว) ถ้าไม่ alter ตาม schema drift detection ตอน startup จะเตือนทุกครั้ง
    with op.batch_alter_table('call_jobs', schema=None) as batch_op:
        batch_op.alter_column(
            'status',
            existing_type=sa.Enum(*_STATUS_WITH_SMS, name='callstatus'),
            type_=sa.Enum(*_STATUS_WITHOUT_SMS, name='callstatus'),
            existing_nullable=True,
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('call_jobs', schema=None) as batch_op:
        batch_op.alter_column(
            'status',
            existing_type=sa.Enum(*_STATUS_WITHOUT_SMS, name='callstatus'),
            type_=sa.Enum(*_STATUS_WITH_SMS, name='callstatus'),
            existing_nullable=True,
        )

    with op.batch_alter_table('app_settings', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sms_fallback_enabled', sa.VARCHAR(), nullable=True))
