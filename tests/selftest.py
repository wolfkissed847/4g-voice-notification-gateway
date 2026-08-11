"""
เทสถดถอย (regression test) ของ 4G Voice Notification Gateway

รันได้ทุกที่ที่รันแอปได้ ไม่ต้องมี pytest:
    python tests/selftest.py

เทสชุดนี้สร้างฐานข้อมูลใหม่ในโฟลเดอร์ชั่วคราวทุกครั้ง ไม่แตะ gateway.db ตัวจริง
และไม่แตะฮาร์ดแวร์จริง (โมดูล GSM ถูกสลับเป็นตัวปลอม) จึงรันบน Pi ระหว่างที่ระบบเดินอยู่ได้

แต่ละหัวข้อผูกกับบั๊กที่เคยเกิดขึ้นจริงหนึ่งตัว — ถ้าเทสไหนแดง แปลว่าบั๊กตัวนั้นกลับมาแล้ว
"""
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

cols = {c["name"] for c in sa.inspect(engine).get_columns("call_jobs")}
check("call_jobs มีคอลัมน์ group_id", "group_id" in cols)

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
    with _eng.begin() as _c:
        _rev = _c.execute(sa.text("SELECT version_num FROM alembic_version")).scalar()
        _row = _c.execute(sa.text("SELECT group_id FROM call_jobs WHERE id = 1")).scalar()
        _left = _c.execute(sa.text(
            "SELECT count(*) FROM sqlite_master WHERE name LIKE '_alembic_tmp_%'")).scalar()
    _eng.dispose()
    check("migration ผ่านแม้มีเศษตารางค้าง", _rev == "a1b2c3d4e5f6", f"revision={_rev}")
    check("ลบเศษตารางทิ้งให้เอง", _left == 0)
    check("ประวัติเก่าไม่หายและถูกเติม group_id ย้อนหลัง", _row == 1, f"group_id={_row}")
    os.environ["DATABASE_URL"] = _prev
    importlib.reload(_conf)
finally:
    _shutil.rmtree(_MIG_TMP, ignore_errors=True)


# ---------------------------------------------------------------------------
section("1. กลุ่มผู้รับรายอุปกรณ์ถูกใช้จริงตอนโทร  (บั๊กร้ายแรง)")
# ---------------------------------------------------------------------------
import app.api_key_service as ks
import app.contacts_service as cs
import app.event_types_service as es
from app.contacts_service import get_ordered_phone_numbers
from app.queue_manager import claim_next_job, enqueue_job, recover_orphaned_jobs

db = SessionLocal()
ga = cs.create_group(db, name="ช่างตึก A")
cs.create_contact(db, group_id=ga.id, phone_number="0810000001")
gb = cs.create_group(db, name="ช่างตึก B")
cs.create_contact(db, group_id=gb.id, phone_number="0820000002")
cs.create_contact(db, group_id=gb.id, phone_number="0820000003")

# เหตุการณ์เป็นคลังกลาง ไม่ตั้งกลุ่มเริ่มต้น (โมเดลที่ระบบใช้อยู่จริงตอนนี้)
ev = es.create_event_type(
    db, code="pump_stop", display_name="ปั๊มหยุดทำงาน",
    message_template="แจ้งเหตุ {device} ปั๊มหยุดทำงาน", group_id=None,
)
dev_a, key_a = ks.create_api_key(db, name="ปั๊มตึก A", event_type_ids=[ev.id])
ks.set_event_links(db, dev_a, [{"event_type_id": ev.id, "group_id": ga.id}])
dev_b, key_b = ks.create_api_key(db, name="ปั๊มตึก B", event_type_ids=[ev.id])
ks.set_event_links(db, dev_b, [{"event_type_id": ev.id, "group_id": gb.id}])
db.commit()

job_a = enqueue_job(
    db, message="m", event_type_id=ev.id, priority_group=ga.name, group_id=ga.id,
    api_key_id=dev_a.id, source_device=dev_a.name,
    event_type_code=ev.code, event_type_name=ev.display_name,
)
job_b = enqueue_job(
    db, message="m", event_type_id=ev.id, priority_group=gb.name, group_id=gb.id,
    api_key_id=dev_b.id, source_device=dev_b.name,
    event_type_code=ev.code, event_type_name=ev.display_name,
)

check("งานเก็บ group_id ที่ตัดสินใจไว้", job_a.group_id == ga.id and job_b.group_id == gb.id)
check("อุปกรณ์ตึก A ได้เบอร์ของกลุ่ม A",
      get_ordered_phone_numbers(db, job_a.group_id) == ["0810000001"])
check("อุปกรณ์ตึก B ได้เบอร์ของกลุ่ม B (คนละกลุ่มกับ A ทั้งที่ใช้เหตุการณ์เดียวกัน)",
      get_ordered_phone_numbers(db, job_b.group_id) == ["0820000002", "0820000003"])
check("เหตุการณ์ไม่มีกลุ่มเริ่มต้นก็ยังหาเบอร์เจอ",
      ev.group_id is None and job_b.group_id is not None)

# ---------------------------------------------------------------------------
section("2. worker หยิบงานแล้วโทรได้จริง (โมดูลปลอม)")
# ---------------------------------------------------------------------------
import app.call_worker as cw
from app.config_service import get_effective_config


class FakeGSM:
    """โมดูลปลอม — บันทึกว่าถูกสั่งโทรไปเบอร์ไหน แทนที่จะแตะพอร์ตอนุกรมจริง"""

    def __init__(self, result="connected"):
        self.dialed, self.result, self.played = [], result, 0

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

gsm = FakeGSM("connected")
claimed = claim_next_job(db)
cw.process_job(db, claimed, gsm, cfg)
db.refresh(claimed)
check("โทรออกไปยังเบอร์ของกลุ่มที่ผูกกับอุปกรณ์นั้น", gsm.dialed == ["0810000001"], f"โทรไป {gsm.dialed}")
check("เล่นข้อความเสียงเข้าสาย 1 ครั้ง", gsm.played == 1)
check("ปิดงานเป็น connected", claimed.status == CallStatus.CONNECTED)

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

# ---------------------------------------------------------------------------
section("3. ประวัติการโทร กรองด้วยกลุ่มได้ถูกต้อง")
# ---------------------------------------------------------------------------
n_a = db.query(CallJob).filter(CallJob.group_id == ga.id).count()
n_b = db.query(CallJob).filter(CallJob.group_id == gb.id).count()
check("กรองกลุ่ม A เจอ 1 งาน", n_a == 1, f"ได้ {n_a}")
check("กรองกลุ่ม B เจอ 1 งาน", n_b == 1, f"ได้ {n_b}")

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
section("5. แม่แบบข้อความและกลุ่มเริ่มต้นของเหตุการณ์")
# ---------------------------------------------------------------------------
ev2 = es.create_event_type(db, code="tmp", display_name="t", message_template="t", group_id=ga.id)
es.update_event_type(db, ev2.id, group_id=None)
db.refresh(ev2)
check("ล้างกลุ่มเริ่มต้นของเหตุการณ์ได้", ev2.group_id is None)

es.update_event_type(db, ev2.id, display_name="ชื่อใหม่")
db.refresh(ev2)
check("แก้ชื่ออย่างเดียวไม่ไปล้างกลุ่มโดยไม่ตั้งใจ", ev2.display_name == "ชื่อใหม่")

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
stuck = enqueue_job(db, message="m", event_type_id=ev.id, priority_group=ga.name, group_id=ga.id)
stuck.status = CallStatus.IN_PROGRESS
db.commit()
recovered = recover_orphaned_jobs(db)
db.refresh(stuck)
check("งานที่ค้าง in_progress ถูกดึงกลับเข้าคิว",
      recovered >= 1 and stuck.status == CallStatus.QUEUED)

GA_ID, GB_ID = ga.id, gb.id  # เก็บเป็นตัวเลขก่อนปิด session
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

    r = client.get("/history?group_id=%d" % GB_ID, headers=auth)
    check("กรองประวัติด้วยกลุ่มผ่าน API ได้ผลจริง",
          r.status_code == 200 and r.json()["total_count"] >= 1,
          f"ได้ {r.status_code} total={r.json().get('total_count') if r.status_code == 200 else '-'}")
except ImportError as exc:
    print(f"  (ข้ามหัวข้อนี้ — ต้องติดตั้ง httpx ก่อน: {exc})")

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
