"""
VoIP Backend — โทรออกผ่าน Asterisk Manager Interface (AMI) โดยใช้ Zadarma เป็น SIP trunk
Raspberry Pi ต่อ LAN ออฟฟิศ ไม่พึ่งอินเทอร์เน็ตจากซิม 4G สำหรับ path นี้

ข้อกำหนดเบื้องต้น (นอกโค้ด):
1. ติดตั้ง Asterisk บน Raspberry Pi (หรือเครื่องแยกในวง LAN เดียวกัน)
2. ตั้งค่า pjsip.conf ให้ trunk ไปยัง Zadarma (ดู asterisk_config/pjsip.conf.example)
3. เปิด AMI (manager.conf) และสร้าง user/secret สำหรับให้ Python เชื่อมต่อ (ห้าม hardcode ค่าจริง)
4. Dialplan (extensions.conf) ต้องมี context ที่ originate เข้ามาแล้วเรียก Playback ได้

ไฟล์เสียงจาก gTTS เป็น mp3 — Asterisk เล่นได้เฉพาะ format ที่รองรับ (แนะนำแปลงเป็น .wav/.gsm
ด้วย sox/ffmpeg ก่อน แล้ววางไว้ใน Asterisk sounds directory ที่ config ไว้ — ดู README ส่วน VoIP)
"""
import logging
import socket
import time
import uuid

from app.call_backends.base import CallBackend

logger = logging.getLogger("voip_backend")


class AMIError(Exception):
    pass


class _AMIConnection:
    """AMI client แบบง่าย: login, ส่ง action, อ่าน event/response กลับมาเป็น dict"""

    def __init__(self, host: str, port: int, username: str, secret: str):
        self.host = host
        self.port = port
        self.username = username
        self.secret = secret
        self.sock: socket.socket | None = None
        self._buffer = ""

    def connect(self):
        self.sock = socket.create_connection((self.host, self.port), timeout=5)
        self.sock.settimeout(5)
        self._read_raw()  # อ่าน banner บรรทัดแรกทิ้ง
        response = self.send_action({
            "Action": "Login",
            "Username": self.username,
            "Secret": self.secret,
        })
        if response.get("Response") != "Success":
            raise AMIError(f"AMI login ล้มเหลว: {response}")
        logger.info("AMI login สำเร็จ (%s:%s)", self.host, self.port)

    def disconnect(self):
        if self.sock:
            try:
                self.send_action({"Action": "Logoff"})
            except Exception:
                pass
            self.sock.close()
            self.sock = None

    def _read_raw(self, timeout: float = 5.0) -> str:
        """อ่านจนกว่าจะเจอ \\r\\n\\r\\n (จบ 1 packet ของ AMI)"""
        self.sock.settimeout(timeout)
        while "\r\n\r\n" not in self._buffer:
            chunk = self.sock.recv(4096).decode(errors="ignore")
            if not chunk:
                break
            self._buffer += chunk
        if "\r\n\r\n" in self._buffer:
            packet, self._buffer = self._buffer.split("\r\n\r\n", 1)
            return packet
        return self._buffer

    @staticmethod
    def _parse_packet(packet: str) -> dict:
        result = {}
        for line in packet.split("\r\n"):
            if ":" in line:
                key, value = line.split(":", 1)
                result[key.strip()] = value.strip()
        return result

    def send_action(self, fields: dict) -> dict:
        action_id = fields.get("ActionID", str(uuid.uuid4()))
        fields["ActionID"] = action_id
        payload = "".join(f"{k}: {v}\r\n" for k, v in fields.items()) + "\r\n"
        self.sock.sendall(payload.encode())
        packet = self._read_raw()
        return self._parse_packet(packet)

    def wait_for_event(self, event_name: str, action_id: str, timeout: float = 30.0) -> dict | None:
        """รอ event ที่ระบุซึ่งตรงกับ ActionID ที่เราส่งไป (ใช้เช็คสถานะสายหลัง Originate)"""
        deadline = time.time() + timeout
        while time.time() < deadline:
            remaining = max(deadline - time.time(), 0.1)
            packet = self._read_raw(timeout=remaining)
            if not packet:
                continue
            parsed = self._parse_packet(packet)
            if parsed.get("Event") == event_name and (
                action_id in parsed.get("ActionID", "") or action_id in parsed.get("Uniqueid", "")
            ):
                return parsed
        return None


class VoIPBackend(CallBackend):
    """
    โทรออกผ่าน Asterisk AMI โดยใช้ Zadarma trunk (context ที่ตั้งไว้ใน extensions.conf)
    รับค่า config ผ่าน constructor แทนอ่านจาก .env ตรงๆ เพื่อให้ dashboard เปลี่ยนค่าได้
    โดยไม่ต้องแก้ไฟล์ (ดู app/config_service.py — EffectiveConfig)

    หมายเหตุ: เวอร์ชันนี้เป็นโครงตั้งต้น — ต้องทดสอบและปรับ event/response ให้ตรงกับ
    Asterisk เวอร์ชันที่ใช้จริง (chan_pjsip event names ต่างจาก chan_sip เล็กน้อย)
    """

    name = "voip"

    def __init__(
        self,
        ami_host: str,
        ami_port: int,
        ami_username: str,
        ami_secret: str,
        trunk_name: str,
        dial_context: str,
        callerid: str,
        ring_timeout_seconds: int = 25,
    ):
        self._ami_host = ami_host
        self._ami_port = ami_port
        self._ami_username = ami_username
        self._ami_secret = ami_secret
        self._trunk_name = trunk_name
        self._dial_context = dial_context
        self._callerid = callerid
        self._ring_timeout_seconds = ring_timeout_seconds

        self._ami: _AMIConnection | None = None
        self._current_channel: str | None = None

    def connect(self):
        if not self._ami_username or not self._ami_secret:
            raise RuntimeError(
                "ยังไม่ได้ตั้งค่า AMI username/secret — ไปที่หน้า Settings ใน dashboard "
                "แล้วกรอกค่า Asterisk AMI + Zadarma trunk ก่อนเลือกใช้ backend voip"
            )
        self._ami = _AMIConnection(
            host=self._ami_host,
            port=self._ami_port,
            username=self._ami_username,
            secret=self._ami_secret,
        )
        self._ami.connect()

    def disconnect(self):
        if self._ami:
            self._ami.disconnect()
            self._ami = None

    def dial(self, phone_number: str) -> str:
        """
        Originate call ผ่าน Zadarma trunk แล้วรอผลลัพธ์
        Context/Trunk name อ้างอิงจาก asterisk_config/extensions.conf.example
        """
        action_id = str(uuid.uuid4())
        self._current_channel = f"PJSIP/{phone_number}@{self._trunk_name}"

        response = self._ami.send_action({
            "Action": "Originate",
            "ActionID": action_id,
            "Channel": self._current_channel,
            "Context": self._dial_context,
            "Exten": "s",
            "Priority": "1",
            "Timeout": str(self._ring_timeout_seconds * 1000),
            "CallerID": self._callerid,
            "Async": "true",
        })

        if response.get("Response") != "Success":
            logger.error("Originate ล้มเหลว: %s", response)
            return "no_answer"

        # รอ event ที่บอกผลลัพธ์ปลายสาย (OriginateResponse หรือ Hangup พร้อม cause code)
        result_event = self._ami.wait_for_event(
            "OriginateResponse", action_id, timeout=self._ring_timeout_seconds + 5
        )

        if not result_event:
            return "no_answer"

        reason = result_event.get("Reason", "")
        # Reason code ของ AMI: 4 = answered, อื่นๆ ดูใน Asterisk AMI docs (คร่าวๆ ต้อง verify กับ log จริง)
        if reason == "4" or result_event.get("Response") == "Success":
            return "connected"
        if "BUSY" in result_event.get("Cause-txt", "").upper():
            return "busy"
        return "no_answer"

    def stream_audio(self, audio_file_path: str):
        """
        ในทางปฏิบัติ ควรสั่งเล่นเสียงผ่าน Application=Playback ตอน Originate เลย
        (ดู dial() — สามารถปรับให้ Originate ใช้ Application/Data แทน Context/Exten ได้)
        เมธอดนี้เผื่อไว้กรณีต้องสั่งเล่นแยกทีหลังผ่าน AMI Action "Playback"/Redirect
        """
        logger.info("VoIP: สั่งเล่นไฟล์เสียง %s ผ่าน channel %s", audio_file_path, self._current_channel)
        # TODO: ต้อง convert mp3 -> wav/gsm ก่อน และวางในตำแหน่ง Asterisk sounds directory
        raise NotImplementedError("ต้องทดสอบและปรับตาม Asterisk dialplan จริง")

    def hangup(self):
        if self._current_channel:
            self._ami.send_action({
                "Action": "Hangup",
                "Channel": self._current_channel,
            })
            self._current_channel = None

    @property
    def supports_sms(self) -> bool:
        # Zadarma มี SMS API แยกต่างหาก (ไม่ผ่าน Asterisk) — ยังไม่ implement ในเวอร์ชันนี้
        return False
