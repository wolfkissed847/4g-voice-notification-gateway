#!/bin/bash
# ===================================================================
# fix_usb0_conflict.sh
#
# แก้ปัญหา "เสียบ USB โมดูล 4G แล้ว SSH หลุด / วง IP ชนกับ Wi-Fi"
# รัน: sudo bash network_setup/fix_usb0_conflict.sh
#
# ── ปัญหา ──────────────────────────────────────────────────────────
# บอร์ด A7670E ไม่ได้เป็นแค่พอร์ต Serial — พอเสียบ USB มันจะจำลองตัวเองเป็น
# "การ์ดแลนใบใหม่" (usb0) ขึ้นมาด้วย แล้วแจก IP วง 192.168.1.x ซึ่งชนกับวงเดียวกับ
# Wi-Fi ในบ้าน/ออฟฟิศพอดี เกิดผลเสีย 2 อย่างพร้อมกัน:
#   1. Linux เห็นว่า USB เสถียรกว่า Wi-Fi เลยตั้ง metric ให้สูงกว่า → ย้ายเส้นทางหลัก
#      ไปออก usb0 → เครื่องที่ SSH อยู่ผ่าน Wi-Fi คุยต่อไม่ได้ → SSH ค้าง
#   2. สองอินเทอร์เฟซอยู่วง 192.168.1.x เหมือนกัน → routing ตีกันมั่ว
#
# ── ทำไมเลือก "ปิด usb0" แทนที่จะย้ายวง IP ────────────────────────────
# โปรเจกต์นี้ใช้โมดูล 4G "โทรออกอย่างเดียว" ผ่านพอร์ต Serial (/dev/ttyUSB2)
# ส่วนอินเทอร์เน็ตของ Pi มาจาก Wi-Fi (ต้องใช้ต่อเน็ตเพื่อเรียก gTTS แปลงข้อความเป็นเสียง)
# แปลว่า "การ์ดแลนจำลอง" ตัวนี้ไม่ได้ถูกใช้เลยแม้แต่นิดเดียว
#
# การย้ายวง IP ไป 192.168.8.x แก้ได้แค่ข้อ 2 — ข้อ 1 ยังอยู่ เพราะ usb0 ก็ยังแย่ง
# เป็นเส้นทางหลักได้อยู่ดี (แค่ไม่ชนวงเฉยๆ) การปิดทิ้งไปเลยจึงแก้ที่ต้นเหตุทั้งสองข้อ
# และไม่ต้องพึ่ง AT command ที่ยังไม่ได้ verify กับบอร์ดตัวนี้
#
# พอร์ต Serial (/dev/ttyUSB*) ไม่กระทบเลย เป็นคนละส่วนกับการ์ดแลนจำลอง
# ===================================================================
set -euo pipefail

NM_CONF="/etc/NetworkManager/conf.d/99-usb-modem-unmanaged.conf"

if [ "$(id -u)" -ne 0 ]; then
  echo "❌ ต้องรันด้วย sudo: sudo bash $0"
  exit 1
fi

# ── 1. หาว่าอินเทอร์เฟซไหนคือ "การ์ดแลนจำลอง" ของโมดูล ────────────────
# ดูจาก driver ไม่ใช่ดูจากชื่อ เพราะชื่อไม่แน่นอน (usb0 บ้าง enx<mac> บ้าง
# แล้วแต่ว่า udev ตั้งชื่อแบบไหน) แต่ driver ของ USB ethernet gadget มีไม่กี่ตัว
MODEM_IFS=()
for path in /sys/class/net/*; do
  iface="$(basename "$path")"
  [ "$iface" = "lo" ] && continue
  driver="$(basename "$(readlink -f "$path/device/driver" 2>/dev/null || echo none)")"
  case "$driver" in
    cdc_ether|rndis_host|cdc_ncm|cdc_mbim|usbnet)
      MODEM_IFS+=("$iface")
      echo "🔎 เจอการ์ดแลนจำลองของโมดูล: $iface (driver: $driver)"
      ;;
  esac
done

if [ ${#MODEM_IFS[@]} -eq 0 ]; then
  echo "ℹ️  ไม่พบการ์ดแลนจำลองของโมดูล — อาจยังไม่ได้เสียบ USB หรือแก้ไปแล้ว"
  echo "    เสียบสาย USB แล้วรันใหม่อีกครั้งได้"
  exit 0
fi

# ── 2. กันตัดขาตัวเอง ────────────────────────────────────────────────
# ถ้า SSH ที่ใช้อยู่ตอนนี้วิ่งเข้ามาทางอินเทอร์เฟซที่กำลังจะปิด การปิดมันคือ
# การตัดสายที่ตัวเองนั่งอยู่ ต้องหยุดก่อนแล้วให้คนไปต่อ Wi-Fi/จอตรงก่อน
if [ -n "${SSH_CONNECTION:-}" ]; then
  server_ip="$(echo "$SSH_CONNECTION" | awk '{print $3}')"
  for iface in "${MODEM_IFS[@]}"; do
    if ip -4 addr show dev "$iface" 2>/dev/null | grep -qw "$server_ip"; then
      echo "❌ หยุดก่อน — ตอนนี้คุณ SSH เข้ามาทาง $iface ($server_ip) ซึ่งเป็นตัวที่จะถูกปิด"
      echo "   ปิดไปจะหลุดทันทีและต่อกลับไม่ได้"
      echo "   ให้ SSH เข้ามาใหม่ผ่าน IP ของ Wi-Fi ก่อน แล้วค่อยรันสคริปต์นี้อีกครั้ง"
      exit 1
    fi
  done
fi

# ── 3. บอก NetworkManager ว่าอย่าไปยุ่งกับอินเทอร์เฟซพวกนี้ ─────────────
# unmanaged = NM จะไม่ขอ IP ให้ ไม่สร้าง route ให้ → หมดปัญหาทั้งวง IP ชนและแย่ง default route
# วิธีนี้อยู่ถาวรข้ามรีบูตและข้ามการถอด-เสียบสายเอง ไม่ต้องรันซ้ำ
{
  echo "# สร้างโดย network_setup/fix_usb0_conflict.sh"
  echo "# ไม่ให้ NetworkManager จัดการการ์ดแลนจำลองของโมดูล 4G"
  echo "# (โปรเจกต์นี้ใช้โมดูลผ่านพอร์ต Serial อย่างเดียว ไม่ได้ใช้เป็นเน็ตเวิร์ก)"
  echo "[keyfile]"
  printf 'unmanaged-devices='
  printf 'interface-name:%s;' "${MODEM_IFS[@]}"
  echo ""
} > "$NM_CONF"

echo "✅ เขียนคอนฟิกแล้ว: $NM_CONF"

# ── 4. dhcpcd (Raspberry Pi OS รุ่นเก่ากว่า Bookworm) ─────────────────
# บางเครื่องยังใช้ dhcpcd แทน NetworkManager ถ้าไม่กันตรงนี้ด้วย dhcpcd จะไปขอ IP
# ให้ usb0 เองอยู่ดี แม้ NM จะปล่อยมือแล้ว
if systemctl is-active --quiet dhcpcd 2>/dev/null; then
  for iface in "${MODEM_IFS[@]}"; do
    if ! grep -q "^denyinterfaces .*${iface}" /etc/dhcpcd.conf 2>/dev/null; then
      echo "denyinterfaces ${iface}" >> /etc/dhcpcd.conf
      echo "✅ เพิ่ม denyinterfaces $iface ใน /etc/dhcpcd.conf"
    fi
  done
  systemctl restart dhcpcd
fi

# ── 5. เอาผลไปใช้ทันที ไม่ต้องรีบูต ──────────────────────────────────
systemctl reload NetworkManager 2>/dev/null || systemctl restart NetworkManager

for iface in "${MODEM_IFS[@]}"; do
  ip addr flush dev "$iface" 2>/dev/null || true
  ip link set "$iface" down 2>/dev/null || true
  echo "✅ ปิด $iface และล้าง IP ออกแล้ว"
done

sleep 2

# ── 6. ตรวจผล ───────────────────────────────────────────────────────
echo ""
echo "══════════════════ ผลลัพธ์ ══════════════════"
echo "เส้นทางออกอินเทอร์เน็ต (บรรทัดบนสุดคือตัวที่ใช้จริง):"
ip route | grep '^default' || echo "  ⚠️ ไม่มี default route!"
echo ""
echo "IP ของแต่ละอินเทอร์เฟซ:"
ip -4 -brief addr show | grep -v '^lo'
echo ""

if ip route | grep '^default' | head -1 | grep -qE 'wlan0|eth0'; then
  echo "✅ เรียบร้อย — เส้นทางหลักออกทาง Wi-Fi/LAN ตามที่ควรเป็น"
  echo "   เสียบ USB ทิ้งไว้ได้เลย SSH จะไม่หลุดอีก"
else
  echo "⚠️ เส้นทางหลักยังไม่ใช่ wlan0/eth0 — ดูบรรทัด default ข้างบนว่าออกทางไหน"
fi

echo ""
echo "พอร์ต Serial ที่โปรเจกต์ใช้ (ไม่ได้รับผลกระทบจากสคริปต์นี้):"
ls -l /dev/ttyUSB* 2>/dev/null || echo "  ⚠️ ไม่เจอ /dev/ttyUSB* — เช็คว่าเสียบ USB อยู่ไหม"
echo ""
echo "ถ้าอยากย้อนกลับ: sudo rm $NM_CONF && sudo systemctl restart NetworkManager"
