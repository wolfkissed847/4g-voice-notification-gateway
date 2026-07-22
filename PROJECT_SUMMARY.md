# สรุปโปรเจค: 4G Automated Voice Notification Gateway

## ชื่อโครงงาน

- **ภาษาไทย:** การออกแบบและพัฒนาระบบเกตเวย์โทรแจ้งเตือนด้วยข้อความเสียงอัตโนมัติผ่านเครือข่าย 4G
- **English:** Design and Development of an Automated Voice Notification Gateway Server over 4G Network

## 1. หลักการทำงาน

ระบบ Robo-calling Gateway แบบ Self-hosted (On-Premise) สำหรับโทรแจ้งเตือนเจ้าหน้าที่ไอที/ทีมช่างอัตโนมัติเมื่อเกิดเหตุฉุกเฉิน (เซิร์ฟเวอร์ล่ม, ไฟดับ) โดยไม่ต้องพึ่งพา Cloud Call Center

| ความสามารถ | รายละเอียด |
|---|---|
| API แจ้งเตือน | ระบบภายนอกยิง `POST /notify` เพื่อสั่งโทรแจ้งเตือน |
| คิวโทร | FIFO Queue (SQLite) — จัดการงานโทรหลายรายการพร้อมกัน |
| Dashboard | Config ผ่านเว็บ (Next.js + twind) — ไม่ต้องแก้ `.env`/SSH เข้าเครื่อง |
| Login | Single-user (JWT) |
| Multi-SIM | เพิ่ม SIMCOM ได้หลายตัว เพื่อเพิ่ม capacity โทรพร้อมกัน |
| 2 ช่องทางโทร | **GSM** (ซิมจริง) และ **VoIP** (Asterisk + Zadarma) สลับได้จาก dashboard |

## 2. Hardware / Software Stack

| ประเภท | รายการ |
|---|---|
| Controller | Raspberry Pi |
| GSM Module | SIMCOM A7670C (4G LTE Cat1, AT Command, รองรับหลายตัว) |
| VoIP | Asterisk (PBX) + Zadarma SIP Trunk (ผ่าน LAN ออฟฟิศ) |
| Backend | FastAPI (Python), SQLite, SQLAlchemy |
| Frontend | Next.js + twind (แผนถัดไป) |
| Deployment | Docker (แผนถัดไป) |

## 3. สถาปัตยกรรมหลัก

ระบบแยกเป็น 4 ชั้น ทำงานอิสระต่อกัน:

1. **API Layer** (`main.py`) — รับ request, auth, CRUD device/config
2. **Queue Layer** (`queue_manager.py`) — FIFO + atomic claim กันหลาย worker แย่งงานเดียวกัน
3. **Worker Layer** (`call_worker.py`) — state machine: dial → connected/no-answer/busy → retry/escalate/SMS
4. **Backend Layer** (`call_backends/`) — abstraction กลาง ให้ GSM และ VoIP ใช้ interface เดียวกัน (`CallBackend`)

### หลักการออกแบบสำคัญ

- **Config-as-Data**: ค่าที่ผู้ใช้ทั่วไปต้องแก้ (เลือก backend, credential) ย้ายจาก `.env` เข้า Database ทั้งหมด แก้ผ่าน dashboard ได้ทันที ไม่ต้อง SSH เข้าเครื่อง
- **Secret Encryption**: credential ที่กรอกผ่าน dashboard (Zadarma/AMI) เข้ารหัสด้วย Fernet ก่อนเก็บลง DB, แสดงผลแบบ mask (`•••••r123`) เท่านั้น
- **Backend Abstraction**: `call_worker.py` ไม่รู้เลยว่ากำลังใช้ GSM หรือ VoIP — ทำให้เทียบประสิทธิภาพ 2 แบบได้โดยไม่ต้องแก้ logic คิว/retry/escalation

## 4. Call State Machine

ดูรายละเอียดใน flowchart ด้านล่าง — สรุปคือ:

- **Connected** → เล่นไฟล์เสียง gTTS (ภาษาไทย) เข้าสาย
- **No Answer / Busy** → Retry ตามรอบที่ตั้งไว้ → Escalate ไปเบอร์ถัดไป → SMS Fallback (≤70 ตัวอักษร)

## 5. ความปลอดภัย (Security)

- ห้าม hardcode credential ใดๆ ในโค้ด — ใช้ `.env` (bootstrap) + DB แบบ encrypted (runtime)
- `.env`, `*.db`, asterisk config ตัวจริง ถูก block ใน `.gitignore`
- `pre-commit` + `gitleaks` สแกนหา secret ก่อน commit ทุกครั้ง
- Auth แยก 2 ระดับ: API key (ระบบภายนอก) กับ JWT (dashboard)

## 6. สถานะปัจจุบัน / งานที่เหลือ

| งาน | สถานะ |
|---|---|
| Backend (API, Queue, GSM, VoIP skeleton, Auth, Config, Multi-SIM) | ✅ เสร็จ + ทดสอบแล้ว |
| Next.js Dashboard (login, config form, device management) | 🔲 ยังไม่ทำ |
| Docker + docker-compose | 🔲 ยังไม่ทำ |
| Hot-reload config (ไม่ต้อง restart worker) | 🔲 ยังไม่ทำ |
| ย้าย escalation contacts เข้า dashboard | 🔲 ยังไม่ทำ |
| ทดสอบกับฮาร์ดแวร์จริง (AT command set, Asterisk AMI event) | 🔲 รอฮาร์ดแวร์ |
| README quick-start + CONTRIBUTING (เตรียม open-source) | 🔲 ยังไม่ทำ |
