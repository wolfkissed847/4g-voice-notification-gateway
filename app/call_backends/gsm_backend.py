"""
GSM Backend Adapter — ครอบ GSMModule (AT command / SIMCOM A7670C) ให้ตรงกับ CallBackend interface
นี่คือ "แบบธรรมดา" — โทรออกผ่านซิมการ์ดจริงเหมือนมือถือทั่วไป
"""
from app.call_backends.base import CallBackend
from app.gsm_module import GSMModule


class GSMBackend(CallBackend):
    def __init__(self, serial_port: str | None = None, baudrate: int | None = None, label: str | None = None):
        # ถ้าไม่ระบุ จะใช้ค่า default เดี่ยวจาก .env (backward compatible กับตอนมี SIM ตัวเดียว)
        self._module = GSMModule(port=serial_port, baudrate=baudrate)
        self.label = label or serial_port or "gsm-default"

    @property
    def name(self) -> str:  # type: ignore[override]
        return f"gsm:{self.label}"

    def connect(self):
        self._module.connect()

    def disconnect(self):
        self._module.disconnect()

    def dial(self, phone_number: str) -> str:
        return self._module.dial(phone_number)

    def stream_audio(self, audio_file_path: str):
        self._module.stream_audio(audio_file_path)

    def hangup(self):
        self._module.hangup()

    def send_sms(self, phone_number: str, text: str) -> bool:
        return self._module.send_sms(phone_number, text)

    @property
    def supports_sms(self) -> bool:
        return True
