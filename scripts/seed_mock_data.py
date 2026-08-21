"""เติมข้อมูลตัวอย่างลงฐานข้อมูลสำหรับ "ดูหน้าเว็บตอนพัฒนา" เท่านั้น

ทำไมต้องมี
    ฐานข้อมูลตอนพัฒนามีข้อมูลอยู่ไม่กี่แถว (กลุ่มเดียว เบอร์เดียว เหตุการณ์สองแบบ)
    ซึ่งไม่พอจะเห็นว่าหน้าเว็บจริงหน้าตาเป็นยังไงเวลามีของเยอะ — ตารางเลื่อนถูกไหม
    ชื่อยาวๆ ตัดคำถูกไหม เลขหน้าเดินถูกไหม กราฟ 24 ชั่วโมงมีแท่งขึ้นจริงไหม
    ตัวกรองวันที่ย้อนหลังได้จริงไหม สถานะครบทั้ง 8 แบบหน้าตาเป็นยังไงเวลาอยู่ปนกัน

    ข้อมูลชุดนี้เขียนผ่าน model ของแอปเอง ไม่ได้ยัด SQL ดิบ — enum, การ hash key,
    การเข้ารหัส key จึงถูกต้องเหมือนของที่สร้างจากหน้าเว็บทุกอย่าง

⚠️ ห้ามรันบน Pi ตัวจริง
    สคริปต์นี้ลบงานโทรและ log ทั้งหมดทิ้งก่อนเติมของใหม่ ต้องใส่ --yes ถึงจะทำงาน
    และมันเขียนลงฐานข้อมูลที่ settings.database_url ชี้อยู่ ซึ่งบน Pi คือฐานข้อมูลจริง

วิธีใช้
    ./venv/Scripts/python.exe scripts/seed_mock_data.py --yes
    ./venv/Scripts/python.exe scripts/seed_mock_data.py --yes --jobs 500 --days 90
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.api_key_service import generate_key  # noqa: E402
from app.crypto import encrypt  # noqa: E402
from app.database import (  # noqa: E402
    ApiKey,
    ApiKeyEventContact,
    ApiKeyEventType,
    CallJob,
    CallLog,
    CallStatus,
    Contact,
    EventType,
    Group,
    SessionLocal,
)

# เลขคงที่ = รันกี่รอบก็ได้ข้อมูลชุดเดิม เทียบภาพหน้าจอก่อน/หลังแก้ CSS ได้ตรงๆ
# ถ้าสุ่มใหม่ทุกรอบ ความต่างของภาพจะแยกไม่ออกว่ามาจากโค้ดหรือมาจากข้อมูล
SEED = 20260818


# ── แคตตาล็อก: กลุ่มผู้รับสาย ────────────────────────────────────────────────
# ชื่อไทยยาวสั้นคละกันโดยตั้งใจ — คอลัมน์ "กลุ่ม" ในตารางคิวถูกตัดด้วย truncate
# ถ้าใส่แต่ชื่อสั้นจะไม่มีวันเห็นว่าจุดตัดอยู่ตรงไหนและมันน่าเกลียดหรือเปล่า
GROUPS: list[tuple[str, str, list[tuple[str, str]]]] = [
    (
        "ทีมช่างเทคนิค",
        "ช่างประจำโรงงาน รับสายเป็นด่านแรกทุกเหตุการณ์",
        [("เฟรม", "0994755051"), ("ช่างต้น", "0812345678"), ("ช่างหนุ่ม", "0898765432"), ("ช่างเอ", "0851112233")],
    ),
    (
        "หัวหน้าฝ่ายผลิต",
        "รับสายต่อเมื่อทีมช่างไม่รับภายในเวลาที่กำหนด",
        [("คุณสมชาย", "0819998877"), ("คุณวราภรณ์", "0863334455"), ("คุณธนา", "0827776655")],
    ),
    (
        "เวรกลางคืน",
        "กะดึก 22:00–06:00",
        [("เวร A", "0845556677"), ("เวร B", "0866667788"), ("เวร C", "0877778899"), ("ป้อมยาม", "0888889900")],
    ),
    (
        "ฝ่ายความปลอดภัยและอาชีวอนามัย",
        "เหตุการณ์ที่กระทบความปลอดภัยของคนเท่านั้น",
        [("จป.วิชาชีพ", "0801112223"), ("หัวหน้า จป.", "0802223334")],
    ),
    (
        "ทีมไอทีและระบบเครือข่าย",
        "ดูแลเซิร์ฟเวอร์ ตู้แร็ค และอินเทอร์เน็ต",
        [("แอดมินระบบ", "0911223344"), ("เน็ตเวิร์ค", "0922334455"), ("ซัพพอร์ต", "0933445566")],
    ),
    (
        "ผู้บริหาร",
        "ปลายทางสุดท้าย เรียกเมื่อไล่ครบทุกกลุ่มแล้วยังไม่มีใครรับ",
        [("ผจก.โรงงาน", "0955556666"), ("รองผจก.", "0966667777")],
    ),
]


# ── แคตตาล็อก: ประเภทเหตุการณ์ ───────────────────────────────────────────────
EVENT_TYPES: list[tuple[str, str, str]] = [
    ("node_down", "อุปกรณ์ขาดการเชื่อมต่อ", "แจ้งเตือน อุปกรณ์ {device} ขาดการเชื่อมต่อ กรุณาตรวจสอบด่วน"),
    ("power_outage", "ไฟฟ้าดับ", "แจ้งเตือน อุปกรณ์ {device} ตรวจพบไฟฟ้าดับ กรุณาตรวจสอบด่วน"),
    ("temp_high", "อุณหภูมิสูงเกินกำหนด", "แจ้งเตือน อุปกรณ์ {device} อุณหภูมิสูงเกินค่าที่ตั้งไว้ กรุณาตรวจสอบ"),
    ("water_leak", "ตรวจพบน้ำรั่ว", "แจ้งเตือน อุปกรณ์ {device} ตรวจพบน้ำรั่วในพื้นที่ กรุณาตรวจสอบด่วน"),
    ("smoke_detected", "ตรวจพบควัน", "แจ้งเตือนฉุกเฉิน อุปกรณ์ {device} ตรวจพบควัน กรุณาตรวจสอบทันที"),
    ("ups_low_battery", "แบตเตอรี่สำรองใกล้หมด", "แจ้งเตือน อุปกรณ์ {device} แบตเตอรี่สำรองเหลือน้อย กรุณาตรวจสอบ"),
    ("network_down", "อินเทอร์เน็ตหลุด", "แจ้งเตือน อุปกรณ์ {device} เชื่อมต่ออินเทอร์เน็ตไม่ได้ กรุณาตรวจสอบ"),
    ("door_forced", "ประตูถูกเปิดผิดปกติ", "แจ้งเตือน อุปกรณ์ {device} ตรวจพบการเปิดประตูผิดปกติ กรุณาตรวจสอบ"),
    ("disk_full", "พื้นที่จัดเก็บเต็ม", "แจ้งเตือน อุปกรณ์ {device} พื้นที่จัดเก็บข้อมูลใกล้เต็ม กรุณาตรวจสอบ"),
]


# ── แคตตาล็อก: อุปกรณ์ที่ยิงเข้ามา (= API key หนึ่งใบต่อหนึ่งอุปกรณ์) ─────────
# (ชื่ออุปกรณ์, code เหตุการณ์ที่ยิงได้, ชื่อกลุ่มที่ให้โทร)
DEVICES: list[tuple[str, list[str], str]] = [
    ("โหนดตึก A ชั้น 3", ["node_down", "power_outage", "temp_high"], "ทีมช่างเทคนิค"),
    ("โหนดตึก A ชั้น 5", ["node_down", "temp_high"], "ทีมช่างเทคนิค"),
    ("โหนดตึก B ชั้น 1", ["node_down", "power_outage"], "ทีมช่างเทคนิค"),
    ("ห้องเซิร์ฟเวอร์ชั้นใต้ดิน", ["temp_high", "water_leak", "ups_low_battery", "network_down"], "ทีมไอทีและระบบเครือข่าย"),
    ("ตู้แร็คเครือข่ายชั้น 2", ["network_down", "ups_low_battery", "disk_full"], "ทีมไอทีและระบบเครือข่าย"),
    ("เซิร์ฟเวอร์สำรองข้อมูล", ["disk_full", "network_down"], "ทีมไอทีและระบบเครือข่าย"),
    ("คลังสินค้าโซน B", ["door_forced", "smoke_detected", "power_outage"], "ฝ่ายความปลอดภัยและอาชีวอนามัย"),
    ("คลังสินค้าโซน C", ["door_forced", "smoke_detected"], "ฝ่ายความปลอดภัยและอาชีวอนามัย"),
    ("ห้องเก็บสารเคมี", ["smoke_detected", "temp_high", "door_forced"], "ฝ่ายความปลอดภัยและอาชีวอนามัย"),
    ("ไลน์ผลิตที่ 1", ["node_down", "temp_high"], "หัวหน้าฝ่ายผลิต"),
    ("ไลน์ผลิตที่ 2", ["node_down", "temp_high"], "หัวหน้าฝ่ายผลิต"),
    ("ไลน์ผลิตที่ 3", ["node_down", "power_outage", "temp_high"], "หัวหน้าฝ่ายผลิต"),
    ("ห้องหม้อไอน้ำ", ["temp_high", "water_leak"], "หัวหน้าฝ่ายผลิต"),
    ("อาคารสำนักงานใหญ่", ["power_outage", "network_down", "disk_full"], "เวรกลางคืน"),
    ("ลานจอดรถชั้น 1", ["door_forced", "power_outage"], "เวรกลางคืน"),
    ("ป้อมยามประตูหน้า", ["door_forced", "network_down"], "เวรกลางคืน"),
    ("ห้องไฟฟ้าหลัก", ["power_outage", "ups_low_battery", "temp_high"], "ผู้บริหาร"),
    ("ปั๊มน้ำดับเพลิง", ["water_leak", "power_outage"], "ผู้บริหาร"),
    ("Test", ["node_down", "power_outage"], "ทีมช่างเทคนิค"),
]


# ── ผลการโทรที่เป็นไปได้ พร้อมน้ำหนักและข้อความ log ที่ worker เขียนจริง ──────
# น้ำหนักอิงจาก "ระบบที่ทำงานดี" — โทรติดเป็นส่วนใหญ่ ที่เหลือคละกันไป
# ถ้าให้ทุกสถานะเท่ากันหมด หน้าประวัติจะดูเหมือนระบบพัง ซึ่งอ่านภาพรวมผิด
OUTCOMES: list[tuple[CallStatus, int, str, str]] = [
    (CallStatus.CONNECTED, 58, "connected", ""),
    (CallStatus.NO_ANSWER, 14, "no_answer", "ปล่อยดังจนครบเวลาแล้วไม่มีใครรับ"),
    (CallStatus.BUSY, 7, "busy", "ปลายสายไม่ว่าง"),
    (CallStatus.ESCALATED, 8, "rejected", "ปลายสายกดปฏิเสธ หรือติดต่อเบอร์นี้ไม่ได้ (สายถูกตัดก่อนหมดเวลารอ)"),
    (CallStatus.FAILED, 10, "failed", "ไล่ครบทุกเบอร์ในกลุ่มแล้วไม่มีใครรับสาย"),
    (CallStatus.CANCELLED, 3, "cancelled", "ผู้ดูแลกดยกเลิกงานก่อนถึงคิวโทร"),
]

# สถานะที่ยังเดินอยู่ — ใส่ไว้ท้ายสุด (เวลาใหม่สุด) เพื่อให้หน้าคิวมีของให้ดู
#
# เอาเยอะกว่าที่กล่องใส่ได้โดยตั้งใจ ไม่งั้นจะไม่มีวันรู้ว่ากล่องเลื่อนได้จริงไหม
# ตรึงความสูงไว้จริงไหม หรือมันแค่ "ยังไม่ยาวพอจะเห็นปัญหา"
LIVE_STATES = (
    [CallStatus.IN_PROGRESS]
    + [CallStatus.RETRYING] * 3
    + [CallStatus.ESCALATED] * 4
    + [CallStatus.QUEUED] * 14
)

# จอดงานในคิวไว้ไกลๆ ไม่ให้ worker หยิบไปทำ
#
# ถ้าไม่จอด: backend ที่รันอยู่จะหยิบงานพวกนี้ไปโทรภายในไม่กี่วินาที แล้วล้มเหลว
# ทั้งหมด (เครื่องพัฒนาไม่มีโมดูล 4G) — เปิดหน้าคิวอีกทีก็ว่างเปล่าไปแล้ว
# claim_next_job() ข้ามงานที่ next_attempt_at ยังไม่ถึงเวลา จึงใช้ช่องนั้นจอดไว้
#
# ยกเว้น IN_PROGRESS ที่ปล่อยว่างไว้ได้ เพราะ worker ไม่แตะงานที่ "กำลังทำอยู่"
# (จะโดนรีเซ็ตกลับเป็นรอคิวก็ต่อเมื่อ restart backend ซึ่งตอนนั้นค่อยรัน seed ใหม่)
PARK_HOURS = 6


def get_or_create(db, model, defaults: dict | None = None, **lookup):
    row = db.query(model).filter_by(**lookup).one_or_none()
    if row is not None:
        for k, v in (defaults or {}).items():
            setattr(row, k, v)
        return row, False
    row = model(**lookup, **(defaults or {}))
    db.add(row)
    return row, True


def build_catalogue(db) -> tuple[dict[str, Group], dict[str, EventType], list[ApiKey]]:
    """กลุ่ม + เบอร์ + ประเภทเหตุการณ์ + อุปกรณ์ — ผูกกันครบเหมือนตั้งค่าจากหน้าเว็บ"""
    groups: dict[str, Group] = {}
    for name, desc, contacts in GROUPS:
        group, _ = get_or_create(db, Group, {"description": desc}, name=name)
        db.flush()
        groups[name] = group
        for i, (person, phone) in enumerate(contacts):
            get_or_create(
                db, Contact, {"name": person, "order_index": i},
                group_id=group.id, phone_number=phone,
            )
    db.flush()

    events: dict[str, EventType] = {}
    for code, display, template in EVENT_TYPES:
        ev, _ = get_or_create(
            db, EventType,
            {"display_name": display, "message_template": template, "is_active": "true"},
            code=code,
        )
        events[code] = ev
    db.flush()

    keys: list[ApiKey] = []
    for name, codes, group_name in DEVICES:
        key = db.query(ApiKey).filter_by(name=name).one_or_none()
        # key_encrypted ต้องมี ไม่งั้นหน้าอุปกรณ์กดดู key แล้วไม่ขึ้น — คีย์เก่าในเครื่องพัฒนา
        # บางใบสร้างไว้ก่อนจะมีการเก็บแบบเข้ารหัส จึงต้องออกคีย์ใหม่ทับให้ด้วย
        if key is None or not key.key_encrypted:
            plaintext, prefix, key_hash = generate_key()
            if key is None:
                key = ApiKey(name=name, is_active="true")
                db.add(key)
            key.key_prefix, key.key_hash = prefix, key_hash
            key.key_encrypted = encrypt(plaintext)
            key.revoked_at, key.is_active = None, "true"
            db.flush()

        group = groups[group_name]
        for code in codes:
            ev = events[code]
            link, _ = get_or_create(
                db, ApiKeyEventType, {"group_id": group.id},
                api_key_id=key.id, event_type_id=ev.id,
            )
            # เลือกเบอร์เองสองคนแรกของกลุ่ม เพื่อให้มีทั้งแบบ "ทั้งกลุ่ม" และ "เลือกเอง"
            # ปนกันในข้อมูลชุดเดียว — สองเส้นทางนี้เดินคนละโค้ดใน resolve_recipients()
            if code in ("smoke_detected", "water_leak"):
                picked = (
                    db.query(Contact).filter_by(group_id=group.id)
                    .order_by(Contact.order_index).limit(2).all()
                )
                for i, c in enumerate(picked):
                    get_or_create(
                        db, ApiKeyEventContact, {"order_index": i},
                        api_key_id=key.id, event_type_id=ev.id, contact_id=c.id,
                    )
        keys.append(key)

    db.flush()
    return groups, events, keys


def prune_stale(db) -> None:
    """เอาของที่ไม่ได้อยู่ในแคตตาล็อกออก

    ฐานข้อมูลตอนพัฒนามักมีเศษจากการกดเล่นค้างอยู่ (กลุ่มชื่อ "กลุ่ม 1" ที่คำอธิบาย
    เป็นตัวยึกยือเพราะเคยบันทึกผิด encoding, อุปกรณ์ทดสอบที่ไม่ได้ผูกอะไรเลย)
    ซึ่งไปโผล่ปนกับข้อมูลตัวอย่างในหน้าตั้งค่า แล้วดูเหมือนระบบมีข้อมูลเสีย
    ถึงตรงนี้งานโทรถูกลบไปหมดแล้ว จึงไม่มีอะไรอ้างถึงแถวพวกนี้ค้างอยู่"""
    keep_groups = {name for name, _, _ in GROUPS}
    keep_events = {code for code, _, _ in EVENT_TYPES}
    keep_devices = {name for name, _, _ in DEVICES}

    for group in db.query(Group).all():
        if group.name not in keep_groups:
            db.query(Contact).filter_by(group_id=group.id).delete()
            db.delete(group)
    for ev in db.query(EventType).all():
        if ev.code not in keep_events:
            db.delete(ev)
    for key in db.query(ApiKey).all():
        if key.name not in keep_devices:
            db.delete(key)
    db.flush()


def pick_outcome(rng: random.Random):
    total = sum(w for _, w, _, _ in OUTCOMES)
    roll = rng.uniform(0, total)
    upto = 0.0
    for status, weight, result, detail in OUTCOMES:
        upto += weight
        if roll <= upto:
            return status, result, detail
    return OUTCOMES[0][0], OUTCOMES[0][2], OUTCOMES[0][3]


def mask(number: str) -> str:
    """ต้องตรงกับ _mask_number ใน call_worker — หน้าประวัติโชว์ค่านี้ตรงๆ"""
    if len(number) <= 4:
        return "*" * len(number)
    return number[:3] + "*" * (len(number) - 6) + number[-3:]


WORK_HOURS = [1, 3, 6, 8, 8, 9, 9, 10, 11, 13, 14, 14, 15, 16, 17, 19, 21, 22, 23]


def _at(rng: random.Random, now: dt.datetime, day: int) -> dt.datetime:
    """สุ่มเวลาในวันนั้น โดยเกาะกลุ่มตามชั่วโมงทำงาน"""
    stamp = now - dt.timedelta(days=day)
    return stamp.replace(hour=rng.choice(WORK_HOURS), minute=rng.randrange(60),
                         second=rng.randrange(60), microsecond=rng.randrange(1_000_000))


def spread_over_days(rng: random.Random, count: int, days: int, min_per_day: int,
                     now: dt.datetime) -> list[dt.datetime]:
    """เวลาที่กระจายแบบ 'เหมือนของจริง' ไม่ใช่แบบสุ่มแบนๆ

    สามอย่างที่ทำให้ต่างจากการสุ่มธรรมดา แล้วมีผลกับหน้าเว็บจริงๆ:
      1. ทุกวันต้องมีสายอย่างน้อย min_per_day — ก่อนหน้านี้แจกด้วยการสุ่มล้วน
         ซึ่งแปลว่าบางวันได้ศูนย์ พอเปิดหน้าประวัติแล้วเลื่อนย้อนไปจะเจอวันที่หายไป
         เป็นช่องว่าง ดูเหมือนระบบไม่ได้ทำงานวันนั้นทั้งที่แค่ตัวสุ่มไม่ได้เลือก
         (จองโควตาให้ทุกวันก่อน แล้วค่อยเอาที่เหลือไปแจกแบบเอนไปทางวันใหม่)
      2. วันนี้กับเมื่อวานหนาแน่นกว่าวันเก่า — หน้าประวัติเปิดมาเจอหัววันหลายอัน
         ในหน้าแรก ซึ่งเป็นภาพที่คนใช้งานจริงเห็น ไม่ใช่หน้าแรกที่มีวันเดียว
      3. เกาะกลุ่มเป็นช่วงๆ ตามชั่วโมงทำงาน — กราฟ 24 ชั่วโมงในหน้าภาพรวม
         จะได้มีแท่งสูงต่ำให้ดู แทนที่จะเรียบเท่ากันหมดจนดูเหมือนกราฟเสีย
    """
    out: list[dt.datetime] = []

    # 1) โควตาขั้นต่ำรายวัน — ถ้า count น้อยกว่าที่ต้องใช้ ก็ลดโควตาลงเท่าที่พอแจก
    base = min(min_per_day, count // days) if days > 0 else 0
    for day in range(days):
        for _ in range(base):
            out.append(_at(rng, now, day))

    # 2) ที่เหลือแจกแบบเอนไปทางวันใหม่ (ยกกำลังสอง, 0 = วันนี้)
    for _ in range(count - len(out)):
        out.append(_at(rng, now, int((rng.random() ** 2) * days)))

    out.sort()
    return out


def seed_jobs(db, groups, events, keys, count: int, days: int, min_per_day: int,
              rng: random.Random) -> int:
    # utcnow() ทั้งที่ deprecated — เพราะทั้งแอปเก็บเวลาเป็น UTC แบบไม่มี tzinfo
    # (ดู default ของคอลัมน์ใน database.py) ถ้าตรงนี้ใส่แบบมี tz เวลาจะเทียบกับของเดิมไม่ได้
    now = dt.datetime.utcnow()
    times = spread_over_days(rng, count, days, min_per_day, now)

    # เตรียมไว้ล่วงหน้า จะได้ไม่ query ซ้ำทุกงาน
    contacts_of = {
        g.id: db.query(Contact).filter_by(group_id=g.id).order_by(Contact.order_index).all()
        for g in groups.values()
    }
    device_links = {
        key.id: db.query(ApiKeyEventType).filter_by(api_key_id=key.id).all()
        for key in keys
    }

    made = 0
    for i, created in enumerate(times):
        key = rng.choice(keys)
        link = rng.choice(device_links[key.id])
        ev = db.get(EventType, link.event_type_id)
        group = db.get(Group, link.group_id)
        people = contacts_of[group.id]

        live = i >= count - len(LIVE_STATES)
        if live:
            status = LIVE_STATES[i - (count - len(LIVE_STATES))]
            result, detail = None, None
            created = now - dt.timedelta(minutes=rng.randrange(1, 25))
        else:
            status, result, detail = pick_outcome(rng)

        # ไล่เบอร์: งานที่จบสวยมักจบที่เบอร์แรก งานที่ล้มเหลวคือไล่ครบทุกเบอร์แล้ว
        if status == CallStatus.CONNECTED:
            reached = rng.choice([0, 0, 0, 1, 1, 2])
        elif status == CallStatus.FAILED:
            reached = len(people) - 1
        else:
            reached = rng.randrange(len(people))
        reached = min(reached, len(people) - 1)

        job = CallJob(
            message=ev.message_template.replace("{device}", key.name),
            event_type_id=ev.id,
            event_type_code=ev.code,
            event_type_name=ev.display_name,
            group_id=group.id,
            priority_group=group.name,
            recipients=json.dumps(
                [{"name": c.name, "phone": c.phone_number} for c in people],
                ensure_ascii=False,
            ),
            api_key_id=key.id,
            source_device=key.name,
            contact_index=reached,
            retry_count=0 if status == CallStatus.CONNECTED else rng.choice([0, 0, 1, 1, 2]),
            status=status,
            created_at=created,
            updated_at=created + dt.timedelta(seconds=rng.randrange(8, 180)),
        )
        if live and status != CallStatus.IN_PROGRESS:
            job.next_attempt_at = now + dt.timedelta(hours=PARK_HOURS)
        db.add(job)
        db.flush()
        made += 1

        if live:
            continue

        # log หนึ่งบรรทัดต่อหนึ่งเบอร์ที่ไล่ไปจริง — เบอร์ก่อนหน้าคือเบอร์ที่ไม่รับ
        stamp = created
        for idx in range(reached + 1):
            last = idx == reached
            stamp += dt.timedelta(seconds=rng.randrange(6, 45))
            db.add(CallLog(
                job_id=job.id,
                phone_number_masked=mask(people[idx].phone_number),
                result=result if last else "no_answer",
                detail=(detail if last else "ปล่อยดังจนครบเวลาแล้วไม่มีใครรับ"),
                timestamp=stamp,
            ))

        if made % 100 == 0:
            db.flush()

    # หน้าอุปกรณ์อ่าน last_used_at มาแสดงว่า "ยิงเข้ามาครั้งล่าสุดเมื่อไหร่"
    # ถ้าไม่เซ็ต ทุกใบจะขึ้นว่า "ยังไม่เคยส่งข้อมูล" ทั้งที่มีงานโทรของมันอยู่เป็นร้อย
    for key in keys:
        newest = (
            db.query(CallJob.created_at)
            .filter(CallJob.api_key_id == key.id)
            .order_by(CallJob.created_at.desc())
            .first()
        )
        if newest:
            key.last_used_at = newest[0]

    return made


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="ยืนยันว่ารู้ตัวว่ากำลังลบงานโทรทั้งหมดในฐานข้อมูลนี้")
    ap.add_argument("--jobs", type=int, default=520, help="จำนวนงานโทรที่จะสร้าง (ค่าเริ่มต้น 520)")
    ap.add_argument("--days", type=int, default=60, help="กระจายย้อนหลังกี่วัน (ค่าเริ่มต้น 60)")
    ap.add_argument("--min-per-day", type=int, default=3,
                    help="อย่างน้อยกี่สายต่อวัน ทุกวันต้องมีประวัติไม่มีวันไหนว่าง (ค่าเริ่มต้น 3)")
    args = ap.parse_args()

    if not args.yes:
        print("สคริปต์นี้ลบงานโทรและ log ทั้งหมดในฐานข้อมูลก่อนเติมของใหม่")
        print("ถ้าแน่ใจว่าไม่ได้ชี้ไปที่ฐานข้อมูลจริง ให้ใส่ --yes")
        return 1

    rng = random.Random(SEED)
    db = SessionLocal()
    try:
        gone_logs = db.query(CallLog).delete()
        gone_jobs = db.query(CallJob).delete()
        db.flush()
        print(f"ลบของเดิม: งานโทร {gone_jobs} รายการ, log {gone_logs} บรรทัด")

        prune_stale(db)
        groups, events, keys = build_catalogue(db)
        print(f"แคตตาล็อก: {len(groups)} กลุ่ม, "
              f"{db.query(Contact).count()} เบอร์, "
              f"{len(events)} ประเภทเหตุการณ์, {len(keys)} อุปกรณ์")

        made = seed_jobs(db, groups, events, keys, args.jobs, args.days, args.min_per_day, rng)
        db.commit()

        print(f"สร้างงานโทร {made} รายการ ย้อนหลัง {args.days} วัน, "
              f"log {db.query(CallLog).count()} บรรทัด")

        # ยืนยันว่าไม่มีวันไหนหลุด — ถ้าโควตารายวันพังขึ้นมาต้องเห็นตรงนี้ ไม่ใช่ไปเห็น
        # ตอนเลื่อนหน้าประวัติแล้วสงสัยว่าทำไมวันที่ 12 หายไป
        by_day = {}
        for (created,) in db.query(CallJob.created_at).all():
            by_day[created.date()] = by_day.get(created.date(), 0) + 1
        empty = [str(dt.date.today() - dt.timedelta(days=d)) for d in range(args.days)
                 if (dt.date.today() - dt.timedelta(days=d)) not in by_day]
        if empty:
            print(f"   ⚠️ วันที่ยังไม่มีสาย {len(empty)} วัน: {', '.join(empty[:5])}")
        else:
            print(f"   ทุกวันมีประวัติครบ {len(by_day)} วัน "
                  f"(น้อยสุด {min(by_day.values())} สาย, มากสุด {max(by_day.values())} สาย)")
        for status in CallStatus:
            n = db.query(CallJob).filter(CallJob.status == status).count()
            if n:
                print(f"   {status.value:<12} {n}")
        return 0
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
