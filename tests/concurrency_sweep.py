"""
หาจุดที่ระบบเริ่มรับไม่ไหว — ไล่เพิ่มจำนวนคำขอพร้อมกันทีละระดับ

    python tests/concurrency_sweep.py

ยิง POST /notify พร้อมกันที่ระดับต่างๆ แล้วดูว่าระดับไหนเริ่มมีคำขอที่ไม่ได้ 200
ใช้เซิร์ฟเวอร์จริงและฐานข้อมูลชั่วคราว โมดูล 4G เป็นตัวปลอมที่ตอบทันที
(จุดประสงค์คือวัด "ประตูทางเข้า" ไม่ใช่ความเร็วการโทร)
"""
import logging
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_TMP = tempfile.mkdtemp(prefix="gw-sweep-")
os.environ["DATABASE_URL"] = "sqlite:///" + os.path.join(_TMP, "sweep.db").replace("\\", "/")
os.environ["JWT_SECRET_KEY"] = "sweep-secret-that-is-long-enough-to-pass-the-check"
os.environ["AUDIO_CACHE_DIR"] = os.path.join(_TMP, "audio")
os.environ["ADMIN_PASSWORD_HASH"] = ""

import httpx

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.disable(logging.INFO)

import app.api_key_service as ks
import app.call_worker as cw
import app.contacts_service as cs
import app.event_types_service as es
from app.database import SessionLocal, engine, init_db


class FakeGSM:
    port = "fake"

    def connect(self): pass

    def disconnect(self): pass

    def is_responsive(self): return True

    def get_signal_quality(self): return 20

    def get_operator_info(self): return ("FAKE", "4G (LTE)")

    def prepare_audio(self, path, on_progress=None): pass

    def dial(self, number): return "connected"

    def play_audio(self): pass

    def hangup(self): pass

    def restart_radio(self, wait_register_seconds=30.0): return True


cw.GSMModule = FakeGSM
cw.text_to_speech = lambda text: os.path.join(_TMP, "fake.mp3")

init_db()
db = SessionLocal()
g = cs.create_group(db, name="ทีมทดสอบ")
cs.create_contact(db, group_id=g.id, phone_number="0810000001")
ev = es.create_event_type(db, code="sweep", display_name="สวีป",
                          message_template="แจ้งเหตุจาก {device}", group_id=None)
dev, KEY = ks.create_api_key(db, name="อุปกรณ์ทดสอบ", event_type_ids=[ev.id])
ks.set_event_links(db, dev, [{"event_type_id": ev.id, "group_id": g.id}])
db.commit()
db.close()

with socket.socket() as s:
    s.bind(("127.0.0.1", 0))
    PORT = s.getsockname()[1]

import uvicorn

import app.main as main_mod

server = uvicorn.Server(uvicorn.Config(main_mod.app, host="127.0.0.1", port=PORT, log_level="error"))
threading.Thread(target=server.run, daemon=True).start()
BASE = f"http://127.0.0.1:{PORT}"
for _ in range(100):
    try:
        httpx.get(f"{BASE}/health", timeout=1.0)
        break
    except Exception:
        time.sleep(0.2)


BURST_PER_WORKER = int(os.environ.get("BURST_PER_WORKER", "1"))


def one_request(_):
    """ยิงต่อเนื่อง BURST_PER_WORKER ครั้งด้วย connection เดิม แล้วคืนผลทุกครั้ง"""
    out = []
    try:
        with httpx.Client(base_url=BASE, timeout=60.0) as c:
            for _ in range(BURST_PER_WORKER):
                t0 = time.perf_counter()
                try:
                    r = c.post("/notify", headers={"X-API-Key": KEY},
                               json={"event_type_code": "sweep"})
                    out.append((r.status_code, time.perf_counter() - t0))
                except Exception as exc:
                    out.append((type(exc).__name__, time.perf_counter() - t0))
    except Exception as exc:
        out.append((type(exc).__name__, 0.0))
    return out


pool = engine.pool
print(f"\nการตั้งค่า connection pool ปัจจุบัน: "
      f"{type(pool).__name__} size={getattr(pool, 'size', lambda: '-')()} "
      f"overflow สูงสุด={getattr(pool, '_max_overflow', '-')}")
print(f"\n{'พร้อมกัน':>10} {'สำเร็จ':>8} {'ล้มเหลว':>9} {'ช้าสุด(ms)':>12}  ผลลัพธ์ที่ไม่ใช่ 200")
print("-" * 74)

for level in (5, 10, 15, 20, 30, 50, 80):
    with ThreadPoolExecutor(max_workers=level) as ex:
        results = [item for chunk in ex.map(one_request, range(level)) for item in chunk]
    codes = [c for c, _ in results]
    slowest = max(dt for _, dt in results) * 1000
    ok = codes.count(200)
    bad = {}
    for c in codes:
        if c != 200:
            bad[c] = bad.get(c, 0) + 1
    print(f"{level:>10} {ok:>8} {len(codes) - ok:>9} {slowest:>12,.0f}  {bad or '-'}")

print()
shutil.rmtree(_TMP, ignore_errors=True)
