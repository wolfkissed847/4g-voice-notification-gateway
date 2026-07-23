# 4G Automated Voice Notification Gateway

**ภาษาไทย:** การออกแบบและพัฒนาระบบเกตเวย์โทรแจ้งเตือนด้วยข้อความเสียงอัตโนมัติผ่านเครือข่าย 4G
**English:** Design and Development of an Automated Voice Notification Gateway Server over 4G Network

> **หมายเหตุเรื่อง branch:** โปรเจคนี้มี branch `feature/voip-multi-sim` แยกไว้ต่างหาก
> ซึ่งมีระบบ VoIP (Asterisk + Zadarma) และ multi-SIM pool เพิ่มเติม — branch `main` นี้ตัดสองส่วนนั้นออก
> เพื่อให้ระบบเรียบง่ายและโฟกัสที่ SIM ตัวเดียวผ่าน GSM เท่านั้น

## 📌 Project Goal

ระบบ Robo-calling Gateway ขนาดเล็ก ทำงานแบบ Self-hosted (On-Premise) ภายในองค์กร ใช้สำหรับโทรแจ้งเตือน
เจ้าหน้าที่ไอที/ทีมช่างโดยอัตโนมัติเมื่อเกิดเหตุฉุกเฉิน (เช่น เซิร์ฟเวอร์ล่ม, ไฟดับ)

- **โทรออก**: ผ่านซิมจริง (SIMCOM A7670C, AT command) — ไม่พึ่ง Cloud VoIP
- **รับคำสั่ง**: ระบบ/บอร์ดภายนอกยิง `POST /notify` เข้ามา (มี API key ป้องกัน)
- **Dashboard**: ดูสถานะคิว + ปรับ config (retry/timeout/SMS fallback) ผ่านเว็บ — **ไม่ใช่ช่องสั่งโทร**
- **เครือข่าย**: Pi ใช้ LAN ออฟฟิศเป็นหลัก สลับไปใช้ 4G อัตโนมัติเมื่อ LAN หลุด (เช่นตอนไฟดับ)

## 🏗️ Hardware Architecture

| Component | Detail |
|---|---|
| Controller | Raspberry Pi |
| GSM/4G Module | SIMCOM A7670C (4G LTE Cat1, VoLTE, USB, AT Command) — **1 ตัว** |
| SIM Card | GOMO (AIS network), Data 10GB + Voice pay-per-minute + SMS top-up pack |
| เครือข่าย | LAN สายแลนออฟฟิศ (หลัก) + 4G จากโมดูลตัวเดียวกัน (สำรอง, auto-failover) |

## 📂 Project Structure

```
4g-voice-notification-gateway/
├── app/
│   ├── main.py            # FastAPI entrypoint: /notify, /auth/login, /queue/status, /config
│   ├── config.py          # ค่า bootstrap จาก .env
│   ├── config_service.py  # Config ที่แก้ผ่าน dashboard ได้ (retry/timeout/SMS fallback)
│   ├── database.py        # SQLite models — queue, call logs, app settings
│   ├── schemas.py         # Pydantic request/response models
│   ├── queue_manager.py   # FIFO queue logic (atomic claim)
│   ├── gsm_module.py      # AT Command wrapper สำหรับ SIMCOM A7670C
│   ├── tts_service.py     # gTTS wrapper: text → mp3 (ภาษาไทย, cache ตาม hash)
│   ├── call_worker.py     # Background worker: state machine + retry/escalation/SMS fallback
│   ├── auth.py            # Single-user JWT login (dashboard)
│   └── secrets_crypto.py  # Encrypt helper (เผื่ออนาคตเพิ่ม secret ที่ต้อง encrypt)
├── network_setup/         # Script + เอกสาร LAN+4G auto-failover
├── scripts/                # hash_password.py, generate_encryption_key.py
├── audio_cache/            # ไฟล์เสียงที่ gTTS สร้าง (gitignored)
├── logs/                   # log การโทร/สถานะ (gitignored)
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
├── .gitleaks.toml
├── requirements.txt
├── requirements-dev.txt
├── LICENSE                 # MIT
└── README.md
```

## ⚙️ Setup

```bash
git clone https://github.com/<your-username>/4g-voice-notification-gateway.git
cd 4g-voice-notification-gateway
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python scripts/hash_password.py           # ตั้งรหัสผ่าน admin
python scripts/generate_encryption_key.py # สร้าง encryption key (เผื่ออนาคต)
# แก้ .env ใส่ค่าที่ได้จาก 2 คำสั่งด้านบน + เบอร์โทร escalation
```

### เชื่อมต่อฮาร์ดแวร์
1. เสียบซิม GOMO (AIS) เข้าโมดูล A7670C
2. ต่อโมดูลเข้า Raspberry Pi ผ่านสาย USB (**ใช้ไฟเลี้ยงแยกสำหรับโมดูล ไม่ใช้ขา 5V ของ Pi โดยตรง**
   เพราะโมดูลกินกระแสพุ่งสูงตอนส่งสัญญาณ)
3. เช็ค serial port: `ls /dev/ttyUSB*` แล้วใส่ path ที่ถูกต้องใน `.env` (`GSM_SERIAL_PORT`)
4. ทดสอบโมดูลด้วย `AT` command ผ่าน `minicom` หรือ `screen` ก่อนรันระบบจริง
5. ตั้งค่า network failover (LAN+4G): ดู [`network_setup/README.md`](./network_setup/README.md)

### รันเซิร์ฟเวอร์
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 📡 API Usage

### แจ้งเตือนฉุกเฉิน (ระบบ/บอร์ดภายนอกเรียก)
```bash
curl -X POST http://localhost:8000/notify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: <API_SECRET_KEY จาก .env>" \
  -d '{
    "message": "เซิร์ฟเวอร์หลักล่ม กรุณาตรวจสอบด่วน",
    "priority_group": "network_team"
  }'
```

### Dashboard: login แล้วดู/แก้ config
```bash
# login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"<รหัสผ่านที่ตั้งไว้>"}'

# ใช้ access_token ที่ได้ เรียกดู queue/config
curl http://localhost:8000/queue/status -H "Authorization: Bearer <token>"
curl http://localhost:8000/config -H "Authorization: Bearer <token>"
```

## 🔁 Call Logic Summary

- **Connected** → เล่นไฟล์เสียง gTTS (ภาษาไทย) เข้าสาย
- **No Answer / Busy** →
  1. Retry ตามจำนวนรอบ + ระยะเวลาที่ตั้งไว้ (ปรับผ่าน dashboard `/config`)
  2. Escalation Chain → โทรหาเบอร์ลำดับถัดไปในกลุ่มเดียวกัน (เบอร์อยู่ใน `.env`)
  3. ถ้ายังไม่สำเร็จ → ส่ง SMS สรุปเหตุการณ์ (≤70 ตัวอักษร, EN+TH ปนกัน)

## 🐳 Deploy ด้วย Docker + CI/CD (แนะนำสำหรับใช้งานจริงบน Pi)

Pi 3 มีแรมจำกัด (1GB) จึง **ไม่ build อะไรบน Pi เลย** — ให้ GitHub Actions build ให้แทน:

```
git push (branch main) → GitHub Actions build multi-arch image (รวม frontend)
                        → push ขึ้น ghcr.io
Pi 3: Watchtower เช็คทุก 5 นาที → เจอ image ใหม่ → pull + restart container ให้เอง
```

**Setup ครั้งแรกบน Pi:**

```bash
git clone https://github.com/<your-username>/4g-voice-notification-gateway.git
cd 4g-voice-notification-gateway
cp .env.example .env   # แก้ค่าจริง (ดูหัวข้อ Setup ด้านบน)
mkdir -p data/audio_cache data/logs
touch data/gateway.db

# แก้ docker-compose.yml: เปลี่ยน <your-username> ในบรรทัด image: ให้ตรงกับ repo จริง

docker compose up -d
```

หลังจากนี้ **แค่ push โค้ดขึ้น GitHub** — ไม่ต้อง SSH เข้า Pi อีกเลย ระบบ build+deploy ให้เองภายในไม่กี่นาที

**หมายเหตุสำคัญ:**
- Multi-arch build (arm/v7 + arm64 + amd64) ผ่าน QEMU emulation บน GitHub Actions ใช้เวลานานกว่าปกติ
  (~15-30 นาทีต่อครั้ง เพราะ compile `cryptography`/`bcrypt` บน ARM แบบ emulate) — เป็นเรื่องปกติ ไม่ใช่ error
- ถ้า Pi รัน 32-bit OS ให้เช็คว่า Watchtower ดึง image tag `arm/v7` มาใช้ถูกต้อง (Docker เลือกให้อัตโนมัติตาม arch ของเครื่อง)
- ไฟล์ `data/gateway.db`, `data/audio_cache/`, `data/logs/` mount เป็น volume ไว้แล้ว ข้อมูลจะไม่หายตอน container update



- ห้าม hardcode พาสเวิร์ด/เบอร์โทร/token ลงโค้ด — ใช้ `.env` เท่านั้น (ถูก block ใน `.gitignore`)
- ติดตั้ง pre-commit hook เพื่อสแกนหาความลับก่อน commit ทุกครั้ง:
  ```bash
  pip install -r requirements-dev.txt --break-system-packages
  pre-commit install
  ```

## 🌿 Branches

| Branch | สโคป |
|---|---|
| `main` | SIM ตัวเดียว, GSM only, เรียบง่ายที่สุด (branch นี้) |
| `feature/voip-multi-sim` | เพิ่ม VoIP (Asterisk+Zadarma) + multi-SIM pool — เก็บไว้พัฒนาต่อในอนาคต |

## 📄 License

MIT License — ดูรายละเอียดใน [LICENSE](./LICENSE)
