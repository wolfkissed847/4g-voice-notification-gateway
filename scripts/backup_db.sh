#!/bin/bash
# ===================================================================
# backup_db.sh — สำรองฐานข้อมูลรายวัน เก็บย้อนหลัง 7 วัน
#
# ตั้งให้รันอัตโนมัติ (ตี 3 ทุกวัน):
#   crontab -e
#   0 3 * * * /bin/bash ~/actions-runner/_work/4g-voice-notification-gateway/4g-voice-notification-gateway/scripts/backup_db.sh >> ~/backup.log 2>&1
#
# ── ทำไมไม่ใช้ cp เฉยๆ ──────────────────────────────────────────────
# ฐานข้อมูลเปิดโหมด WAL อยู่ ข้อมูลที่เพิ่งเขียนจะค้างอยู่ในไฟล์ .db-wal ยังไม่ลงไฟล์ .db
# ถ้า cp เอาแค่ไฟล์ .db จะได้ข้อมูลที่ขาดท่อนล่าสุดไป และถ้า cp ตอนกำลังเขียนพอดี
# อาจได้ไฟล์ที่พังใช้ไม่ได้เลย
#
# สคริปต์นี้ใช้ backup API ของ sqlite3 ผ่าน Python ใน container แทน
# ซึ่งอ่านแบบ "ถ่ายภาพ ณ จุดเวลาหนึ่ง" ได้อย่างถูกต้องแม้มีการเขียนพร้อมกันอยู่
# (ไม่ต้องหยุด container ไม่ต้องล็อกใคร ระบบยังโทรได้ตามปกติระหว่างสำรอง)
# ===================================================================
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="$HOME/db-backups"
KEEP_DAYS=7
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/gateway-$STAMP.db"

mkdir -p "$BACKUP_DIR"

if ! docker ps --format '{{.Names}}' | grep -qx gateway; then
  echo "[$(date '+%F %T')] ❌ ไม่พบ container 'gateway' ที่กำลังรัน — ข้ามรอบนี้"
  exit 1
fi

# สำรองไปไว้ใน /app/data ก่อน (โฟลเดอร์นี้ mount กับดิสก์ Pi อยู่แล้ว)
# แล้วค่อยย้ายออกมา — จะได้ไม่ต้อง mount อะไรเพิ่มให้ container
#
# ⚠️ ห้าม hardcode path ของไฟล์ DB — ต้องอ่านจาก DATABASE_URL ที่แอปใช้จริง
# เพราะ sqlite3.connect() กับไฟล์ที่ไม่มีอยู่จะ "สร้างไฟล์เปล่าให้" ไม่ใช่ error
# ถ้าเดา path ผิดจะได้ไฟล์สำรองที่เปิดผ่าน integrity_check ทุกอย่างดูปกติ
# แต่ข้างในว่างเปล่า — รู้ตัวอีกทีตอนต้องกู้จริงแล้วไม่มีอะไรให้กู้ (เจอมาแล้วตอนเทสรอบแรก)
docker exec gateway python -c "
import os, sqlite3, sys
url = os.environ.get('DATABASE_URL', 'sqlite:///./gateway.db')
if not url.startswith('sqlite:'):
    sys.exit('รองรับเฉพาะ sqlite — เจอ: ' + url.split(':')[0])
# sqlite:///./x.db -> ./x.db (relative กับ cwd ของแอป) | sqlite:////a/b.db -> /a/b.db
src_path = os.path.abspath(url.split('sqlite:///', 1)[1])
if not os.path.exists(src_path):
    sys.exit('ไม่พบไฟล์ฐานข้อมูลที่ ' + src_path)
src = sqlite3.connect('file:' + src_path + '?mode=ro', uri=True)   # เปิดอ่านอย่างเดียว กันเผลอสร้างไฟล์เปล่า
dst = sqlite3.connect('/app/data/_backup_tmp.db')
with dst:
    src.backup(dst)   # backup API — ได้ข้อมูลครบถึงวินาทีล่าสุดรวมส่วนที่ยังอยู่ใน WAL
tables = [r[0] for r in dst.execute(\"SELECT name FROM sqlite_master WHERE type='table'\")]
dst.close(); src.close()
if not tables:
    sys.exit('สำรองแล้วแต่ไม่มีตารางเลย — path ผิดหรือฐานข้อมูลว่าง: ' + src_path)
print('  จาก %s (%d ตาราง)' % (src_path, len(tables)))
" || { echo "[$(date '+%F %T')] ❌ สำรองไม่สำเร็จ"; rm -f "$PROJECT_DIR/data/_backup_tmp.db"; exit 1; }

mv "$PROJECT_DIR/data/_backup_tmp.db" "$OUT"
gzip -f "$OUT"

echo "[$(date '+%F %T')] ✅ สำรองแล้ว: ${OUT}.gz ($(du -h "${OUT}.gz" | cut -f1))"

# ลบไฟล์เก่ากว่า KEEP_DAYS วัน — ไม่งั้น SD card เต็มในอีกไม่กี่เดือน
deleted=$(find "$BACKUP_DIR" -name 'gateway-*.db.gz' -mtime "+$KEEP_DAYS" -print -delete | wc -l)
[ "$deleted" -gt 0 ] && echo "[$(date '+%F %T')] ลบไฟล์เก่า $deleted ไฟล์"

echo "[$(date '+%F %T')] มีสำรองทั้งหมด $(ls -1 "$BACKUP_DIR"/gateway-*.db.gz 2>/dev/null | wc -l) ไฟล์ · ใช้พื้นที่ $(du -sh "$BACKUP_DIR" | cut -f1)"

# ── วิธีกู้คืน ───────────────────────────────────────────────────────
#   cd ~/actions-runner/_work/4g-voice-notification-gateway/4g-voice-notification-gateway
#   docker compose stop gateway
#   gunzip -c ~/db-backups/gateway-<วันที่>.db.gz > data/gateway.db
#   rm -f data/gateway.db-wal data/gateway.db-shm      # ไฟล์พ่วงของตัวเก่า ต้องลบทิ้ง
#   docker compose start gateway
