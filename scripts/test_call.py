"""
ทดสอบ dial → เล่นเสียง → hangup ตรงๆ กับฮาร์ดแวร์จริง โดยไม่ต้องรัน FastAPI/DB/dashboard เลย
ใช้ตอนตรวจ gsm_module.py หลังแก้ ไม่ต้องผ่าน queue/worker/login ให้ครบก่อน

ต้องมี .env ตั้ง GSM_SERIAL_PORT ให้ตรงกับพอร์ตจริงก่อนรัน (ดู README.md หัวข้อ "เชื่อมต่อฮาร์ดแวร์")

รัน: python scripts/test_call.py 0812345678
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.gsm_module import GSMModule
from app.tts_service import text_to_speech

logging.basicConfig(level=logging.DEBUG, format="%(levelname)s %(name)s: %(message)s")


def main():
    if len(sys.argv) != 2:
        print("ใช้งาน: python scripts/test_call.py <เบอร์โทร เช่น 0812345678>")
        sys.exit(1)

    phone_number = sys.argv[1]
    message = "นี่คือข้อความทดสอบระบบเกตเวย์แจ้งเตือนอัตโนมัติ ทดสอบการโทรและเล่นเสียงเข้าสาย"

    print(f"1) แปลงข้อความเป็นเสียง: {message!r}")
    audio_path = text_to_speech(message)
    print(f"   ได้ไฟล์: {audio_path}")

    gsm = GSMModule()
    print(f"2) เชื่อมต่อโมดูลที่ {gsm.port} (baud {gsm.baudrate})")
    gsm.connect()

    try:
        print(f"3) โทรออกไปที่ {phone_number} (รอตามค่า CALL_RING_TIMEOUT_SECONDS ใน .env)")
        result = gsm.dial(phone_number)
        print(f"   ผลการโทร: {result}")

        if result == "connected":
            print("4) โทรติดแล้ว — กำลังเล่นเสียงเข้าสาย...")
            try:
                gsm.stream_audio(audio_path)
                print("   เล่นเสียงจบแล้ว (ได้ +AUDIOSTATE: audio play stop)")
            except Exception as exc:
                print(f"   เล่นเสียงล้มเหลว: {exc}")
            finally:
                gsm.hangup()
                print("5) วางสายแล้ว")
        else:
            print("4) โทรไม่ติด ข้ามขั้นตอนเล่นเสียง")
    finally:
        gsm.disconnect()
        print("ปิดการเชื่อมต่อโมดูลแล้ว")


if __name__ == "__main__":
    main()
