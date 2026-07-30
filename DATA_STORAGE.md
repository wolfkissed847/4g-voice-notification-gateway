# การจัดเก็บข้อมูลของระบบ (Data Storage)

เอกสารนี้อธิบายว่าระบบเก็บ**อะไร ที่ไหน อย่างไร และทำไมออกแบบแบบนั้น**
อัปเดตล่าสุด: 26 ก.ค. 2569 (schema revision `5ca0b780423c`)

---

## 1. ภาพรวม — ทุกอย่างเป็นไฟล์บนเครื่อง ไม่มี DB server

ระบบนี้เก็บข้อมูลทั้งหมดเป็นไฟล์ธรรมดาบน filesystem ของ Raspberry Pi ไม่มี database server
แยก process, ไม่มีการเชื่อมต่อผ่าน network, ไม่มี container ของ DB

| ที่เก็บ | เก็บอะไร | รูปแบบ | ขนาดจริงตอนนี้ |
|---|---|---|---|
| `gateway.db` | ข้อมูลทั้งหมดของระบบ (9 ตาราง) | ไฟล์ SQLite | 100 KB (ยังว่าง) |
| `gateway.db-wal` | transaction ที่ commit แล้วแต่ยังไม่ merge เข้าไฟล์หลัก | ไฟล์พ่วงของ WAL | 0 B |
| `gateway.db-shm` | shared memory index ให้ reader/writer เห็นตรงกัน | ไฟล์พ่วงของ WAL | 32 KB |
| `audio_cache/` | ไฟล์เสียง .mp3 ที่ gTTS สร้างจากข้อความแจ้งเตือน | mp3 ต่อ 1 ข้อความ | ว่าง |
| `logs/` | *(ตอนนี้ยังไม่มีอะไรเขียนลงมาเลย — log ออก stdout เท่านั้น)* | – | ว่าง |
| `.env` | ความลับที่ห้ามอยู่ใน DB (ดูข้อ 5) | key=value | – |

**ไฟล์พ่วง 2 ตัวสำคัญมาก** — `-wal` กับ `-shm` ต้องอยู่โฟลเดอร์เดียวกับ `gateway.db` เสมอ
ถ้าย้าย/backup เฉพาะ `gateway.db` ตัวเดียวขณะระบบทำงาน จะได้ข้อมูลไม่ครบ
(วิธี backup ที่ถูกต้องคือ `VACUUM INTO` ไม่ใช่ `cp` — ดูข้อ 7)

### path จริงแยกตามสภาพแวดล้อม

| | dev (Windows) | Pi (Docker) |
|---|---|---|
| ค่า `DATABASE_URL` | `sqlite:///./gateway.db` | `sqlite:////app/data/gateway.db` (4 slash) |
| ไฟล์อยู่ที่ | root ของ repo | `/app/data/` ใน container = `./data/` บน host |
| รอด container rebuild? | – | รอด เพราะเมานต์เป็นโฟลเดอร์ ([docker-compose.yml](docker-compose.yml)) |

---

## 2. ทำไมเลือกไฟล์ (SQLite) ไม่ใช่ DB server

| ประเด็น | SQLite (ไฟล์) | Postgres/MySQL (server) |
|---|---|---|
| Process | ไม่มี — เป็น library ใน process ของ FastAPI | process แยก + network stack |
| RAM | หลัก MB (แชร์กับแอป) | ประมาณ 40-50 MB baseline + `shared_buffers` default 128 MB |
| การเขียน SD card ตอน idle | แทบไม่มี | WAL segment 16 MB ต่อเนื่อง + autovacuum + checkpoint + stats |
| จุดที่ต้องพร้อมก่อนแอปทำงาน | ไม่มี | ต้องรอ DB ready (healthcheck + retry) |
| เพดานที่จะเจอปัญหา | writer พร้อมกันหลายตัว / ข้ามเครื่อง | ไม่เจอ |

**เหตุผลที่เพดานของ SQLite ไม่โดนระบบนี้:** ฮาร์ดแวร์มีซิมใบเดียว โทรได้ทีละ 1 สาย
เลยมี worker thread ตัวเดียวที่เขียนคิว และ dashboard มีผู้ใช้คนเดียว (single-user login)
งานเขียนจริงคือไม่กี่แถวต่อการแจ้งเตือน 1 ครั้ง

**ที่สำคัญกว่า:** Pi 3 มี RAM 1 GB ทั้งเครื่อง ซึ่งต้องแบ่งให้ uvicorn + call worker + gTTS + Docker daemon อยู่แล้ว
และ use case ของระบบคือโทรแจ้งตอน**ไฟดับ** — จังหวะที่ไฟกลับมาแล้ว Pi boot ขึ้น
คือจังหวะที่ต้องพร้อมทำงานเร็วและแน่นอนที่สุด ยิ่งมี service ต้องรอกันยิ่งมีทางพลาด

> หมายเหตุ: การเอา DB ขึ้น container **ไม่ได้** ทำให้ข้อมูลปลอดภัยขึ้น เพราะสุดท้ายก็เก็บลง
> bind mount บน SD card ใบเดียวกัน จุดเสี่ยงจริงคือ SD card ซึ่งแก้ด้วย backup + ย้ายไป USB SSD
> ไม่ใช่ด้วยการเปลี่ยน DB engine

---

## 3. ตารางใน gateway.db

### `call_jobs` — คิวงานโทร (หัวใจของระบบ)

ทำหน้าที่เป็นทั้งคิว FIFO และประวัติการโทรในตารางเดียว

| คอลัมน์ | ชนิด | หน้าที่ |
|---|---|---|
| `id` | INTEGER PK | – |
| `message` | TEXT | ข้อความที่จะอ่านเป็นเสียง (render จาก template แล้ว) |
| `event_type_id` | INTEGER FK → `event_types` | ประเภทเหตุการณ์ (null ได้ สำหรับ job เก่าก่อน migration) |
| `priority_group` | VARCHAR | **snapshot ชื่อกลุ่มตอนสั่งโทร** — ไม่ใช่ FK โดยตั้งใจ |
| `api_key_id` | INTEGER FK → `api_keys` *(indexed)* | อุปกรณ์ที่เป็นต้นเหตุ (null = สั่งทดสอบจาก dashboard) |
| `source_device` | VARCHAR | **snapshot ชื่ออุปกรณ์ตอนนั้น** — เหตุผลเดียวกับ `priority_group` |
| `contact_index` | INTEGER | ตำแหน่งปัจจุบันใน escalation chain |
| `retry_count` | INTEGER | จำนวนครั้งที่ retry เบอร์ปัจจุบันไปแล้ว |
| `status` | VARCHAR(17) *(indexed)* | สถานะใน state machine (10 ค่า) |
| `next_attempt_at` | DATETIME *(indexed)* | เวลาที่เร็วที่สุดที่หยิบไปโทรได้ (null = ได้เลย) |
| `created_at` | DATETIME *(indexed)* | – |
| `updated_at` | DATETIME | – |

**ทำไม `priority_group` เก็บเป็นข้อความไม่ใช่ FK:** เพื่อให้ประวัติการโทรย้อนหลังยังอ่านได้ถูก
ถ้าเก็บเป็น FK แล้ววันหลังมีคนเปลี่ยนชื่อกลุ่มหรือลบกลุ่มทิ้ง ประวัติเก่าจะเปลี่ยนตาม/หายไปด้วย
ซึ่งผิด — ประวัติต้องบอกว่า "ตอนนั้น" โทรหากลุ่มชื่ออะไร

**ทำไมต้องมี `next_attempt_at`:** เดิม worker หน่วง retry ด้วย `time.sleep()` ซึ่งค้างทั้ง thread
ทำให้ job อื่นที่ไม่เกี่ยวกันหยุดรอไปด้วย เก็บเวลาลง DB แทนทำให้ worker ข้าม job ที่ยังไม่ถึงคิวได้

**ค่าของ `status`** — ระวังตอนเปิดไฟล์ดูเอง: DB เก็บเป็น**ตัวใหญ่** (`CONNECTED`) แต่ API คืนเป็น**ตัวเล็ก** (`connected`)
เพราะ SQLAlchemy เก็บ enum ด้วยชื่อสมาชิก แต่ Pydantic ส่งออกด้วยค่า

| status | ความหมาย |
|---|---|
| `queued` | เข้าคิวรอ worker หยิบ |
| `in_progress` | worker หยิบไปแล้ว กำลังโทร |
| `connected` | โทรติดและเล่นข้อความจบ (สำเร็จ) |
| `no_answer` / `busy` | ผลของความพยายามครั้งนั้น |
| `retrying` | รอ retry เบอร์เดิม |
| `escalated` | ครบ retry ของเบอร์นี้ รอโทรเบอร์ถัดไปในกลุ่ม |
| `sms_fallback_sent` | โทรไม่ติดทุกเบอร์ ส่ง SMS แทนแล้ว |
| `failed` | หมดทางแล้ว |
| `cancelled` | ผู้ใช้สั่งยกเลิกจาก dashboard |

### `call_logs` — audit trail ของทุกครั้งที่พยายามโทร

| คอลัมน์ | ชนิด | หน้าที่ |
|---|---|---|
| `id` | INTEGER PK | – |
| `job_id` | INTEGER *(indexed)* | อ้างถึง `call_jobs.id` — **ยังไม่มี FK constraint** (ดูข้อ 7) |
| `phone_number_masked` | VARCHAR | เบอร์แบบปิดบางส่วน เช่น `081****678` |
| `result` | VARCHAR | ผลลัพธ์ครั้งนั้น (`connected`/`no_answer`/`busy`/`sms_fallback`) |
| `detail` | TEXT | รายละเอียดเพิ่ม (กรณี SMS จะเก็บข้อความที่ส่ง) |
| `timestamp` | DATETIME | – |

1 job มีได้หลาย log — โทร 3 เบอร์ เบอร์ละ 2 retry = 6 แถว
ตารางนี้ตอบคำถามว่า "ทำไมงานนี้ถึง failed" ได้ ในขณะที่ `call_jobs` เก็บแค่สถานะสุดท้าย

### `groups` + `contacts` — escalation chain

| ตาราง | คอลัมน์สำคัญ | หมายเหตุ |
|---|---|---|
| `groups` | `name` (UNIQUE), `description` | เช่น "ทีมเครือข่าย", "ทีมไฟฟ้า" |
| `contacts` | `group_id` (FK, ON DELETE CASCADE), `phone_number`, `order_index` | `order_index` = ลำดับการโทร |

**ทำไมต้องมี `order_index` แยก:** ลำดับ escalation คือ business logic
ไม่ใช่ผลพลอยได้จากลำดับ `id` ที่บังเอิญเพิ่มเข้ามา ผู้ใช้ต้องลากสลับลำดับได้จาก dashboard
โดยไม่ต้องลบ-สร้างใหม่ (`PUT /groups/{id}/contacts/reorder`)

**ON DELETE CASCADE:** ลบกลุ่มแล้วเบอร์ในกลุ่มหายตามโดยอัตโนมัติ ไม่เหลือแถวลอย
(SQLite ไม่บังคับ FK เอง ต้องสั่ง `PRAGMA foreign_keys=ON` ทุก connection — ทำไว้แล้วใน [database.py](app/database.py))

### `event_types` — ประเภทเหตุการณ์ + template ข้อความ

**ตัวแปร `{device}` ในข้อความถูกเติมให้อัตโนมัติจากชื่ออุปกรณ์เจ้าของ key** อุปกรณ์จึงส่งมาแค่
key + `event_type_code` ไม่ต้องส่งชื่อตัวเองมาใน payload เลย (ดู `render_message`
ใน [event_types_service.py](app/event_types_service.py)) — ถ้า payload ส่ง `device` มาเองจะให้ค่าจาก payload ชนะ
เผื่อกรณี gateway ตัวเดียวรายงานแทนอุปกรณ์ปลายทางหลายตัว

| คอลัมน์ | หน้าที่ |
|---|---|
| `code` (UNIQUE, indexed) | รหัสที่ระบบภายนอกส่งมาใน `POST /notify` เช่น `power_outage` |
| `display_name` | ชื่อที่แสดงใน dashboard |
| `message_template` | เทมเพลตข้อความ มีตัวแปร `{key}` แทนค่าได้ |
| `group_id` (FK) | ผูกว่าเหตุการณ์นี้โทรหากลุ่มไหน |
| `is_active` | เปิด/ปิดชั่วคราวโดยไม่ต้องลบ |

**ทำไมต้องมีตารางนี้:** ฝั่งบอร์ด/ระบบ monitoring ที่ยิงเข้ามาไม่ควรต้องรู้ว่าจะโทรหาใคร
มันแค่บอกว่า "เกิดเหตุประเภทนี้" แล้วให้ gateway เป็นคนตัดสินใจว่าโทรหากลุ่มไหน ด้วยข้อความอะไร
เปลี่ยนผู้รับสายได้จาก dashboard โดยไม่ต้องแก้โค้ดฝั่งบอร์ดเลย

### `api_keys` — ตัวตนของอุปกรณ์ 1 ตัว

**1 key = 1 อุปกรณ์** ไม่ใช่ 1 key ต่อ 1 ประเภทการแจ้งเตือน

| คอลัมน์ | หน้าที่ |
|---|---|
| `name` | **ชื่ออุปกรณ์** เช่น "โหนดตึก A ชั้น 3" — ถูกเติมลง `{device}` ในข้อความอัตโนมัติ |
| `key_prefix` | 14 ตัวแรก (`gw_live_xxxxxx`) สำหรับโชว์ใน dashboard ให้จำได้ว่าอันไหน |
| `key_hash` | **sha256 ของ key เต็ม** — ตัวที่ใช้ตรวจจริง |
| `is_active`, `revoked_at` | revoke แล้วไม่ลบแถว เก็บไว้เป็นประวัติ |
| `last_used_at` | อัปเดตทุกครั้งที่ใช้ — ใช้เป็น **heartbeat รายอุปกรณ์** ดูได้ว่าบอร์ดตัวไหนเงียบไปนานแล้ว |

**ทำไม key ผูกกับอุปกรณ์ ไม่ใช่ผูกกับประเภทการแจ้งเตือน:** เพราะ key ถูกฝังใน firmware
ครั้งเดียวแล้วเปลี่ยนไม่ได้อีกโดยไม่แฟลชใหม่ ทุกอย่างที่อาจต้องเปลี่ยนทีหลังจึงต้องอยู่ฝั่ง DB

- ชื่ออุปกรณ์อยู่ในตารางนี้ → ย้ายบอร์ดไปติดตั้งที่อื่นแล้วแก้ชื่อจาก dashboard ได้เลย
- อุปกรณ์หาย/ถูกขโมย → revoke แค่ key ของตัวนั้น ตัวอื่นในไซต์เดียวกันไม่กระทบ
  (ถ้าใช้ key ร่วมกันหลายบอร์ด การ revoke 1 ครั้งจะบังคับให้ต้องแฟลชใหม่ทุกตัว)

### `api_key_event_types` — อุปกรณ์นี้ยิงอะไรได้บ้าง

ตารางเชื่อม many-to-many ระหว่าง `api_keys` กับ `event_types` (PK ร่วม 2 คอลัมน์, CASCADE ทั้งคู่)

**ทำไมต้องมี:** ถ้าไม่มี key ทุกอันจะสั่งได้ทุกการแจ้งเตือนในระบบ
อุปกรณ์ 1 ตัวที่หายไปจากไซต์งานจะกลายเป็นสิทธิ์สั่งให้ระบบโทรได้ทุกเรื่อง
ซึ่งเกินกว่าที่อุปกรณ์นั้นต้องใช้จริง — `/notify` ตอบ 403 ถ้ายิง event type ที่ไม่ได้ผูกไว้

แก้รายการนี้จาก dashboard ได้ตลอด (`PUT /api-keys/{id}`) โดย key เดิมยังใช้ได้เหมือนเดิม

**ทำไม sha256 ไม่ใช่ bcrypt:** key ถูกสุ่มด้วย `secrets.token_urlsafe(32)` = เอนโทรปี 256 bit
ซึ่งเดาไม่ได้อยู่แล้ว จึงไม่ต้องการ hash แบบช้าเพื่อกัน brute-force
ต่างจากรหัสผ่านมนุษย์ที่เอนโทรปีต่ำ — ตัวนั้นใช้ bcrypt (ดูข้อ 5)
และการตรวจ API key เกิดทุกครั้งที่มีการแจ้งเตือน ซึ่งเป็น path ที่ต้องเร็ว

### `app_settings` — config ที่แก้ได้จากหน้าเว็บ

singleton มีแถวเดียวเสมอ (`id=1`) เก็บ `call_retry_count`, `call_retry_delay_seconds`,
`call_ring_timeout_seconds`, `sms_fallback_enabled`, `updated_at`

**ทำไมอยู่ใน DB ไม่ใช่ `.env`:** ค่าพวกนี้ผู้ใช้ต้องปรับบ่อยตามหน้างาน
ถ้าอยู่ใน `.env` ต้อง SSH เข้า Pi + แก้ไฟล์ + restart container ทุกครั้ง
อยู่ใน DB แล้ว worker เช็ค `updated_at` เป็นระยะ เห็นค่าใหม่เองภายในไม่กี่วินาที ไม่ต้อง restart
(`.env` เหลือหน้าที่เป็นแค่ค่า default ตอนสร้างแถวแรกครั้งเดียว)

### `alembic_version` — เวอร์ชันของ schema

แถวเดียว คอลัมน์เดียว เก็บ revision id ปัจจุบัน (ตอนนี้ `76a340f49b9e`)
Alembic ใช้ค่านี้ตัดสินว่าต้องรัน migration ตัวไหนต่อ (ดูข้อ 6)

---

## 4. audio_cache — ไฟล์เสียง

ตั้งชื่อไฟล์เป็น `sha256(ข้อความ)[:16].mp3` แล้วเช็คก่อนสร้าง ถ้ามีแล้วใช้ซ้ำเลย

**ทำไม cache ด้วย hash ของข้อความ:** gTTS ต้องต่อเน็ตออกไปหา Google
ซึ่งช้าและอาจล่ม — ถ้าเหตุการณ์เดิมเกิดซ้ำ (ข้อความเหมือนเดิมเป๊ะ) ไม่ต้องยิงออกเน็ตอีก
ได้ทั้งเร็วขึ้นและทนเน็ตล่มขึ้น

**สิ่งที่ต้องรู้:** ไฟล์เหล่านี้คือเนื้อหาการแจ้งเตือนในรูปเสียง และ**ไม่มีกลไกลบทิ้งเลย**
โตขึ้นเรื่อยๆ ตามจำนวนข้อความที่ไม่ซ้ำกัน

---

## 5. สิ่งที่ตั้งใจ "ไม่เก็บ" ลง DB

| ข้อมูล | เก็บที่ไหน / เก็บแบบไหน | เหตุผล |
|---|---|---|
| รหัสผ่าน admin | bcrypt hash ใน `.env` (`ADMIN_PASSWORD_HASH`) | ผู้ใช้คนเดียว ไม่มีระบบสมัคร จึงไม่ต้องมีตาราง users; bcrypt เพราะรหัสผ่านมนุษย์เอนโทรปีต่ำ ต้องใช้ hash แบบช้า |
| API key ตัวเต็ม | ไม่เก็บ — เก็บแค่ sha256 | หลุด DB ไปก็ใช้ยิง `/notify` ไม่ได้; ผู้ใช้เห็น plaintext ครั้งเดียวตอนสร้าง |
| JWT secret / encryption key | `.env` | ถ้าอยู่ใน DB ที่มันใช้เข้ารหัสเองก็ไม่มีประโยชน์ |
| เบอร์โทรใน log | ปิดบางส่วน (`081****678`) | log ถูกอ่านบ่อยกว่าและกระจายง่ายกว่าตัว DB — เบอร์เต็มอยู่ในตาราง `contacts` ที่ต้อง login เท่านั้น |
| serial port / ค่า bootstrap | `.env` | ตั้งครั้งเดียวตอน deploy ไม่ใช่ค่าที่ผู้ใช้ปรับ |

---

## 6. การตั้งค่า SQLite และการจัดการ schema

### PRAGMA ที่ตั้งทุก connection ([database.py](app/database.py))

| PRAGMA | ค่า | เหตุผล |
|---|---|---|
| `foreign_keys` | `ON` | SQLite ไม่บังคับ FK โดย default และไม่จำข้าม connection |
| `journal_mode` | `WAL` | worker commit ถี่มาก (ทุก log + ทุกเปลี่ยนสถานะ) พร้อมกับที่ API อ่านเขียนไฟล์เดียวกัน โหมด default ให้ writer ล็อกทั้งไฟล์ = API ค้างรอ worker |
| `synchronous` | `NORMAL` | ปลอดภัยพอเมื่อคู่กับ WAL และลด fsync ที่กิน SD card |
| `busy_timeout` | `5000` ms | ถ้าชนกันจริงให้รอ ไม่ใช่โยน `database is locked` ทันที |

### Schema versioning — Alembic

- ทุกการเปลี่ยน schema ต้องผ่าน revision ใน [migrations/versions/](migrations/versions/) เท่านั้น
- `init_db()` = `alembic upgrade head` ถูกเรียกตอน startup → **Pi migrate ตัวเองตอน deploy ไม่ต้อง SSH เข้าไปรันมือ**
- `detect_schema_drift()` เตือนตอน startup ถ้ามีคนแก้ model แล้วลืมสร้าง revision

**ทำไมต้องมี:** เดิม `init_db()` ใช้ `create_all()` ซึ่ง "สร้างตารางที่ยังไม่มี" เท่านั้น ไม่เคย ALTER ตารางเดิม
ผลคือเคยเพิ่ม `call_jobs.event_type_id` ใน model แล้ว DB จริงไม่มีคอลัมน์นั้น
ไม่มี error ตอน start แต่พังตอน query ครั้งแรกเป็น `OperationalError: no such column`
ซึ่งทำให้ `/notify`, `/queue/status`, `/history` ตาย 500 ทั้งหมดโดยไม่มีใครรู้

---

## 7. ช่องว่างที่รู้ตัวแล้ว (ยังไม่ได้ทำ)

| # | เรื่อง | ผลกระทบ |
|---|---|---|
| 5 | `call_logs.job_id` ไม่มี FK constraint | log ลอยได้ ลบ job แล้ว log ค้าง |
| 6 | `contacts` ไม่มี UNIQUE(`group_id`, `phone_number`) | ใส่เบอร์ซ้ำในกลุ่มเดียวกันได้ = escalation โทรหาคนเดิม 2 รอบแล้วข้ามคนถัดไป |
| 7 | ไม่ normalize เบอร์เป็น E.164 | `081xxx` กับ `+6681xxx` ปนกันได้ แต่ `ATD` ต้องรูปแบบเดียว |
| 9 | `/history` ยิง query แยกต่อ 1 job เพื่อหา log ล่าสุด | ~41 queries ต่อการเปิด 1 หน้า |
| 10 | boolean เก็บเป็น string `"true"` (`is_active`, `sms_fallback_enabled`) | เปราะ ค่าอื่นที่ไม่ใช่ `"true"` จะกลายเป็น false เงียบๆ |
| 11 | `datetime.utcnow()` naive + deprecated | เวลาไม่มี timezone → dashboard อาจแสดงเพี้ยน 7 ชม. |
| 12 | ไม่มี retention — `call_jobs`, `call_logs`, `audio_cache` โตไม่สิ้นสุด | SD card เต็มในระยะยาว |
| 13 | ไม่มี backup | SD card เสีย = ข้อมูลหายหมด **ต้องใช้ `VACUUM INTO` ไม่ใช่ `cp`** เพราะ `cp` ระหว่างระบบทำงานจะได้ไฟล์ที่ไม่รวม `-wal` |
| 14 | ไม่มี seed data | ติดตั้งใหม่ `groups`/`event_types` ว่าง → `/notify` ตอบ 404 ทุกครั้ง |
| – | Docker log ไม่จำกัดขนาด | compose ไม่ได้ตั้ง `logging.options.max-size` → log ของ container กิน SD card ได้เรื่อยๆ |
| – | `logs/` ถูกเมานต์ไว้แต่ไม่มีอะไรเขียนลง | log ไปอยู่ stdout อย่างเดียว หายเมื่อ container ถูกลบ |
