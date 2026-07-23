# ติดตั้ง GitHub Actions Self-Hosted Runner บน Raspberry Pi

Runner ตัวนี้คือสิ่งที่ทำให้ "push แล้ว Pi build+deploy ให้เอง" เกิดขึ้นจริง — เป็นโปรแกรมเล็กๆ
ที่รันอยู่บน Pi ตลอดเวลา คอยรอสัญญาณจาก GitHub ว่ามีการ push เข้ามา แล้วจะรันขั้นตอนใน
`.github/workflows/deploy.yml` (checkout โค้ด, build image, restart container) **บน Pi เอง**

## ขั้นตอนติดตั้ง (ทำครั้งเดียว)

1. เข้า repo บน GitHub → **Settings** → **Actions** → **Runners** → **New self-hosted runner**
2. เลือก OS: **Linux**, Architecture: **ARM** (Pi 3 เป็น 32-bit) หรือ **ARM64** (ถ้าลง Raspberry Pi OS 64-bit)
3. คัดลอกคำสั่งที่ GitHub แสดงมารันบน Pi ตามลำดับ (หน้าตาประมาณนี้ — **ใช้ token จริงที่ GitHub ให้ ไม่ใช่ตัวอย่างนี้**):

   ```bash
   mkdir actions-runner && cd actions-runner
   curl -o actions-runner-linux-arm-2.XXX.X.tar.gz -L https://github.com/actions/runner/releases/download/vX.XXX.X/actions-runner-linux-arm-2.XXX.X.tar.gz
   tar xzf ./actions-runner-linux-arm-2.XXX.X.tar.gz
   ./config.sh --url https://github.com/<your-username>/4g-voice-notification-gateway --token <TOKEN_จาก_GitHub>
   ```

4. ตอน `config.sh` ถามชื่อ label เพิ่ม ให้ใส่ **`raspberry-pi`** (ให้ตรงกับที่ `deploy.yml` ระบุไว้
   ว่า `runs-on: [self-hosted, raspberry-pi]`)

5. ติดตั้งเป็น **systemd service** เพื่อให้รันอยู่ตลอดแม้ Pi reboot:

   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

6. เช็คสถานะ:
   ```bash
   sudo ./svc.sh status
   ```
   ควรเห็น `active (running)` — ถ้าเห็นแบบนี้แล้วกลับไปดูหน้า Settings → Actions → Runners
   บน GitHub จะเห็น runner ขึ้นสถานะ **Idle** (สีเขียว) แปลว่าพร้อมรับงานแล้ว

## ทดสอบ

Push commit อะไรก็ได้ขึ้น branch `main` แล้วไปดูที่แท็บ **Actions** บน GitHub — จะเห็น workflow
`Build and Deploy on Pi` เริ่มรัน (สังเกตว่า runner icon จะเป็นเครื่องหมายคอมพิวเตอร์ ไม่ใช่ก้อนเมฆ
เพราะรันบนเครื่องเราเอง ไม่ใช่ cloud ของ GitHub)

## ข้อควรรู้

- **Build ครั้งแรกช้าที่สุด** (~10-20 นาที ขึ้นกับว่ามี wheel สำเร็จรูปจาก piwheels ให้ใช้ไหม) —
  ครั้งต่อไป Docker layer cache จะช่วยให้เร็วขึ้นมากถ้าไม่ได้แก้ `requirements.txt`/`package.json`
- **RAM ระหว่าง build**: ถ้า Pi มีแค่ 1GB RAM แนะนำเปิด swap ไว้ด้วย (`sudo dphys-swapfile swapon`)
  กัน process ถูก OOM-kill ตอน `npm install`/`vite build` ซึ่งกินแรมพุ่งช่วงสั้นๆ
- **ความปลอดภัย**: self-hosted runner จะรันโค้ดจาก repo นี้โดยตรงบนเครื่องจริง — ถ้า repo เป็น
  public และเปิดให้คนอื่น fork+PR ได้ ต้องระวังเรื่อง PR ที่มาจากคนนอกรัน workflow บนเครื่องเราได้
  (ตั้งค่า "Require approval for first-time contributors" ใน Settings → Actions → General ไว้ด้วย)
- **Uninstall runner** (ถ้าต้องการยกเลิก): `sudo ./svc.sh stop && sudo ./svc.sh uninstall`
  แล้วลบ runner ออกจากหน้า Settings → Actions → Runners บน GitHub ด้วย
