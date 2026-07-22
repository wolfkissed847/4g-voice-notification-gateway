"""
Call Backend Interface — ทั้ง GSM (SIM ธรรมดา) และ VoIP (Asterisk+Zadarma)
ต้อง implement ตาม interface นี้ เพื่อให้ call_worker.py สลับใช้ได้โดยไม่ต้องแก้ logic คิว/retry/escalation

ผลลัพธ์ dial() ต้องเป็นหนึ่งใน: "connected" | "busy" | "no_answer"
"""
from abc import ABC, abstractmethod


class CallBackend(ABC):
    name: str = "base"

    @abstractmethod
    def connect(self):
        """เตรียมการเชื่อมต่อ (เปิด serial port / login AMI ฯลฯ) — เรียกครั้งเดียวตอน worker start"""
        raise NotImplementedError

    @abstractmethod
    def disconnect(self):
        raise NotImplementedError

    @abstractmethod
    def dial(self, phone_number: str) -> str:
        """โทรออก คืนค่า 'connected' | 'busy' | 'no_answer'"""
        raise NotImplementedError

    @abstractmethod
    def stream_audio(self, audio_file_path: str):
        """เล่นไฟล์เสียงเข้าไปในสายที่เชื่อมต่ออยู่ (ต้องเรียกหลัง dial() คืน 'connected' เท่านั้น)"""
        raise NotImplementedError

    @abstractmethod
    def hangup(self):
        raise NotImplementedError

    def send_sms(self, phone_number: str, text: str) -> bool:
        """
        ไม่ใช่ backend ทุกตัวที่ส่ง SMS ได้ (VoIP/Zadarma ต้องใช้ SMS API แยกต่างหาก)
        ค่า default คือไม่รองรับ — backend ที่รองรับให้ override เอง
        """
        raise NotImplementedError(f"{self.name} backend ไม่รองรับการส่ง SMS")

    @property
    def supports_sms(self) -> bool:
        return False
