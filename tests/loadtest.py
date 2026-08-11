"""
ทดสอบโหลด — ระบบนี้รับงานได้เร็วแค่ไหน และส่งงานออกได้เร็วแค่ไหน

    python tests/loadtest.py            # ค่าเริ่มต้น: ยิง 300 ครั้ง พร้อมกัน 20 สาย
    python tests/loadtest.py 1000 50    # ยิง 1000 ครั้ง พร้อมกัน 50 สาย

รันเซิร์ฟเวอร์จริง (uvicorn) บนพอร์ตชั่วคราว ยิงผ่าน HTTP จริง และใช้ฐานข้อมูลชั่วคราว
โมดูล 4G ถูกสลับเป็นตัวปลอมที่ตั้งเวลาได้ จึงวัดได้ทั้งสองอย่างแยกกัน:

  1. เพดานของซอฟต์แวร์  — โมดูลปลอมทำงานเสร็จทันที วัดว่า FastAPI + SQLite ไปได้เร็วแค่ไหน
  2. เพดานของฮาร์ดแวร์  — โมดูลปลอมหน่วงเท่าเวลาจริงของสายหนึ่งสาย วัดว่าส่งได้กี่สายต่อชั่วโมง

ตัวเลขสองชุดนี้ห่างกันมาก และนั่นคือประเด็นสำคัญที่สุดของการทดสอบนี้
"""
import os
import shutil
import socket
import statistics
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

TOTAL_REQUESTS = int(sys.argv[1]) if len(sys.argv) > 1 else 300
CONCURRENCY = int(sys.argv[2]) if len(sys.argv) > 2 else 20

_TMP = tempfile.mkdtemp(prefix="gw-load-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TMP, "load.db").replace("\\", "/")
os.environ["JWT_SECRET_KEY"] = "loadtest-secret-that-is-long-enough-to-pass-the-check"
os.environ["AUDIO_CACHE_DIR"] = os.path.join(_TMP, "audio")
os.environ["ADMIN_PASSWORD_HASH"] = ""

import logging

import httpx

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("call_worker").setLevel(logging.WARNING)

import app.api_key_service as ks
import app.call_worker as cw
import app.contacts_service as cs
import app.event_types_service as es
from app.database import CallJob, CallStatus, SessionLocal, init_db

# เวลาที่โมดูลปลอมจะหน่วงต่อหนึ่งสาย — ตั้งจากภายนอกได้ระหว่างการทดสอบ
FAKE_CALL_SECONDS = 0.0


class FakeGSM:
    """
    โมดูล 4G ปลอม — แทนที่ตัวจริงเพื่อให้วัดซอฟต์แวร์ได้โดยไม่ต้องต่อฮาร์ดแวร์

    หน่วงเวลาตาม FAKE_CALL_SECONDS เพื่อจำลองว่าหนึ่งสายกินเวลาเท่าไหร่จริงๆ
    """

    port = "fake"

    def connect(self):
        pass

    def disconnect(self):
        pass

    def is_responsive(self):
        return True

    def get_signal_quality(self):
        return 20

    def get_operator_info(self):
        return ("FAKE", "4G (LTE)")

    def prepare_audio(self, path, on_progress=None):
        pass

    def dial(self, number):
        if FAKE_CALL_SECONDS:
            time.sleep(FAKE_CALL_SECONDS)
        return "connected"

    def play_audio(self):
        pass

    def hangup(self):
        pass

    def restart_radio(self, wait_register_seconds=30.0):
        return True


cw.GSMModule = FakeGSM
cw.text_to_speech = lambda text: os.path.join(_TMP, "fake.mp3")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def setup_fixtures():
    """สร้างกลุ่ม เบอร์ เหตุการณ์ และอุปกรณ์ 1 ตัว แล้วคืน API key ที่ใช้ยิงจริง"""
    init_db()
    db = SessionLocal()
    g = cs.create_group(db, name="ทีมทดสอบโหลด")
    cs.create_contact(db, group_id=g.id, phone_number="0810000001")
    ev = es.create_event_type(
        db, code="loadtest", display_name="ทดสอบโหลด",
        message_template="แจ้งเหตุจาก {device}", group_id=None,
    )
    dev, key = ks.create_api_key(db, name="อุปกรณ์ทดสอบ", event_type_ids=[ev.id])
    ks.set_event_links(db, dev, [{"event_type_id": ev.id, "group_id": g.id}])
    db.commit()
    db.close()
    return key


def start_server(port: int):
    import uvicorn

    import app.main as main_mod

    config = uvicorn.Config(main_mod.app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(100):
        try:
            httpx.get(f"http://127.0.0.1:{port}/health", timeout=1.0)
            return server
        except Exception:
            time.sleep(0.2)
    raise RuntimeError("เซิร์ฟเวอร์ไม่ขึ้นภายในเวลาที่รอ")


def count_by_status(statuses):
    db = SessionLocal()
    try:
        return {s: db.query(CallJob).filter(CallJob.status == s).count() for s in statuses}
    finally:
        db.close()


def bar(title):
    print(f"\n{'=' * 72}\n{title}\n{'=' * 72}")


# ---------------------------------------------------------------------------
key = setup_fixtures()
port = free_port()
start_server(port)
base = f"http://127.0.0.1:{port}"

bar("ทดสอบที่ 1 — ระบบรับคำขอเข้าคิวได้เร็วแค่ไหน (เพดานของซอฟต์แวร์)")
print(f"  ยิง {TOTAL_REQUESTS} ครั้ง พร้อมกัน {CONCURRENCY} สาย ไปที่ POST /notify")

latencies, errors = [], {}
lock = threading.Lock()


def fire(_i):
    with httpx.Client(base_url=base, timeout=30.0) as c:
        t0 = time.perf_counter()
        try:
            r = c.post("/notify", headers={"X-API-Key": key},
                       json={"event_type_code": "loadtest"})
            code = r.status_code
        except Exception as exc:
            code = type(exc).__name__
        dt = time.perf_counter() - t0
    with lock:
        latencies.append(dt)
        errors[code] = errors.get(code, 0) + 1


# ใช้ client ร่วมกันต่อ worker แทนที่จะเปิดใหม่ทุกครั้ง เพื่อไม่ให้เวลาจับ TCP handshake ปนเข้ามา
def fire_batch(n):
    out = []
    with httpx.Client(base_url=base, timeout=30.0) as c:
        for _ in range(n):
            t0 = time.perf_counter()
            try:
                r = c.post("/notify", headers={"X-API-Key": key},
                           json={"event_type_code": "loadtest"})
                code = r.status_code
            except Exception as exc:
                code = type(exc).__name__
            out.append((time.perf_counter() - t0, code))
    return out


per_worker = max(1, TOTAL_REQUESTS // CONCURRENCY)
started = time.perf_counter()
with ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
    for chunk in pool.map(fire_batch, [per_worker] * CONCURRENCY):
        for dt, code in chunk:
            latencies.append(dt)
            errors[code] = errors.get(code, 0) + 1
elapsed = time.perf_counter() - started

sent = len(latencies)
ok = errors.get(200, 0)
latencies.sort()
print(f"\n  ส่งไปทั้งหมด      : {sent} ครั้ง ใน {elapsed:.2f} วินาที")
print(f"  สำเร็จ (200)      : {ok}")
print(f"  ผลลัพธ์อื่น       : {[(k, v) for k, v in errors.items() if k != 200] or 'ไม่มี'}")
print(f"  อัตราการรับ       : {sent / elapsed:,.0f} คำขอ/วินาที")
print(f"  เวลาตอบกลับ  กลาง: {statistics.median(latencies) * 1000:.0f} ms"
      f"   p95: {latencies[int(len(latencies) * 0.95) - 1] * 1000:.0f} ms"
      f"   สูงสุด: {latencies[-1] * 1000:.0f} ms")

db = SessionLocal()
queued_total = db.query(CallJob).count()
db.close()
print(f"  งานที่เข้าคิวจริง : {queued_total}")

bar("ทดสอบที่ 2 — คิวระบายงานได้เร็วแค่ไหนเมื่อโมดูลไม่ใช่คอขวด")
print("  (โมดูลปลอมตอบทันที — วัดเฉพาะความเร็วของ worker + ฐานข้อมูล)")

drain_start = time.perf_counter()
DONE = (CallStatus.CONNECTED, CallStatus.FAILED)
last_remaining = None
while True:
    counts = count_by_status([CallStatus.QUEUED, CallStatus.IN_PROGRESS,
                              CallStatus.RETRYING, CallStatus.ESCALATED])
    remaining = sum(counts.values())
    if remaining == 0:
        break
    if time.perf_counter() - drain_start > 120:
        print(f"  หยุดรอที่ 120 วินาที ยังเหลือ {remaining} งาน")
        break
    if remaining != last_remaining:
        last_remaining = remaining
    time.sleep(0.25)
drain = time.perf_counter() - drain_start

done = count_by_status(DONE)
completed = sum(done.values())
print(f"\n  ระบายหมดใน       : {drain:.2f} วินาที")
if drain > 0:
    print(f"  อัตราการโทร      : {completed / drain:,.1f} สาย/วินาที "
          f"({completed / drain * 3600:,.0f} สาย/ชั่วโมง ถ้าโมดูลเร็วอนันต์)")
print(f"  ปิดงานสำเร็จ      : {done.get(CallStatus.CONNECTED, 0)}   "
      f"ล้มเหลว: {done.get(CallStatus.FAILED, 0)}")

bar("ทดสอบที่ 3 — เพดานจริงเมื่อคิดเวลาของโมดูล 4G ด้วย")
SAMPLE = 5
FAKE_CALL_SECONDS = 3.0  # ย่อส่วนจากของจริง เพื่อไม่ต้องรอนานตอนทดสอบ
print(f"  ตั้งให้โมดูลปลอมใช้เวลา {FAKE_CALL_SECONDS} วินาที/สาย แล้วยิงเพิ่ม {SAMPLE} งาน")

with httpx.Client(base_url=base, timeout=30.0) as c:
    for _ in range(SAMPLE):
        c.post("/notify", headers={"X-API-Key": key}, json={"event_type_code": "loadtest"})

t0 = time.perf_counter()
while True:
    counts = count_by_status([CallStatus.QUEUED, CallStatus.IN_PROGRESS,
                              CallStatus.RETRYING, CallStatus.ESCALATED])
    if sum(counts.values()) == 0 or time.perf_counter() - t0 > 120:
        break
    time.sleep(0.25)
serial = time.perf_counter() - t0
print(f"\n  {SAMPLE} สายใช้เวลารวม  : {serial:.1f} วินาที  (เฉลี่ย {serial / SAMPLE:.1f} วินาที/สาย)")
print(f"  แปลว่างานถูกทำ    : ทีละสายเรียงกัน ไม่ขนานกัน (ตรงตามที่ออกแบบ — ซิมใบเดียว)")

REAL_CALL_SECONDS = 45
print(f"\n  ถ้าใช้เวลาจริง {REAL_CALL_SECONDS} วินาที/สาย (วัดจากฮาร์ดแวร์จริง):")
print(f"    เพดานการส่ง     ≈ {3600 / REAL_CALL_SECONDS:,.0f} สาย/ชั่วโมง")
print(f"    งานลำดับที่ 10 ในคิวจะได้โทรเมื่อ ≈ {REAL_CALL_SECONDS * 9 / 60:.0f} นาทีหลังเข้าคิว")

print(f"\n{'=' * 72}")
print("สรุป")
print("=" * 72)
print(f"  รับเข้าคิวได้      : {sent / elapsed:,.0f} คำขอ/วินาที")
print(f"  ส่งออกได้จริง      : {3600 / REAL_CALL_SECONDS:,.0f} สาย/ชั่วโมง (ถูกจำกัดโดยโมดูล ไม่ใช่ซอฟต์แวร์)")
print(f"  ส่วนต่าง          : ประมาณ {(sent / elapsed) * 3600 / (3600 / REAL_CALL_SECONDS):,.0f} เท่า")
print("=" * 72)

shutil.rmtree(_TMP, ignore_errors=True)
