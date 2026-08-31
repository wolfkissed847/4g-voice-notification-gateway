"""
เทสถดถอย (regression test) ของ 4G Voice Notification Gateway

รันได้ทุกที่ที่รันแอปได้ ไม่ต้องมี pytest:
    python tests/selftest.py

เทสชุดนี้สร้างฐานข้อมูลใหม่ในโฟลเดอร์ชั่วคราวทุกครั้ง ไม่แตะ gateway.db ตัวจริง
และไม่แตะฮาร์ดแวร์จริง (โมดูล GSM ถูกสลับเป็นตัวปลอม) จึงรันบน Pi ระหว่างที่ระบบเดินอยู่ได้

แต่ละหัวข้อผูกกับบั๊กที่เคยเกิดขึ้นจริงหนึ่งตัว — ถ้าเทสไหนแดง แปลว่าบั๊กตัวนั้นกลับมาแล้ว
"""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TMP = tempfile.mkdtemp(prefix="gw-selftest-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TMP, "t.db").replace("\\", "/")
os.environ["JWT_SECRET_KEY"] = "selftest-secret-that-is-long-enough-to-pass-check"
os.environ["ENABLE_API_DOCS"] = "false"
os.environ["AUDIO_CACHE_DIR"] = os.path.join(_TMP, "audio")

import bcrypt

# รหัสผ่าน "test1234" — hash สร้างสดทุกครั้ง ไม่ใช่ค่าจริงของที่ไหน
os.environ["ADMIN_PASSWORD_HASH"] = bcrypt.hashpw(b"test1234", bcrypt.gensalt()).decode()

_passed, _failed = [], []


def check(name, condition, detail=""):
    (_passed if condition else _failed).append(name)
    mark = "ผ่าน" if condition else "ตก  "
    print(f"  [{mark}] {name}" + (f"   {detail}" if detail else ""))


def section(title):
    line = "=" * 70
    print(f"\n{line}\n{title}\n{line}")


# ---------------------------------------------------------------------------
section("0. schema สร้างจาก migration ได้จริง")
# ---------------------------------------------------------------------------
import sqlalchemy as sa

from app.database import CallJob, CallStatus, SessionLocal, detect_schema_drift, engine, init_db

init_db()
drift = detect_schema_drift()
check("alembic upgrade head แล้ว schema ตรงกับ model", not drift, f"drift={len(drift)}" if drift else "")

_insp = sa.inspect(engine)
cols = {c["name"] for c in _insp.get_columns("call_jobs")}
check("call_jobs มีคอลัมน์ group_id", "group_id" in cols)
check("call_jobs เก็บรายชื่อผู้รับติดงาน (recipients)", "recipients" in cols)
check("ประเภทเหตุการณ์เลิกผูกกับกลุ่มแล้ว (ไม่มีคอลัมน์ group_id)",
      "group_id" not in {c["name"] for c in _insp.get_columns("event_types")})
check("มีตารางเบอร์ที่เลือกเองรายอุปกรณ์", "api_key_event_contacts" in _insp.get_table_names())

# ---------------------------------------------------------------------------
section("0.1 migration ทนต่อเศษตารางที่ค้างจากรอบที่ล้มกลางคัน")
# ---------------------------------------------------------------------------
# เคสนี้เคยทำให้แอปสตาร์ตไม่ขึ้นเลยและ container วนรีสตาร์ตไม่จบ:
# batch migration ที่ตายกลางคันทิ้งตาราง _alembic_tmp_<ชื่อ> ไว้ แล้ว migration
# รอบถัดไปทุกรอบจะล้มด้วย "table _alembic_tmp_xxx already exists"
import shutil as _shutil
import tempfile as _tempfile

_MIG_TMP = _tempfile.mkdtemp(prefix="gw-mig-")
try:
    _url = "sqlite:///" + os.path.join(_MIG_TMP, "mig.db").replace("\\", "/")
    _eng = sa.create_engine(_url)
    from alembic import command as _cmd
    from alembic.config import Config as _Cfg

    _cfg = _Cfg()
    _cfg.set_main_option("script_location", os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "migrations"))
    _cfg.set_main_option("sqlalchemy.url", _url)

    _prev = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = _url          # env.py อ่าน URL จาก settings
    import importlib

    import app.config as _conf
    importlib.reload(_conf)

    _cmd.upgrade(_cfg, "eee2373d7984")
    with _eng.begin() as _c:
        _c.execute(sa.text("CREATE TABLE _alembic_tmp_call_jobs (id INTEGER)"))
        _c.execute(sa.text("INSERT INTO groups (id, name) VALUES (1, 'ทีมช่าง')"))
        _c.execute(sa.text(
            "INSERT INTO call_jobs (id, message, priority_group, contact_index,"
            " retry_count, status, created_at)"
            " VALUES (1, 'm', 'ทีมช่าง', 0, 0, 'CONNECTED', '2026-08-01')"))
    _cmd.upgrade(_cfg, "head")
    from alembic.script import ScriptDirectory as _Script

    _head = _Script.from_config(_cfg).get_current_head()
    with _eng.begin() as _c:
        _rev = _c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
        _row = _c.execute(sa.text("SELECT group_id FROM call_jobs WHERE id = 1")).scalar()
        _left = _c.execute(sa.text(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE '_alembic_tmp_%'")).scalar()
    _eng.dispose()
    # เทียบกับ head จริงของโฟลเดอร์ migration ไม่ฝังเลข revision ไว้ในเทส —
    # ไม่งั้นทุกครั้งที่เพิ่ม migration ใหม่ เทสข้อนี้จะแดงทั้งที่ระบบไม่ได้พังอะไรเลย
    check("migration ผ่านแม้มีเศษตารางค้าง", _rev == _head, f"revision={_rev} head={_head}")
    check("ลบเศษตารางทิ้งให้เอง", _left == 0)
    check("ประวัติเก่าไม่หายและถูกเติม group_id ย้อนหลัง", _row == 1, f"group_id={_row}")
    os.environ["DATABASE_URL"] = _prev
    importlib.reload(_conf)
finally:
    _shutil.rmtree(_MIG_TMP, ignore_errors=True)


# ---------------------------------------------------------------------------
section("1. ผู้รับสายถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์) จุดเดียว  (บั๊กร้ายแรง)")
# ---------------------------------------------------------------------------
import app.api_key_service as ks
import app.contacts_service as cs
import app.event_types_service as es
from app.contacts_service import get_ordered_phone_numbers
from app.queue_manager import claim_next_job, enqueue_job, recover_orphaned_jobs

db = SessionLocal()
ga = cs.create_group(db, name="ช่างตึก A")
cs.create_contact(db, group_id=ga.id, phone_number="0810000001", name="ช่าง A1")
gb = cs.create_group(db, name="ช่างตึก B")
cb1 = cs.create_contact(db, group_id=gb.id, phone_number="0820000002", name="ช่าง B1")
cb2 = cs.create_contact(db, group_id=gb.id, phone_number="0820000003", name="ช่าง B2")

# เหตุการณ์เป็น "คลังคำพูด" ล้วน สร้างทิ้งไว้เฉยๆ โดยไม่ผูกกับกลุ่มหรือเบอร์ใดๆ ได้
ev = es.create_event_type(
    db, code="pump_stop", display_name="ปั๊มหยุดทำงาน",
    message_template="แจ้งเหตุ {device} ปั๊มหยุดทำงาน",
)
check("สร้างประเภทเหตุการณ์ได้โดยไม่ต้องผูกกลุ่มหรือเบอร์",
      "group_id" not in {c.name for c in ev.__table__.columns})

dev_a, key_a = ks.create_api_key(db, name="ปั๊มตึก A", event_type_ids=[ev.id])
ks.set_event_links(db, dev_a, [{"event_type_id": ev.id, "group_id": ga.id}])

dev_b, key_b = ks.create_api_key(db, name="ปั๊มตึก B", event_type_ids=[ev.id])
# เลือกเบอร์เองจากกลุ่ม B และ "สลับลำดับ" ให้ต่างจากลำดับในกลุ่มต้นทาง
ks.set_event_links(db, dev_b, [{"event_type_id": ev.id, "contact_ids": [cb2.id, cb1.id]}])
db.commit()

rec_a, label_a, gid_a = ks.resolve_recipients(db, dev_a, ev.id)
rec_b, label_b, gid_b = ks.resolve_recipients(db, dev_b, ev.id)

check("อุปกรณ์ที่เลือก 'ทั้งกลุ่ม' ได้ทุกเบอร์ในกลุ่มนั้น",
      [r["phone"] for r in rec_a] == ["0810000001"] and gid_a == ga.id)
check("อุปกรณ์ที่ 'เลือกเบอร์เอง' ได้เฉพาะเบอร์ที่เลือก ตามลำดับที่จัดไว้เอง",
      [r["phone"] for r in rec_b] == ["0820000003", "0820000002"],
      f"ได้ {[r['phone'] for r in rec_b]}")
check("เลือกเบอร์เองแล้วไม่ถูกผูกกับกลุ่มไหน", gid_b is None)
check("ป้ายชื่อผู้รับอ่านรู้เรื่องในประวัติ",
      label_a == "ช่างตึก A" and label_b == "เลือกเอง 2 เบอร์", f"{label_a!r} / {label_b!r}")

# อุปกรณ์ตัวเดียวกันใช้เหตุการณ์เดียวกัน แต่คนละคนได้รับสาย — คือหัวใจของการรื้อรอบนี้
check("อุปกรณ์คนละตัวใช้เหตุการณ์เดียวกันแต่โทรหาคนละคน",
      {r["phone"] for r in rec_a}.isdisjoint({r["phone"] for r in rec_b}))

dev_c, key_c = ks.create_api_key(db, name="ปั๊มตึก C", event_type_ids=[ev.id])
db.commit()
try:
    ks.resolve_recipients(db, dev_c, ev.id)
    check("อุปกรณ์ที่ยังไม่เลือกผู้รับ ถูกปฏิเสธพร้อมบอกทางแก้", False)
except ks.RecipientsNotConfiguredError as exc:
    check("อุปกรณ์ที่ยังไม่เลือกผู้รับ ถูกปฏิเสธพร้อมบอกทางแก้", "หน้าตั้งค่าอุปกรณ์" in str(exc))

g_empty = cs.create_group(db, name="กลุ่มที่ยังไม่มีเบอร์")
ks.set_event_links(db, dev_c, [{"event_type_id": ev.id, "group_id": g_empty.id}])
db.commit()
try:
    ks.resolve_recipients(db, dev_c, ev.id)
    check("เลือกกลุ่มที่ไม่มีเบอร์เลย ถูกดักตั้งแต่รับคำขอ ไม่ปล่อยเข้าคิวไปตาย", False)
except ks.RecipientsNotConfiguredError as exc:
    check("เลือกกลุ่มที่ไม่มีเบอร์เลย ถูกดักตั้งแต่รับคำขอ ไม่ปล่อยเข้าคิวไปตาย",
          "ยังไม่มีเบอร์" in str(exc))

# เลือกเบอร์เองแล้วต้องล้าง group_id ทิ้ง ไม่ให้เหลือสองคำตอบค้างในฐานข้อมูลพร้อมกัน
ks.set_event_links(db, dev_c, [{"event_type_id": ev.id, "group_id": ga.id, "contact_ids": [cb1.id]}])
db.commit()
_link_c = ks.link_for(dev_c, ev.id)
check("ส่งมาทั้งกลุ่มและเบอร์ ระบบยึดเบอร์ที่เลือกและล้างกลุ่มทิ้ง",
      _link_c.group_id is None and [c.contact_id for c in _link_c.contacts] == [cb1.id])

job_a = enqueue_job(
    db, message="m", event_type_id=ev.id, priority_group=label_a, group_id=gid_a,
    recipients=json.dumps(rec_a, ensure_ascii=False),
    api_key_id=dev_a.id, source_device=dev_a.name,
    event_type_code=ev.code, event_type_name=ev.display_name,
)
job_b = enqueue_job(
    db, message="m", event_type_id=ev.id, priority_group=label_b, group_id=gid_b,
    recipients=json.dumps(rec_b, ensure_ascii=False),
    api_key_id=dev_b.id, source_device=dev_b.name,
    event_type_code=ev.code, event_type_name=ev.display_name,
)
check("งานพกรายชื่อผู้รับติดตัวไปตั้งแต่ตอนเข้าคิว",
      json.loads(job_b.recipients)[0]["name"] == "ช่าง B2")

# ---------------------------------------------------------------------------
section("2. worker หยิบงานแล้วโทรได้จริง (โมดูลปลอม)")
# ---------------------------------------------------------------------------
import app.call_worker as cw
from app.config_service import get_effective_config


class FakeGSM:
    """โมดูลปลอม — บันทึกว่าถูกสั่งโทรไปเบอร์ไหน แทนที่จะแตะพอร์ตอนุกรมจริง"""

    def __init__(self, result="connected", stay_active=True):
        self.dialed, self.result, self.played = [], result, 0
        # ปลายสายยังไม่วางไหม — ใช้ทดสอบว่าการพูดซ้ำหยุดเองตอนสายหลุดกลางคัน
        self.stay_active = stay_active

    def call_is_active(self):
        return self.stay_active

    def prepare_audio(self, path, on_progress=None):
        pass

    def dial(self, number):
        self.dialed.append(number)
        return self.result

    def play_audio(self):
        self.played += 1

    def hangup(self):
        pass


cw.text_to_speech = lambda text: os.path.join(_TMP, "fake.mp3")  # ไม่เรียก gTTS จริง
cfg = get_effective_config(db)
# เร่งเทสให้เร็ว — ค่าจริงหน่วง 2 วิก่อนพูด + 1.5 วิระหว่างรอบ ซึ่งไม่ได้เพิ่มความมั่นใจอะไร
# ในเทสแต่ทำให้ชุดทดสอบช้าลงทุกครั้งที่รัน (ตรรกะการเว้นช่วงเป็นแค่ time.sleep ตรงๆ)
cfg.call_answer_delay_seconds = 0
cw.REPEAT_GAP_SECONDS = 0

gsm = FakeGSM("connected")
claimed = claim_next_job(db)
cw.process_job(db, claimed, gsm, cfg)
db.refresh(claimed)
check("โทรออกไปยังเบอร์ของกลุ่มที่ผูกกับอุปกรณ์นั้น", gsm.dialed == ["0810000001"], f"โทรไป {gsm.dialed}")
check(
    f"พูดข้อความซ้ำครบ {cfg.call_repeat_count} รอบตามที่ตั้งไว้",
    gsm.played == cfg.call_repeat_count,
    f"พูดไป {gsm.played} รอบ",
)
check("ปิดงานเป็น connected", claimed.status == CallStatus.CONNECTED)

# ปลายสายวางก่อนพูดรอบสอง — ต้องหยุดเองไม่ใช่ฝืนสั่งเล่นซ้ำจนค้างรอ URC ที่ไม่มีวันมา
# group_id=None โดยตั้งใจ — งานนี้ต้องไม่ไปโผล่ในเทสกรองตามกลุ่มที่อยู่ถัดลงไป
enqueue_job(
    db, message="ทดสอบวางสายกลางคัน", event_type_id=ev.id,
    priority_group="เทสวางสายกลางคัน", group_id=None,
    recipients=json.dumps([{"name": None, "phone": "0810000001"}], ensure_ascii=False),
    event_type_code=ev.code, event_type_name=ev.display_name,
)
gsm_drop = FakeGSM("connected", stay_active=False)
claimed_drop = claim_next_job(db)
cw.process_job(db, claimed_drop, gsm_drop, cfg)
check(
    "ปลายสายวางกลางคัน หยุดพูดซ้ำทันที (พูดแค่รอบเดียว)",
    gsm_drop.played == 1,
    f"พูดไป {gsm_drop.played} รอบ",
)

gsm2 = FakeGSM("no_answer")
claimed_b = claim_next_job(db)
for _ in range(cfg.call_retry_count + 1):
    claimed_b.next_attempt_at = None
    db.commit()
    cw.process_job(db, claimed_b, gsm2, cfg)
    db.refresh(claimed_b)
check("ครบโควตาโทรซ้ำแล้วเลื่อนไปเบอร์ถัดไป",
      claimed_b.status == CallStatus.ESCALATED and claimed_b.contact_index == 1,
      f"status={claimed_b.status.value} index={claimed_b.contact_index}")

# งานที่เข้าคิวแล้วต้องไม่เปลี่ยนผู้รับกลางคัน แม้จะมีคนไปแก้กลุ่มพอดีระหว่างนั้น
# เดิม worker อ่านกลุ่มสดๆ ทุกครั้งที่จะโทร การเพิ่ม/ลบเบอร์ระหว่างที่งานกำลังไล่สาย
# จึงทำให้ contact_index ที่ชี้อยู่กระโดดไปคนละคนโดยไม่มีอะไรบอก
_rec_x, _label_x, _gid_x = ks.resolve_recipients(db, dev_a, ev.id)
job_x = enqueue_job(
    db, message="m", event_type_id=ev.id, priority_group=_label_x, group_id=_gid_x,
    recipients=json.dumps(_rec_x, ensure_ascii=False),
    api_key_id=dev_a.id, source_device=dev_a.name,
)
cs.create_contact(db, group_id=ga.id, phone_number="0899999999", name="คนที่เพิ่งถูกเพิ่มทีหลัง")
db.commit()
gsm_x = FakeGSM("connected")
claimed_x = claim_next_job(db)
cw.process_job(db, claimed_x, gsm_x, cfg)
check("แก้กลุ่มหลังงานเข้าคิวแล้ว ไม่เปลี่ยนผู้รับของงานที่กำลังไล่สายอยู่",
      gsm_x.dialed == ["0810000001"], f"โทรไป {gsm_x.dialed}")

# ---------------------------------------------------------------------------
section("3. ประวัติการโทร กรองด้วยกลุ่มได้ถูกต้อง")
# ---------------------------------------------------------------------------
n_a = db.query(CallJob).filter(CallJob.group_id == ga.id).count()
n_b = db.query(CallJob).filter(CallJob.group_id == gb.id).count()
n_none = db.query(CallJob).filter(CallJob.group_id.is_(None)).count()
check("กรองกลุ่ม A เจอเฉพาะงานที่สั่งโทรทั้งกลุ่ม A", n_a == 2, f"ได้ {n_a}")
# งานที่ 'เลือกเบอร์เอง' ไม่ได้สังกัดกลุ่มไหน จึงต้องไม่โผล่ในผลกรองรายกลุ่ม
# (ตั้งใจให้เป็นแบบนี้ ไม่ใช่ข้อมูลหาย — ป้ายชื่อผู้รับยังอยู่ครบใน priority_group)
check("งานที่เลือกเบอร์เองไม่ถูกนับเข้ากลุ่มต้นทางของเบอร์", n_b == 0, f"ได้ {n_b}")
check("งานที่เลือกเบอร์เองยังอยู่ในประวัติ ไม่ได้หายไปไหน", n_none >= 1, f"ได้ {n_none}")

# ---------------------------------------------------------------------------
section("4. ตรวจรูปแบบเบอร์โทร (กันคำสั่ง AT แทรก)")
# ---------------------------------------------------------------------------
from app.contacts_service import InvalidPhoneNumberError, normalize_phone_number

check("ตัดขีดและช่องว่างให้อัตโนมัติ", normalize_phone_number("081-234 5678") == "0812345678")
check("รับเบอร์ต่างประเทศที่ขึ้นต้นด้วย +", normalize_phone_number("+66812345678") == "+66812345678")

_INJECTED = "0810000001" + chr(13) + chr(10) + "ATD0899999999"
for bad, label in [(_INJECTED, "เบอร์ที่แทรกคำสั่ง AT"),
                   ("081abc5678", "เบอร์ที่มีตัวอักษร"),
                   ("123", "เบอร์สั้นเกินไป")]:
    try:
        normalize_phone_number(bad)
        check("ปฏิเสธ" + label, False)
    except InvalidPhoneNumberError:
        check("ปฏิเสธ" + label, True)

from app.gsm_module import GSMModule

g = GSMModule()
g.ser = object()  # ผ่านด่านเช็ค connect() เพื่อทดสอบเฉพาะด่านตรวจเบอร์
try:
    g.dial(_INJECTED)
    check("gsm.dial ปฏิเสธเบอร์ที่มีขึ้นบรรทัดใหม่ (ด่านที่สอง)", False)
except ValueError:
    check("gsm.dial ปฏิเสธเบอร์ที่มีขึ้นบรรทัดใหม่ (ด่านที่สอง)", True)

# ---------------------------------------------------------------------------
section("5. ประเภทเหตุการณ์เป็นคลังคำพูดล้วน + แม่แบบข้อความ")
# ---------------------------------------------------------------------------
ev2 = es.create_event_type(db, code="tmp", display_name="t", message_template="t")
es.update_event_type(db, ev2.id, display_name="ชื่อใหม่", message_template="ข้อความใหม่")
db.refresh(ev2)
check("สร้าง/แก้ประเภทเหตุการณ์ได้โดยไม่ต้องยุ่งกับกลุ่มหรือเบอร์",
      ev2.display_name == "ชื่อใหม่" and ev2.message_template == "ข้อความใหม่")

es.delete_event_type(db, ev2.id)
check("ลบประเภทเหตุการณ์ที่ยังไม่ถูกใช้ได้", es.get_event_type(db, ev2.id) is None)

try:
    es.render_message("อุณหภูมิ {} ที่ {device}", {}, device_name="d")
    check("แม่แบบที่มีวงเล็บว่าง ไม่กลายเป็น 500", False)
except es.MissingTemplateVariableError:
    check("แม่แบบที่มีวงเล็บว่าง ตอบเป็นข้อความบอกสาเหตุแทน 500", True)

check("เติมชื่ออุปกรณ์ให้อัตโนมัติ",
      es.render_message("เหตุที่ {device}", {}, device_name="ปั๊ม A") == "เหตุที่ ปั๊ม A")

# ---------------------------------------------------------------------------
section("6. กู้งานค้างเมื่อระบบดับกลางสาย")
# ---------------------------------------------------------------------------
stuck = enqueue_job(db, message="m", event_type_id=ev.id, priority_group=ga.name, group_id=ga.id,
                    recipients=json.dumps([{"name": None, "phone": "0810000001"}]))
stuck.status = CallStatus.IN_PROGRESS
db.commit()
recovered = recover_orphaned_jobs(db)
db.refresh(stuck)
check("งานที่ค้าง in_progress ถูกดึงกลับเข้าคิว",
      recovered >= 1 and stuck.status == CallStatus.QUEUED)

GA_ID, GB_ID = ga.id, gb.id  # เก็บเป็นตัวเลขก่อนปิด session
EV_ID, DEV_A_ID, DEV_C_ID = ev.id, dev_a.id, dev_c.id
CB1_ID, CB2_ID = cb1.id, cb2.id
db.close()

# ---------------------------------------------------------------------------
section("7. ด่านความปลอดภัยระดับ HTTP")
# ---------------------------------------------------------------------------
try:
    from fastapi.testclient import TestClient

    import app.login_guard as login_guard
    import app.main as main_mod

    client = TestClient(main_mod.app, raise_server_exceptions=False)

    r = client.get("/history")
    check("เรียก /history โดยไม่ล็อกอิน ถูกปฏิเสธ", r.status_code in (401, 422), f"ได้ {r.status_code}")

    r = client.post("/notify", json={"event_type_code": "pump_stop"})
    check("ยิง /notify โดยไม่มี API key ถูกปฏิเสธ", r.status_code in (401, 422), f"ได้ {r.status_code}")

    r = client.post("/notify", headers={"X-API-Key": "gw_live_definitely_wrong_key"},
                    json={"event_type_code": "pump_stop"})
    check("API key ผิด ถูกปฏิเสธ 401", r.status_code == 401, f"ได้ {r.status_code}")

    r = client.post("/notify", headers={"X-API-Key": key_a},
                    json={"event_type_code": "pump_stop", "message": "ก" * 5000})
    check("ข้อความยาว 5000 ตัวอักษร ถูกปฏิเสธ (กันคิวตัน)", r.status_code == 422, f"ได้ {r.status_code}")

    r = client.post("/notify", headers={"X-API-Key": key_a}, json={"event_type_code": "pump_stop"})
    check("อุปกรณ์ที่มีสิทธิ์ยิงเข้าคิวได้จริง", r.status_code == 200, f"ได้ {r.status_code}")

    # ปิดสวิตช์แล้ว /openapi.json ต้องไม่คายสเปค API ออกมา (จะได้หน้าเว็บ SPA แทนซึ่งไม่เป็นไร)
    r = client.get("/openapi.json")
    leaked = "application/json" in r.headers.get("content-type", "") and "paths" in r.text
    check("สเปค API ไม่รั่วออก /openapi.json เมื่อปิดสวิตช์", not leaked,
          f"content-type={r.headers.get('content-type', '')[:30]}")
    r = client.get("/docs")
    check("/docs ไม่แสดงหน้าเอกสาร Swagger", "swagger-ui" not in r.text.lower())

    login_guard._failures.clear()
    codes = [client.post("/auth/login", json={"username": "admin", "password": "ผิด"}).status_code
             for _ in range(login_guard.MAX_FAILURES + 2)]
    check("ล็อกอินผิดรัวๆ ถูกเบรกด้วย 429", 429 in codes,
          f"401 จำนวน {codes.count(401)} ครั้ง แล้วเป็น 429 จำนวน {codes.count(429)} ครั้ง")

    login_guard._failures.clear()
    r = client.post("/auth/login", json={"username": "admin", "password": "test1234"})
    check("รหัสผ่านถูกต้อง ล็อกอินได้", r.status_code == 200 and "access_token" in r.json())

    token = r.json()["access_token"]
    auth = {"Authorization": f"Bearer {token}"}

    r = client.post(f"/groups/{GA_ID}/contacts", headers=auth,
                    json={"phone_number": "081-999 8888", "name": "ทดสอบ"})
    check("บันทึกเบอร์ที่มีขีด แล้วถูกตัดให้เรียบร้อย",
          r.status_code == 200 and r.json()["phone_number"] == "0819998888",
          r.text[:60] if r.status_code != 200 else "")

    r = client.post(f"/groups/{GA_ID}/contacts", headers=auth, json={"phone_number": _INJECTED})
    check("บันทึกเบอร์ที่แทรกคำสั่ง AT ไม่ได้", r.status_code in (400, 422), f"ได้ {r.status_code}")

    r = client.get("/history?group_id=%d" % GA_ID, headers=auth)
    check("กรองประวัติด้วยกลุ่มผ่าน API ได้ผลจริง",
          r.status_code == 200 and r.json()["total_count"] >= 1,
          f"ได้ {r.status_code} total={r.json().get('total_count') if r.status_code == 200 else '-'}")

    # -----------------------------------------------------------------------
    # โมเดลผู้รับแบบใหม่ผ่านหน้าเว็บจริง
    r = client.post("/event-types", headers=auth, json={
        "code": "http_only_words", "display_name": "เหตุการณ์คำพูดล้วน",
        "message_template": "ทดสอบจาก {device}",
    })
    check("สร้างประเภทเหตุการณ์ผ่าน API ได้โดยไม่ต้องส่งกลุ่มมาเลย",
          r.status_code == 200 and "group_id" not in r.json(),
          f"ได้ {r.status_code} {list(r.json())[:6] if r.status_code == 200 else r.text[:60]}")

    r = client.put(f"/api-keys/{DEV_A_ID}", headers=auth, json={
        "event_links": [{"event_type_id": EV_ID, "contact_ids": [CB2_ID, CB1_ID]}],
    })
    _ref = r.json()["allowed_event_types"][0] if r.status_code == 200 else {}
    check("ตั้งผู้รับเป็นเบอร์รายตัวผ่าน API แล้วอ่านกลับมาได้ครบตามลำดับ",
          r.status_code == 200
          and [c["id"] for c in _ref.get("contacts", [])] == [CB2_ID, CB1_ID]
          and _ref.get("group_id") is None,
          f"ได้ {r.status_code} {r.text[:90] if r.status_code != 200 else ''}")
    check("ผู้รับรายตัวบอกด้วยว่ามาจากกลุ่มไหน (ไว้แสดงในหน้าเว็บ)",
          bool(_ref.get("contacts")) and _ref["contacts"][0].get("group_name"))

    r = client.put(f"/api-keys/{DEV_A_ID}", headers=auth, json={
        "event_links": [{"event_type_id": EV_ID, "contact_ids": [999999]}],
    })
    check("อ้างถึงเบอร์ที่ไม่มีอยู่จริง ถูกปฏิเสธ ไม่ใช่ 500",
          r.status_code in (400, 404, 422), f"ได้ {r.status_code}")

    r = client.post("/test/notify", headers=auth, json={"event_type_code": "pump_stop"})
    check("กดทดสอบโดยไม่บอกว่าเป็นอุปกรณ์ไหน ถูกปฏิเสธ (ไม่มีค่าเริ่มต้นให้เดาแล้ว)",
          r.status_code == 422, f"ได้ {r.status_code}")

    r = client.post("/test/notify", headers=auth,
                    json={"event_type_code": "pump_stop", "device_id": DEV_A_ID})
    check("กดทดสอบโดยระบุอุปกรณ์ เข้าคิวได้จริง", r.status_code == 200, f"ได้ {r.status_code}")

    # อุปกรณ์ที่ชี้ไปยังกลุ่มว่าง ต้องได้ 400 พร้อมคำอธิบาย ไม่ใช่เข้าคิวไปเงียบๆ แล้วตายทีหลัง
    r = client.put(f"/api-keys/{DEV_C_ID}", headers=auth, json={
        "event_links": [{"event_type_id": EV_ID, "group_id": None}],
    })
    r = client.post("/test/notify", headers=auth,
                    json={"event_type_code": "pump_stop", "device_id": DEV_C_ID})
    check("อุปกรณ์ที่ยังไม่เลือกผู้รับ ถูกปฏิเสธ 400 พร้อมบอกทางแก้",
          r.status_code == 400 and "หน้าตั้งค่าอุปกรณ์" in r.text,
          f"ได้ {r.status_code} {r.text[:70]}")

    # -----------------------------------------------------------------------
    # ค่า config ที่หลุดขอบเขตทำให้ระบบค้างโดยไม่มี error — ช่อง min/max ฝั่งเว็บ
    # กันได้แค่คนที่กรอกผ่านหน้าเว็บ ต้องมีด่านฝั่ง API ด้วย
    r = client.put("/config", headers=auth, json={"call_ring_timeout_seconds": 100000})
    check("ตั้งเวลาดังสายนานเกินจริง ถูกปฏิเสธ (กัน worker ค้างทั้งคิว)",
          r.status_code == 422, f"ได้ {r.status_code}")

    r = client.put("/config", headers=auth, json={"call_retry_delay_seconds": 0})
    check("ตั้งรอ 0 วินาทีก่อนโทรซ้ำ ถูกปฏิเสธ (กันสแปมโทร)",
          r.status_code == 422, f"ได้ {r.status_code}")

    r = client.put("/config", headers=auth, json={"call_retry_count": -1})
    check("ตั้งจำนวนโทรซ้ำติดลบ ถูกปฏิเสธ",
          r.status_code == 422, f"ได้ {r.status_code}")

    r = client.put("/config", headers=auth, json={"call_retry_count": 2, "call_retry_delay_seconds": 30})
    check("ค่าที่อยู่ในขอบเขต บันทึกได้ตามปกติ",
          r.status_code == 200 and r.json()["call_retry_count"] == 2,
          f"ได้ {r.status_code}")
except ImportError as exc:
    print(f"  (ข้ามหัวข้อนี้ — ต้องติดตั้ง httpx ก่อน: {exc})")

# ---------------------------------------------------------------------------
section("8. ลบกลุ่มผู้รับ — ต้องลบได้จริง และบอกเหตุผลเมื่อลบไม่ได้")
# ---------------------------------------------------------------------------
# บั๊กที่เคยเจอ: delete_group เช็คกับ EventType.group_id ซึ่งถูก drop ไปแล้วตั้งแต่
# revision b7c4d1e9f230 ผลคือโยน AttributeError → 500 ที่ไม่มีใครดัก ลบกลุ่มไม่ได้เลย
# สักกลุ่มตั้งแต่ 13 ส.ค. 2569 และไม่มีเทสไหนจับได้เพราะไม่เคยมีเทสยิง DELETE /groups

db8 = SessionLocal()

# 1) กลุ่มเปล่าที่ไม่มีใครใช้ ต้องลบได้
g_free = cs.create_group(db8, name="กลุ่มลอยๆ ไม่มีใครใช้")
try:
    ok = cs.delete_group(db8, g_free.id)
    check("ลบกลุ่มที่ไม่มีใครใช้ได้", ok is True and cs.get_group(db8, g_free.id) is None)
except Exception as exc:
    check("ลบกลุ่มที่ไม่มีใครใช้ได้", False, f"โยน {type(exc).__name__}: {exc}")

# 2) กลุ่มที่มีเบอร์อยู่ข้างใน ต้องลบได้ และเบอร์ต้องหายตามไปด้วย (CASCADE)
g_with = cs.create_group(db8, name="กลุ่มมีเบอร์")
c_in = cs.create_contact(db8, group_id=g_with.id, phone_number="0870000009", name="คนในกลุ่ม")
cid = c_in.id
try:
    cs.delete_group(db8, g_with.id)
    from app.database import Contact as _C
    left = db8.query(_C).filter(_C.id == cid).count()
    check("ลบกลุ่มแล้วเบอร์ในกลุ่มหายตาม (CASCADE)", left == 0, f"เหลือ {left} แถว")
except Exception as exc:
    check("ลบกลุ่มแล้วเบอร์ในกลุ่มหายตาม (CASCADE)", False, f"โยน {type(exc).__name__}: {exc}")

# 3) กลุ่มที่ถูกตั้งเป็นผู้รับสายของคู่ (อุปกรณ์ + เหตุการณ์) ต้องลบไม่ได้
#    และต้องเป็น GroupInUseError ที่อธิบายเหตุผล ไม่ใช่ 500 เปล่าๆ
g_used = cs.create_group(db8, name="กลุ่มที่ถูกใช้อยู่")
cs.create_contact(db8, group_id=g_used.id, phone_number="0870000010", name="คนรับสาย")
ev8 = es.create_event_type(db8, code="delete_guard_evt", display_name="ทดสอบด่านลบกลุ่ม",
                           message_template="ทดสอบ {device}")
dev8, _k8 = ks.create_api_key(db8, name="อุปกรณ์ทดสอบลบกลุ่ม", event_type_ids=[ev8.id])
ks.set_event_links(db8, dev8, [{"event_type_id": ev8.id, "group_id": g_used.id}])

raised = None
try:
    cs.delete_group(db8, g_used.id)
except cs.GroupInUseError as exc:
    raised = exc
except Exception as exc:
    raised = exc
check("ลบกลุ่มที่ถูกใช้เป็นผู้รับสายอยู่ ถูกปฏิเสธด้วย GroupInUseError",
      isinstance(raised, cs.GroupInUseError),
      f"ได้ {type(raised).__name__ if raised else 'ไม่โยนอะไรเลย'}")
check("ข้อความที่ปฏิเสธบอกชื่อกลุ่มและจำนวนจุดที่ใช้อยู่",
      raised is not None and g_used.name in str(raised) and any(ch.isdigit() for ch in str(raised)),
      str(raised)[:80])
check("กลุ่มที่ถูกใช้อยู่ต้องยังอยู่ในฐานข้อมูล",
      cs.get_group(db8, g_used.id) is not None)

# 4) ลบกลุ่มที่ไม่มีอยู่จริง ต้องได้ False (ไปเป็น 404) ไม่ใช่ระเบิด
try:
    check("ลบกลุ่มที่ไม่มีอยู่จริง คืนค่า False (เพื่อให้ API ตอบ 404)",
          cs.delete_group(db8, 999999) is False)
except Exception as exc:
    check("ลบกลุ่มที่ไม่มีอยู่จริง คืนค่า False (เพื่อให้ API ตอบ 404)", False,
          f"โยน {type(exc).__name__}")

db8.close()

# ---------------------------------------------------------------------------
line = "=" * 70
print(f"\n{line}")
print(f"สรุป: ผ่าน {len(_passed)} · ตก {len(_failed)}")
if _failed:
    print("รายการที่ตก:")
    for name in _failed:
        print(f"  - {name}")
print(line)
shutil.rmtree(_TMP, ignore_errors=True)
sys.exit(1 if _failed else 0)
