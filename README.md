# 4G Automated Voice Notification Gateway

**ภาษาไทย:** การออกแบบและพัฒนาระบบเกตเวย์โทรแจ้งเตือนด้วยข้อความเสียงอัตโนมัติผ่านเครือข่าย 4G
**English:** Design and Development of an Automated Voice Notification Gateway Server over 4G Network

## 📌 Project Goal

ระบบ Robo-calling Gateway ขนาดเล็ก ทำงานแบบ Self-hosted (On-Premise) ภายในองค์กร ใช้สำหรับโทรแจ้งเตือนเจ้าหน้าที่ไอที/ทีมช่างโดยอัตโนมัติเมื่อเกิดเหตุฉุกเฉิน (เช่น เซิร์ฟเวอร์ล่ม, ไฟดับ)

โปรเจคนี้ทดลองเปรียบเทียบ **2 แนวทาง** สำหรับโทรออก (สลับได้ผ่าน `.env` ด้วยตัวแปร `CALL_BACKEND`):

| Backend | วิธีการ | Use case |
|---|---|---|
| `gsm` (ธรรมดา) | SIMCOM A7670C หมุนเบอร์ผ่านซิมจริง ด้วย AT command | ไม่ต้องพึ่งเน็ตออฟฟิศ, ทำงานได้แม้ไฟดับ/เน็ตล่ม (มีแบตสำรอง) |
| `voip` | Raspberry Pi ต่อ LAN ออฟฟิศ → Asterisk (PBX) → Zadarma SIP trunk | เปรียบเทียบต้นทุน/คุณภาพเสียง/ความหน่วงสำหรับบทวิเคราะห์ในรูปเล่ม |

## 🏗️ Hardware Architecture

| Component | Detail |
|---|---|
| Controller | Raspberry Pi (API Server + Queue Manager + Asterisk PBX) |
| GSM/4G Module | SIMCOM A7670E/A7670C (4G LTE Cat1, VoLTE, USB, AT Command) — ใช้ backend `gsm` |
| SIM Card | GOMO (AIS network), Data 10GB + Voice pay-per-minute + SMS top-up pack |
| VoIP Trunk | Zadarma SIP trunk ผ่าน Asterisk บน Pi — ใช้ backend `voip` ผ่าน LAN ออฟฟิศ |

## 🧩 System Architecture

```
┌─────────────┐      HTTP POST /notify      ┌──────────────────┐
│ Monitoring  │ ──────────────────────────▶ │  FastAPI Server  │
│ System      │                             │  (Raspberry Pi)  │
└─────────────┘                             └────────┬─────────┘
                                                       │ enqueue
                                                       ▼
                                             ┌──────────────────┐
                                             │  SQLite Queue    │
                                             │  (FIFO)          │
                                             └────────┬─────────┘
                                                       │ dequeue (1-by-1)
                                                       ▼
                                             ┌──────────────────┐
                                             │  Call Worker     │
                                             │  (background)    │
                                             └────────┬─────────┘
                                                       │ AT Commands
                                                       ▼
                                             ┌──────────────────┐
                                             │ SIMCOM A7670E     │
                                             │ (USB Serial)      │
                                             └──────────────────┘
                                                       │
                                      Connected ───────┼─────── No Answer / Busy
                                          │                            │
                                          ▼                            ▼
                                 Stream gTTS audio            Retry → Escalate → SMS Fallback
```

## 📂 Project Structure

```
4g-voice-notification-gateway/
├── app/
│   ├── main.py            # FastAPI entrypoint + API routes
│   ├── config.py          # โหลดค่าคอนฟิกจาก .env (รวม backend selector)
│   ├── database.py        # SQLite models (SQLAlchemy) - queue, contacts, call logs
│   ├── schemas.py         # Pydantic request/response models
│   ├── queue_manager.py   # FIFO queue logic (enqueue/dequeue)
│   ├── gsm_module.py      # AT Command wrapper สำหรับ SIMCOM A7670E/A7670C
│   ├── tts_service.py     # gTTS wrapper: text → mp3 (ภาษาไทย)
│   ├── call_worker.py     # Background worker: call state machine + retry/escalation/SMS fallback
│   └── call_backends/     # Interface กลาง + adapter สำหรับ GSM และ VoIP
│       ├── base.py            # CallBackend abstract interface
│       ├── gsm_backend.py      # adapter ครอบ gsm_module.py (แบบธรรมดา)
│       ├── voip_backend.py     # Asterisk AMI + Zadarma trunk (แบบ VoIP)
│       └── __init__.py         # get_call_backend() factory ตาม .env
├── asterisk_config/       # Template config Asterisk (.example เท่านั้น - ตัวจริง gitignored)
├── audio_cache/           # ไฟล์เสียงที่ gTTS สร้าง (gitignored)
├── logs/                  # log การโทร/สถานะ (gitignored)
├── tests/                 # unit tests
├── .env.example
├── .gitignore
├── .pre-commit-config.yaml
├── .gitleaks.toml
├── requirements.txt
├── requirements-dev.txt
├── LICENSE                # MIT
└── README.md
```

## ⚙️ Setup

```bash
git clone https://github.com/<your-username>/4g-voice-notification-gateway.git
cd 4g-voice-notification-gateway
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # แล้วแก้ค่าจริงใน .env (ห้าม commit ไฟล์นี้)
```

### เชื่อมต่อฮาร์ดแวร์
1. เสียบซิม GOMO (AIS) เข้าโมดูล A7670E
2. ต่อโมดูลเข้า Raspberry Pi ผ่านสาย USB
3. เช็ค serial port: `ls /dev/ttyUSB*` แล้วใส่ path ที่ถูกต้องใน `.env` (`GSM_SERIAL_PORT`)
4. ทดสอบโมดูลด้วย `AT` command ผ่าน `minicom` หรือ `screen` ก่อนรันระบบจริง

### รันเซิร์ฟเวอร์
```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

## 📡 API Usage

### แจ้งเตือนฉุกเฉิน (เข้าคิวโทร)
```bash
curl -X POST http://localhost:8000/notify \
  -H "Content-Type: application/json" \
  -d '{
    "message": "เซิร์ฟเวอร์หลักล่ม กรุณาตรวจสอบด่วน",
    "priority_group": "network_team"
  }'
```

### เช็คสถานะคิว
```bash
curl http://localhost:8000/queue/status
```

## 🔁 Call Logic Summary

- **Connected** → สตรีมไฟล์เสียง gTTS (ภาษาไทย) เข้าสาย
- **No Answer / Busy** →
  1. Retry ตามจำนวนรอบ + ระยะเวลาที่ตั้งไว้ (`.env`)
  2. Escalation Chain → โทรหาเบอร์ลำดับถัดไปในกลุ่มเดียวกัน
  3. ถ้ายังไม่สำเร็จ → ส่ง SMS สรุปเหตุการณ์ (≤70 ตัวอักษร, EN+TH ปนกัน)

## 🎙️ VoIP Setup (Asterisk + Zadarma)

1. ติดตั้ง Asterisk บน Raspberry Pi (หรือเครื่องแยกในวง LAN เดียวกัน):
   ```bash
   sudo apt install asterisk
   ```
2. คัดลอก template จาก `asterisk_config/*.example` ไปเป็นไฟล์จริงใน `/etc/asterisk/`:
   ```bash
   sudo cp asterisk_config/pjsip.conf.example /etc/asterisk/pjsip.conf
   sudo cp asterisk_config/extensions.conf.example /etc/asterisk/extensions.conf
   sudo cp asterisk_config/manager.conf.example /etc/asterisk/manager.conf
   ```
3. แก้ค่า `<ZADARMA_SIP_USERNAME>`, `<ZADARMA_SIP_PASSWORD>`, `<AMI_USERNAME>`, `<AMI_SECRET>` ในไฟล์จริงที่คัดลอกไป — **ห้าม commit ไฟล์เหล่านี้** (อยู่ใน `.gitignore` แล้ว)
4. Restart Asterisk: `sudo systemctl restart asterisk`
5. ตั้ง `.env`: `CALL_BACKEND=voip` พร้อมค่า AMI/Zadarma ให้ตรงกับที่ตั้งไว้
6. แปลงไฟล์เสียง gTTS (mp3) เป็น format ที่ Asterisk เล่นได้ก่อนใช้งานจริง (เช่นผ่าน `sox`/`ffmpeg` เป็น `.wav` หรือ `.gsm`) — ดู TODO ใน `app/call_backends/voip_backend.py`

## 🔒 Security Notes

- ห้าม hardcode พาสเวิร์ด/เบอร์โทร/token/SIP credential ลงโค้ด — ใช้ `.env` และ `asterisk_config/*.conf` (ตัวจริง) เท่านั้น ซึ่งทั้งคู่ถูก block ใน `.gitignore`
- ใช้ `.env.example` และ `asterisk_config/*.example` เป็นแม่แบบให้ผู้อื่น setup
- ติดตั้ง pre-commit hook เพื่อสแกนหาความลับก่อน commit ทุกครั้ง (กันมือลั่น commit ค่าจริงหลุดขึ้น GitHub):
  ```bash
  pip install -r requirements-dev.txt --break-system-packages
  pre-commit install
  ```
  หลังจากนี้ทุกครั้งที่ `git commit` จะรัน [gitleaks](https://github.com/gitleaks/gitleaks) สแกนอัตโนมัติ ถ้าเจอ pattern ที่คล้าย secret จะ block การ commit ทันที
- แนะนำรัน `pre-commit run --all-files` อย่างน้อย 1 ครั้งหลัง clone repo ก่อนเริ่ม commit ใดๆ



## 📄 License

MIT License — ดูรายละเอียดใน [LICENSE](./LICENSE)
