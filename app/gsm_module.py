"""
GSM Module Wrapper — ควบคุม SIMCOM A7670E ผ่าน AT Command (Serial/USB)

หมายเหตุ: นี่คือโครง (scaffold) ที่ทำงานกับฮาร์ดแวร์จริงผ่านสาย USB
ต้องทดสอบ AT command set ให้ตรงกับ firmware ของโมดูลจริงก่อนใช้งาน
อ้างอิง: SIMCOM A7670E Series AT Command Manual
"""
import logging
import re
import time

import serial

from app.config import settings

logger = logging.getLogger("gsm_module")

# สถานะที่โมดูลอาจรายงานกลับมาระหว่างพยายามโทร
RING_PATTERN = re.compile(r"\+CLCC:")
NO_CARRIER = "NO CARRIER"
BUSY = "BUSY"
NO_ANSWER = "NO ANSWER"
CONNECT = "CONNECT"

CSQ_PATTERN = re.compile(r"\+CSQ:\s*(\d+),(\d+)")
COPS_PATTERN = re.compile(r'\+COPS:\s*\d+,\d+,"([^"]*)"(?:,(\d+))?')

# AT+COPS? Access Technology code -> ป้ายชื่อ network mode ที่อ่านง่าย
ACT_MODE_MAP = {
    0: "2G (GSM)", 1: "2G (GSM Compact)", 3: "2G (EGPRS)", 8: "2G (NB-IoT/EC-GSM)",
    2: "3G (UMTS)", 4: "3G (HSDPA)", 5: "3G (HSUPA)", 6: "3G (HSPA)",
    7: "4G (LTE)", 9: "4G (NB-IoT)",
}


class GSMModule:
    def __init__(self, port: str | None = None, baudrate: int | None = None):
        self.port = port or settings.gsm_serial_port
        self.baudrate = baudrate or settings.gsm_baudrate
        self.ser: serial.Serial | None = None

    def connect(self):
        self.ser = serial.Serial(self.port, self.baudrate, timeout=1)
        time.sleep(1)
        self._send_at("AT")  # health check

    def disconnect(self):
        if self.ser and self.ser.is_open:
            self.ser.close()

    def _send_at(self, command: str, wait: float = 1.0) -> str:
        """ส่ง AT command และรอผลลัพธ์กลับมา"""
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        self.ser.write((command + "\r\n").encode())
        time.sleep(wait)
        response = self.ser.read(self.ser.in_waiting or 1).decode(errors="ignore")
        logger.debug("AT> %s | Response: %s", command, response.strip())
        return response

    # ---------- Voice Call ----------

    def dial(self, phone_number: str) -> str:
        """
        โทรออกไปยังเบอร์ที่กำหนด
        คืนค่าสถานะ: 'connected' | 'busy' | 'no_answer' | 'no_carrier'
        """
        self._send_at(f"ATD{phone_number};", wait=0.5)

        elapsed = 0.0
        interval = 1.0
        timeout = settings.call_ring_timeout_seconds

        while elapsed < timeout:
            status = self._send_at("AT+CLCC", wait=interval)
            elapsed += interval

            if CONNECT in status or ",0,0," in status:  # 0 = active call
                return "connected"
            if BUSY in status:
                return "busy"
            if NO_CARRIER in status:
                return "no_answer"

        # หมดเวลารอแล้วไม่มีใครรับ
        self.hangup()
        return "no_answer"

    def hangup(self):
        self._send_at("ATH")

    def stream_audio(self, audio_file_path: str):
        """
        สตรีมไฟล์เสียงเข้าไปในสายที่เชื่อมต่ออยู่
        หมายเหตุ: A7670E รองรับคำสั่งเล่นไฟล์เสียงผ่านช่อง audio ระหว่างสนทนา
        (เช่น AT+CPCMREG / AT+CREC ขึ้นกับ firmware) — ต้องตรวจสอบ command set
        ที่ตรงกับ firmware ของโมดูลจริงที่ใช้งาน แล้วปรับ implementation ตรงนี้
        """
        logger.info("Streaming audio file: %s", audio_file_path)
        # TODO: ทดสอบและ implement คำสั่งจริงตาม firmware ของโมดูล
        # ตัวอย่างแนวทาง (ต้อง verify กับ datasheet):
        # self._send_at("AT+CPCMREG=1")
        # ... เปิด local audio pipe แล้วส่งข้อมูล PCM ของไฟล์เสียงเข้าไป
        raise NotImplementedError("ต้อง implement ตาม AT command set ของ firmware จริง")

    # ---------- Status Query (สำหรับ dashboard, ไม่เกี่ยวกับ call state machine) ----------

    def get_signal_quality(self) -> int | None:
        """คืนค่า RSSI ดิบ 0-31 ตาม AT+CSQ (0=แย่มาก, 31=ดีมาก) — None ถ้าไม่ทราบ (99) หรือ parse ไม่ได้"""
        response = self._send_at("AT+CSQ")
        match = CSQ_PATTERN.search(response)
        if not match:
            return None
        rssi = int(match.group(1))
        return rssi if rssi != 99 else None

    def get_operator_info(self) -> tuple[str | None, str | None]:
        """คืน (ชื่อ operator เช่น AIS/dtac/TrueMove, network mode เช่น '4G (LTE)') ตาม AT+COPS?"""
        response = self._send_at("AT+COPS?")
        match = COPS_PATTERN.search(response)
        if not match:
            return None, None
        operator = match.group(1) or None
        act_code = match.group(2)
        mode = ACT_MODE_MAP.get(int(act_code)) if act_code is not None else None
        return operator, mode

    # ---------- SMS Fallback ----------

    def send_sms(self, phone_number: str, text: str) -> bool:
        """ส่ง SMS แบบ text mode (ต้อง AT+CMGF=1 ก่อน)"""
        max_len = settings.sms_max_length
        if len(text) > max_len:
            text = text[: max_len - 3] + "..."

        self._send_at("AT+CMGF=1")
        self._send_at(f'AT+CMGS="{phone_number}"', wait=0.5)
        response = self._send_at(text + chr(26), wait=3.0)  # Ctrl+Z ส่งข้อความ
        return "OK" in response
