# คู่มือการติดตั้ง

คู่มือนี้สำหรับคนที่ต้องการนำระบบไป build และรันเองด้วย Docker Compose บนเครื่องของตัวเอง
ไม่ใช่การ deploy อัตโนมัติผ่าน self-hosted runner ที่โปรเจคนี้ใช้อยู่

---

## 1. สิ่งที่ต้องมีก่อน

| อย่าง | รายละเอียด |
|---|---|
| เครื่อง | Raspberry Pi 3 ขึ้นไป (หรือเครื่อง Linux x86 ก็ได้) · RAM อย่างน้อย 1 GB |
| ระบบปฏิบัติการ | Raspberry Pi OS (64-bit) หรือ Debian/Ubuntu |
| Docker | Docker Engine + Docker Compose v2 (`docker compose` ไม่ใช่ `docker-compose`) |
| โมดูล 4G | SIMCOM A7670E / A7670C พร้อมซิมที่**เปิดบริการโทรออกด้วยเสียง**และยังมีเงินในซิม |
| อินเทอร์เน็ต | จำเป็นตลอดเวลาที่โทร — gTTS สร้างไฟล์เสียงใหม่ทุกสาย ไม่มีแคช |

> **ซิมต้องโทรออกได้จริง** — ซิมแบบเน็ตอย่างเดียว (data-only) ใช้กับระบบนี้ไม่ได้
> ทดสอบง่ายๆ ด้วยการเอาซิมไปใส่มือถือแล้วลองโทรออกก่อน

---

## 2. ติดตั้ง Docker (ข้ามได้ถ้ามีแล้ว)

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

ต้อง **logout แล้ว login ใหม่** สิทธิ์ถึงจะมีผล จากนั้นตรวจว่าใช้ได้:

```bash
docker compose version
```

---

## 3. โหลดโค้ดและตั้งค่า

```bash
git clone https://github.com/<your-account>/4g-voice-notification-gateway.git
cd 4g-voice-notification-gateway
cp .env.example .env
```

### สร้างค่าลับ 3 ตัวที่ต้องมี

```bash
python3 scripts/hash_password.py          # → ADMIN_PASSWORD_HASH
python3 scripts/generate_encryption_key.py # → ENCRYPTION_KEY
openssl rand -hex 32                       # → JWT_SECRET_KEY
```

เอาค่าที่ได้ไปใส่ใน `.env`:

```bash
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=<ผลจาก hash_password.py>
ENCRYPTION_KEY=<ผลจาก generate_encryption_key.py>
JWT_SECRET_KEY=<ผลจาก openssl rand>
```

> **ห้าม commit ไฟล์ `.env`** — `.gitignore` กันไว้ให้แล้ว และมี `gitleaks` ใน pre-commit
> ตรวจซ้ำอีกชั้น ถ้าจะใช้ hook นี้ด้วยให้รัน `pip install pre-commit && pre-commit install`

### ค่าที่มักต้องแก้เพิ่ม

| ตัวแปร | ค่าเริ่มต้น | แก้เมื่อไหร่ |
|---|---|---|
| `GSM_SERIAL_PORT` | `/dev/ttyUSB2` | โมดูลต่อผ่านหัว GPIO ให้ใช้ `/dev/serial0` |
| `GSM_GPIO_ENABLED` | `false` | ตั้ง `true` เฉพาะโมดูลที่ต่อผ่านหัว GPIO |
| `DASHBOARD_ORIGIN` | `http://localhost:5173` | ใช้ตอน dev หน้าเว็บแยกเท่านั้น |
| `ENABLE_API_DOCS` | `false` | เปิด `/docs` เฉพาะตอนพัฒนา อย่าเปิดบนเครื่องที่ออกเน็ต |

`DATABASE_URL` ใน `.env` **ไม่ต้องแก้** — `docker-compose.yml` บังคับเป็น
`sqlite:////app/data/gateway.db` ทับให้อยู่แล้ว เพื่อให้ฐานข้อมูลอยู่บนดิสก์จริง ไม่หายตอน deploy

---

## 4. เตรียมโฟลเดอร์ข้อมูล

```bash
mkdir -p data/audio_cache data/logs
chmod 700 data data/audio_cache data/logs
```

ไม่ต้องสร้างไฟล์ฐานข้อมูลเอง — ตัวแอปสร้างไฟล์และตารางให้เองตอนสตาร์ตผ่าน
`alembic upgrade head` (ดู `init_db()` ใน `app/database.py`)

---

## 5. เสียบโมดูล 4G

**แบบ USB** (ง่ายที่สุด) — เสียบแล้วตรวจว่าเครื่องเห็นพอร์ต:

```bash
ls /dev/ttyUSB*
```

ปกติจะเห็นหลายพอร์ต พอร์ตที่ใช้สั่ง AT มักเป็น `/dev/ttyUSB2` ถ้าไม่ตรง
ระบบจะไล่หาพอร์ตที่ตอบคำสั่ง AT เองอัตโนมัติ ไม่ต้องแก้ `.env`

**แบบต่อหัว GPIO** — ต้องเปิด UART ก่อน ดูวิธีต่อสายและตั้งค่าทั้งหมดที่ `docs/HARDWARE_GPIO.md`

> โมดูลยังไม่เสียบก็เปิดระบบได้ หน้าเว็บกับ API ทำงานปกติ เพียงแต่งานในคิวจะยังไม่ถูกโทรออก

---

## 6. build และรัน

```bash
docker compose up -d --build
docker compose logs -f gateway
```

build ครั้งแรกบน Pi 3 ใช้เวลาราว 10–20 นาที (build หน้าเว็บด้วย Vite + ติดตั้ง Python package)
ตรวจว่าขึ้นจริง:

```bash
curl http://127.0.0.1:8000/health     # ต้องได้ {"status":"ok"}
```

ระบบผูกไว้กับ `127.0.0.1:8000` เท่านั้น ไม่เปิดออกวง LAN โดยตั้งใจ ถ้าต้องการเข้าจากเครื่องอื่น
เลือกอย่างใดอย่างหนึ่ง:

- **SSH tunnel** (ชั่วคราว): `ssh -L 8000:localhost:8000 user@<ip-ของเครื่อง>`
- **Cloudflare Tunnel** (ถาวร): ติดตั้ง `cloudflared` แยกนอก compose แล้วชี้มาที่ `localhost:8000`
- **เปิดออก LAN ตรงๆ**: แก้ `ports` ใน `docker-compose.yml` เป็น `"8000:8000"`
  (ไม่แนะนำถ้าไม่มีอะไรกรองหน้าบ้าน)

---

## 7. ตั้งค่าครั้งแรกจากหน้าเว็บ

เปิดเว็บแล้วล็อกอินด้วย `ADMIN_USERNAME` กับรหัสผ่านที่เอาไป hash ไว้ จากนั้นทำ **ตามลำดับนี้**:

1. **กลุ่มผู้รับ** → สร้างกลุ่ม แล้วเพิ่มเบอร์เข้าไป (ลำดับในกลุ่ม = ลำดับการไล่โทร)
2. **ประเภทเหตุการณ์** → สร้างเหตุการณ์ กำหนด `code` (เช่น `server_down`) และข้อความที่จะพูด
3. **อุปกรณ์** → สร้างอุปกรณ์เพื่อรับ API key แล้วกด "เพิ่มเหตุการณ์" + "ตั้งค่า" เลือกผู้รับสาย

> ผู้รับสายถูกตัดสินที่**คู่ (อุปกรณ์ + เหตุการณ์)** ไม่ใช่ที่ตัวเหตุการณ์ ถ้ายังไม่ได้ตั้งผู้รับ
> ระบบจะปฏิเสธคำขอทันทีพร้อมบอกว่าต้องไปตั้งตรงไหน

---

## 8. ทดสอบยิงแจ้งเตือน

```bash
curl -X POST http://127.0.0.1:8000/notify \
  -H "X-API-Key: <key ที่ได้จากหน้าอุปกรณ์>" \
  -H "Content-Type: application/json" \
  -d '{"event_type_code": "server_down"}'
```

ส่งข้อความเองหรือแทนค่าตัวแปรในข้อความก็ได้:

```bash
-d '{"event_type_code": "server_down", "message": "เซิร์ฟเวอร์หลักดับ"}'
-d '{"event_type_code": "server_down", "variables": {"room": "ชั้น 3"}}'
```

ได้ `job_id` กลับมาแปลว่าเข้าคิวแล้ว ดูสถานะต่อได้ที่หน้า **คิวการโทร**

---

## 9. คำสั่งที่ใช้บ่อย

```bash
docker compose logs -f gateway        # ดู log สด
docker compose restart gateway        # รีสตาร์ท
docker compose up -d --build          # อัปเดตโค้ดแล้ว build ใหม่
docker compose down                   # หยุด (ข้อมูลใน data/ ยังอยู่)
bash scripts/backup_db.sh             # สำรองฐานข้อมูล (ใช้ backup API ของ SQLite)
```

---

## 10. เจอปัญหา

| อาการ | สาเหตุที่พบบ่อย |
|---|---|
| container ไม่ขึ้น | ไม่มีไฟล์ `.env` หรือ `ADMIN_PASSWORD_HASH` ว่าง — ดู `docker compose logs gateway` |
| เข้าเว็บได้แต่ไม่โทรออก | โมดูลไม่ตอบ AT — ดูหน้า **ระบบ & ฮาร์ดแวร์** ว่าเจอพอร์ตไหม ซิมลงทะเบียนเครือข่ายหรือยัง |
| โทรออกแต่ปลายสายไม่ได้ยินเสียง | เน็ตหลุดตอนสร้างเสียง (gTTS ต้องใช้เน็ตทุกสาย) |
| ฐานข้อมูลหายหลัง deploy | `DATABASE_URL` ไม่ได้ชี้ไป `/app/data/` — อย่าแก้ `environment` ใน compose |
| build ค้างที่ "load metadata" | เครือข่ายบล็อก Docker Hub — ตั้ง registry mirror ใน `/etc/docker/daemon.json` |

ปัญหาที่เคยเจอจริงพร้อมวิธีแก้เต็มๆ อยู่ใน `docs/ปัญหา.md` (ไม่ได้ขึ้น repo)

---

## 11. ข้อจำกัดที่ต้องรู้ก่อนเอาไปใช้จริง

- **ซิมใบเดียว = โทรได้ทีละสาย** งานที่เข้ามาพร้อมกันจะเรียงคิว (วัดได้ ~80 สาย/ชั่วโมง)
- **ต้องมีเน็ตตลอด** เพราะ gTTS สร้างเสียงใหม่ทุกครั้ง ไม่มีแคช
- **ไม่มีไฟสำรอง** ไฟดับคือระบบดับ — ครอบคลุมเฉพาะเหตุที่เกิดขณะระบบยังทำงานปกติ
- **ผู้ดูแลคนเดียว** ไม่มีระบบกู้รหัสผ่าน (ลืมแล้วต้อง hash ใหม่แล้วแก้ `.env`)
- **ไม่รองรับหลายองค์กรใช้ร่วมกัน**

ทั้งหมดเป็นการตัดสินใจโดยตั้งใจเพื่อให้ระบบเรียบง่ายและเชื่อถือได้ในขอบเขตที่ออกแบบไว้
