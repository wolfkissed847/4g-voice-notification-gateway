#!/bin/bash
# ===================================================================
# setup_network_failover.sh
#
# ยังไม่ได้ใช้งานในดีไซน์ปัจจุบัน (ดู network_setup/README.md) — ตัดออกเพราะยังไม่ verify ว่า
# A7670C คุยสาย (voice call) พร้อมกับใช้ 4G data ได้จริงหรือไม่ (VoLTE vs CSFB) ตอนนี้ Pi ใช้ LAN
# เป็นอินเทอร์เน็ตทางเดียว ส่วนการโทรผ่าน AT command ไม่ต้องพึ่ง LAN/4G data อยู่แล้ว
#
# เก็บ script นี้ไว้เผื่อกลับมาทำต่อ ถ้าทดสอบกับฮาร์ดแวร์จริงแล้วว่ารองรับ voice+data พร้อมกัน:
# ตั้งค่า Raspberry Pi ให้ใช้ LAN (สายแลนออฟฟิศ) เป็นหลัก แล้วสลับไปใช้ 4G จากโมดูล A7670C
# อัตโนมัติเมื่อ LAN หลุด (เช่นตอนไฟดับ) ผ่าน NetworkManager (default บน Raspberry Pi OS Bookworm ขึ้นไป)
# รัน: sudo bash network_setup/setup_network_failover.sh
#
# หมายเหตุ: script นี้ตั้งค่า "ลำดับความสำคัญ" ของ connection เท่านั้น
# ไม่ได้ตั้งค่า APN ให้อัตโนมัติ — ต้องแก้ <YOUR_APN> ให้ตรงกับผู้ให้บริการ (เช่น GOMO/AIS)
# ก่อนรัน
# ===================================================================
set -e

APN="<YOUR_APN>"   # เช่น GOMO ใช้ APN ของ AIS — เช็คจากแอป/เว็บผู้ให้บริการ
LAN_CONN_NAME="Wired connection 1"
GSM_CONN_NAME="4g-failover"

echo "== ตรวจสอบว่า NetworkManager กำลังทำงานอยู่ =="
systemctl is-active --quiet NetworkManager || {
  echo "NetworkManager ไม่ได้ทำงานอยู่ — ต้องเปิดใช้งานก่อน (raspi-config > Network Config)"
  exit 1
}

echo "== ตั้ง priority ของ LAN ให้สูงสุด (ใช้ก่อนเสมอถ้ามีสาย) =="
nmcli connection modify "$LAN_CONN_NAME" connection.autoconnect-priority 100
nmcli connection modify "$LAN_CONN_NAME" connection.autoconnect yes

echo "== สร้าง connection สำหรับโมดูล 4G (ผ่าน ModemManager) =="
if nmcli connection show "$GSM_CONN_NAME" &>/dev/null; then
  echo "connection '$GSM_CONN_NAME' มีอยู่แล้ว ข้ามการสร้างใหม่"
else
  nmcli connection add type gsm ifname "*" con-name "$GSM_CONN_NAME" apn "$APN"
fi

echo "== ตั้ง priority ของ 4G ให้ต่ำกว่า LAN (ใช้เป็น fallback เท่านั้น) =="
nmcli connection modify "$GSM_CONN_NAME" connection.autoconnect-priority 10
nmcli connection modify "$GSM_CONN_NAME" connection.autoconnect yes

echo ""
echo "เสร็จแล้ว — ตรวจสอบผลด้วยคำสั่ง:"
echo "  nmcli connection show"
echo "  nmcli device status"
echo ""
echo "ทดสอบ failover: ถอดสาย LAN ออกแล้วดูว่า Pi สลับไปใช้ 4G เองไหม (nmcli device status)"
echo "หมายเหตุ: การสลับอาจใช้เวลาสองสามวินาที ระหว่างนั้น request ที่ค้างอยู่ (เช่น gTTS) อาจ timeout ได้"
