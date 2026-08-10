"""
เครื่องมือวินิจฉัย "วางสายไม่ลง" — คุยกับโมดูลตรงๆ ไม่ผ่าน FastAPI/คิว/ฐานข้อมูล

ใช้เมื่อ: โทรออกแล้วปลายสายรับ แต่พอระบบเล่นเสียงจบแล้วสายไม่ตัดเอง
สคริปต์นี้จะยิงคำสั่งวางสายทีละแบบ แล้วพิมพ์คำตอบดิบของโมดูลออกมาให้เห็นทุกบรรทัด
เพื่อหาว่าคำสั่งไหนใช้ได้จริงกับเฟิร์มแวร์ตัวนี้ (แทนการเดา)

วิธีใช้ — ต้อง **ปิดเซิร์ฟเวอร์ก่อน** เพราะโมดูลเปิดได้ทีละโปรแกรม:
    python scripts/diag_hangup.py 0812345678

จะโทรออกจริง ให้รับสายแล้วถือไว้ อย่าเพิ่งกดวาง แล้วดูผลบนจอ
"""
import sys
import time

sys.path.insert(0, ".")

import serial  # noqa: E402

from app.config import settings  # noqa: E402


def send(ser: serial.Serial, cmd: str, wait: float = 1.0) -> str:
    ser.write((cmd + "\r\n").encode())
    time.sleep(wait)
    resp = ser.read(ser.in_waiting or 1).decode(errors="ignore")
    print(f"  >>> {cmd}")
    print(f"  <<< {resp.strip()!r}")
    return resp


def call_active(ser: serial.Serial) -> bool:
    """ยังมีสายอยู่ไหม — ดูจากบรรทัด +CLCC: ที่จะมีเฉพาะตอนมีสาย"""
    ser.reset_input_buffer()
    return "+CLCC:" in send(ser, "AT+CLCC", wait=1.0)


def main() -> int:
    if len(sys.argv) < 2:
        print("ใช้: python scripts/diag_hangup.py <เบอร์โทร>")
        return 2
    number = sys.argv[1]

    print(f"เปิดพอร์ต {settings.gsm_serial_port} @ {settings.gsm_baudrate}")
    ser = serial.Serial(settings.gsm_serial_port, settings.gsm_baudrate, timeout=1)
    time.sleep(1)
    ser.reset_input_buffer()

    try:
        print("\n[1] เช็คว่าโมดูลตอบสนอง")
        send(ser, "AT", wait=0.5)

        print("\n[2] เช็คว่ามีสายค้างอยู่ก่อนเริ่มไหม")
        if call_active(ser):
            print("  ** มีสายค้างอยู่ก่อนแล้ว — เคลียร์ก่อน **")
            send(ser, "AT+CHUP", wait=1.0)

        print(f"\n[3] โทรออกไปที่ {number} — กรุณารับสายแล้วถือไว้ อย่ากดวาง")
        ser.reset_input_buffer()
        send(ser, f"ATD{number};", wait=1.0)

        print("\n[4] รอให้รับสาย (สูงสุด 30 วิ)")
        answered = False
        for i in range(30):
            r = send(ser, "AT+CLCC", wait=1.0)
            if "VOICE CALL: BEGIN" in r or ",0,0," in r:
                answered = True
                print(f"  ** รับสายแล้วที่วินาทีที่ {i + 1} **")
                break
            if "NO CARRIER" in r or "BUSY" in r:
                print("  ** สายจบไปก่อน (ไม่รับ/ปฏิเสธ) — ทดสอบต่อไม่ได้ **")
                return 1
        if not answered:
            print("  ** ไม่มีใครรับสาย — ทดสอบต่อไม่ได้ **")
            send(ser, "AT+CHUP", wait=1.0)
            return 1

        print("\n[5] ถือสายไว้ 3 วิ แล้วเริ่มทดสอบคำสั่งวางสายทีละแบบ")
        time.sleep(3)

        # ไล่ทีละคำสั่ง หยุดทันทีที่สายจบ — คำสั่งที่ทำให้จบคือคำตอบที่เราต้องการ
        # เรียงจากตรงจุดที่สุดไปแรงที่สุด ตัวสุดท้ายคือปิดคลื่นวิทยุซึ่งตัดสายได้แน่นอน
        # (AT+CVHU=0 เองไม่ได้วางสาย แต่เป็นตัวเปิดให้ ATH บรรทัดถัดไปทำงานได้จริง)
        for cmd in ("AT+CHUP", "AT+CVHU=0", "ATH", "AT+CCMXSTOP", "AT+CHUP", "AT+CFUN=4"):
            print(f"\n[6] ลอง {cmd}")
            send(ser, cmd, wait=1.5)
            if not call_active(ser):
                print(f"\n{'=' * 60}")
                print(f"  ✅ สายจบแล้วด้วยคำสั่ง: {cmd}")
                print(f"{'=' * 60}")
                if cmd == "AT+CFUN=4":
                    print("  (ปิดคลื่นวิทยุอยู่ — เปิดกลับให้แล้ว)")
                    send(ser, "AT+CFUN=1", wait=3.0)
                return 0

        print(f"\n{'=' * 60}")
        print("  ❌ ลองครบทุกคำสั่งแล้วสายยังไม่จบ")
        print("  กรุณาก็อปผลทั้งหมดข้างบนนี้ส่งให้ผู้พัฒนา")
        print(f"{'=' * 60}")
        return 1
    finally:
        ser.close()
        print("\nปิดพอร์ตแล้ว")


if __name__ == "__main__":
    raise SystemExit(main())
