"""
GSM Module Wrapper — ควบคุม SIMCOM A7670E ผ่าน AT Command (Serial/USB)

ยืนยัน AT command set กับฮาร์ดแวร์จริงแล้ว (Waveshare A7670E) — dial/hangup/audio ทดสอบผ่านจริง
อ้างอิง: A76XX Series_AT Command Manual V1.09 + A7600 Series_Audio_Application_Note_V1.00
(ไฟล์ V1.03 ของ audio note ที่เคยอ้างถึงก่อนหน้านี้ Scope ผิดรุ่น — ใช้ V1.00 ตัวนี้แทน)
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
# URC เฉพาะของ SIMCOM ยืนยันด้วยฮาร์ดแวร์จริง (Waveshare A7670E) แล้วว่ายิงตอนสายรับจริง
# เดิม dial() เคยเช็ค ",0,0," ใน +CLCC เป็น fallback เพิ่มด้วย ตัดออกแล้วเพราะพิสูจน์จากการทดสอบ
# จริงว่าเช็คผิด — ",0,0," ดันไปแมตช์ตอน stat=2 (dialing ยังไม่มีใครรับสาย) เพราะจริงๆ แล้วมันคือ
# field mode,mpty ท้าย +CLCC ที่เป็น 0,0 อยู่แล้วแทบทุกสถานะของสายเดี่ยว ไม่ได้บอกว่า stat=0 (active)
# จริง — ทำให้ dial() รายงาน "connected" เร็วเกินจริงตั้งแต่ยังไม่ทันโทรติดเลย
VOICE_CALL_BEGIN = "VOICE CALL: BEGIN"

# Audio playback-to-remote (Audio Application Note หัวข้อ 3.2.2 + AT Command Manual หัวข้อ 21.2.1)
# เดาผิดมาก่อน: AT+CPCMREG และ AT+CREC (ไม่มีพารามิเตอร์) ตอบ ERROR ทั้งคู่บนฮาร์ดแวร์จริง —
# คำสั่งที่ถูกต้องคือ AT+CCMXPLAY เท่านั้น (รองรับไฟล์ amr/wav/mp3/pcm ตรงๆ ไม่ต้องแปลงก่อน)
AUDIO_PLAY_STOP = "+AUDIOSTATE: audio play stop"
# path คงที่บน filesystem ของโมดูล — เขียนทับไฟล์เดิมทุกครั้ง (ลบก่อนอัปโหลดใน _upload_file)
# กันพื้นที่เก็บของโมดูลเต็มในระยะยาวถ้าใช้ชื่อไม่ซ้ำทุกครั้ง
MODULE_AUDIO_PATH = "C:/tts.mp3"

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
        # เคลียร์ byte ค้างเก่าในบัฟเฟอร์ก่อนเริ่ม — ถ้าโมดูลเพิ่ง reset/power-cycle มา อาจมี
        # boot banner (manufacturer/model/IMEI ฯลฯ) ค้างอยู่ใน OS buffer ที่ Python ยังไม่ได้อ่าน
        # ถ้าไม่เคลียร์ก่อน byte พวกนี้จะไปปนกับ response ของคำสั่งแรกที่ส่ง ทำให้ parse ผิดได้
        # (เจอเองจากการทดสอบจริง: AT ตัวแรกได้ response เป็น banner เก่าปนมาด้วย)
        self.ser.reset_input_buffer()
        self._send_at("AT")  # health check
        # ขอให้ AT+COPS? ตอบ "ชื่อผู้ให้บริการ" แทน "รหัสตัวเลข MCC+MNC"
        # ถ้าไม่สั่งบรรทัดนี้ โมดูลจะตอบเป็นรหัสอย่าง 52003 ซึ่งผู้ใช้อ่านไม่รู้เรื่อง
        # (52003 = 520 ประเทศไทย + 03 AIS) — ให้เครือข่ายบอกชื่อมาเองดีกว่าเราเดาจากตารางรหัส
        # ที่อาจไม่ตรงหรือล้าสมัย ส่วนถ้าโมดูลไม่รองรับก็ยังตอบรหัสเดิม หน้าเว็บมีตัวแปลงสำรองอยู่
        self._send_at("AT+COPS=3,0", wait=0.3)
        # เปิดให้คำสั่ง ATH ตัดสายเสียงได้จริง
        # SIMCOM ตั้งค่าเริ่มต้นไว้ที่ AT+CVHU=1 ซึ่งแปลว่า "รับคำสั่ง ATH ไว้ ตอบ OK แต่ไม่ตัดสาย"
        # (ATH ถูกออกแบบมาสำหรับสายข้อมูลยุคโมเด็ม ไม่ใช่สายเสียง) ถ้าไม่สั่งบรรทัดนี้
        # ATH จะตอบ OK สวยงามทุกครั้งโดยไม่มีอะไรเกิดขึ้น — ซึ่งหลอกให้เข้าใจผิดว่าวางสายสำเร็จแล้ว
        self._send_at("AT+CVHU=0", wait=0.3)

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
        คืนค่าสถานะ: 'connected' | 'busy' | 'rejected' | 'no_answer'

        แยก 'rejected' ออกจาก 'no_answer' ด้วยจังหวะเวลา: ทั้งคู่จบด้วย NO CARRIER เหมือนกัน
        แต่ความหมายต่างกันมากสำหรับคนอ่านรายงาน
          - ปลายสายกดปฏิเสธ / เบอร์ติดต่อไม่ได้ → NO CARRIER กลับมา "ก่อน" หมดเวลารอ
          - ปล่อยให้ดังจนสายตัดเอง (ไม่มีใครรับ)  → วนจนครบ timeout แล้วเราสั่ง ATH เอง
        เดิมคืน 'no_answer' ทั้งสองกรณี ทำให้ประวัติการโทรบอกไม่ได้ว่าคนกดปฏิเสธหรือไม่ได้ยินสาย
        ซึ่งเป็นข้อมูลที่ต่างกันมากตอนต้องไล่ว่าทำไมแจ้งเตือนไม่ถึงคน
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")

        # ── เริ่มทุกสายจากสถานะที่รู้แน่ชัดเสมอ ────────────────────────────────
        # 1) ล้าง byte ค้างในบัฟเฟอร์ก่อน — URC จากสายก่อนหน้า (NO CARRIER, VOICE CALL: END,
        #    ERROR จากคำสั่งวางสาย) ที่ยังไม่มีใครอ่านจะถูกอ่านปนเข้ามาใน CLCC รอบแรกของสายใหม่
        #    ทำให้ตีความผิดทันที เช่นเจอ NO CARRIER ค้างแล้วสรุปว่า "ปลายสายปฏิเสธ" ทั้งที่ยังไม่ได้โทร
        # 2) ถ้ายังมีสายค้างอยู่จริง ต้องวางให้จบก่อน — โมดูลรับสายได้ทีละสาย ถ้ามีสายค้าง
        #    คำสั่ง ATD จะไม่ทำอะไรเลย แล้วเราจะวนรอจนครบ timeout แล้วสรุปผิดว่า "ไม่มีใครรับ"
        #    ทั้งที่โทรศัพท์ปลายทางไม่เคยดังเลยสักครั้ง (เจอจากการทดสอบจริง)
        self.ser.reset_input_buffer()
        if "+CLCC:" in self._query("AT+CLCC", timeout=2.0):
            logger.warning("พบสายค้างจากรอบก่อน — วางให้จบก่อนโทรใหม่")
            self.hangup()
            self.ser.reset_input_buffer()

        self._send_at(f"ATD{phone_number};", wait=0.5)

        elapsed = 0.0
        interval = 1.0
        timeout = settings.call_ring_timeout_seconds

        while elapsed < timeout:
            status = self._send_at("AT+CLCC", wait=interval)
            elapsed += interval

            if VOICE_CALL_BEGIN in status or CONNECT in status:
                return "connected"
            if BUSY in status:
                return "busy"
            if NO_CARRIER in status:
                # สายถูกตัดจากฝั่งโน้นก่อนหมดเวลารอ = ปฏิเสธ/ติดต่อไม่ได้ ไม่ใช่ "ไม่ได้ยินสาย"
                return "rejected"

        # หมดเวลารอแล้วยังไม่มีใครรับ ต้องสั่งวางเอง
        self.hangup()
        return "no_answer"

    def _call_still_active(self) -> bool:
        """
        ยังมีสายค้างอยู่ไหม — ถามโมดูลตรงๆ ด้วย AT+CLCC (มีบรรทัด "+CLCC:" = ยังมีสาย)

        ⚠️ เช็คแค่ `"+CLCC:" not in resp` ไม่พอ: ถ้าโมดูลไม่ตอบเลย resp จะเป็นสตริงว่าง
        ซึ่งก็ "ไม่มี +CLCC:" เหมือนกัน แล้วเราจะเข้าใจผิดว่าวางสายสำเร็จทั้งที่ยังไม่รู้อะไรเลย
        จึงต้องเห็น "OK" ยืนยันว่าโมดูลตอบคำถามนี้จริง — ถ้าไม่ตอบ ให้ถือว่า "ยังมีสาย" ไว้ก่อน
        เพราะการพยายามวางซ้ำโดยไม่จำเป็นไม่มีผลเสีย แต่การเชื่อผิดว่าวางแล้วทำให้คิวตายทั้งระบบ
        """
        resp = self._query("AT+CLCC", timeout=2.0)
        if "OK" not in resp:
            logger.warning("เช็คสถานะสายไม่ได้ โมดูลไม่ตอบ (%r) — ถือว่ายังมีสายค้างไว้ก่อน", resp.strip())
            return True
        return "+CLCC:" in resp

    def hangup(self):
        """
        วางสาย **แล้วยืนยันว่าสายถูกตัดจริง** ไม่ใช่สั่งแล้วเชื่อว่าสำเร็จ

        ทำไมต้องไล่หลายคำสั่ง: เฟิร์มแวร์แต่ละรุ่นรับคำสั่งวางสายไม่เหมือนกัน บางตัวตอบ OK
        กลับมาสวยงามแต่ไม่ตัดสายจริง จึงต้อง "สั่งแล้วถามกลับ" ทีละคำสั่ง แทนการยิงรัวแล้วเดาว่า
        ตัวไหนได้ผล — พอเจอตัวที่ใช้ได้จะมี log บอกชัดว่าเป็นตัวไหน ไม่ต้องมานั่งไล่ทีหลัง

        ทำไมต้องวางให้ได้จริงๆ: สายค้าง = ซิมไม่ว่าง = งานที่เหลือทั้งคิวโทรออกไม่ได้เลย
        จนกว่าจะมีคนไปกดวางที่เครื่องปลายทาง ซึ่งสำหรับระบบแจ้งเตือนคือพังทั้งระบบ
        """
        # ไล่จาก "ตรงจุดที่สุด/ผลข้างเคียงน้อยที่สุด" ไปหา "แรงขึ้นเรื่อยๆ"
        # การยิงคำสั่งที่ไม่จำเป็นไม่มีผลเสีย — สั่งวางสายตอนไม่มีสายอยู่แล้วโมดูลแค่ตอบ ERROR เฉยๆ
        steps = [
            ("AT+CHUP", "คำสั่งวางสายเฉพาะทางของ SIMCOM สำหรับสายเสียง"),
            ("ATH", "คำสั่งวางสายมาตรฐาน (ใช้ได้ต่อเมื่อ AT+CVHU=0 ซึ่งตั้งไว้ตอน connect แล้ว)"),
            # ถ้าโมดูลยังถือว่า "กำลังเล่นไฟล์เสียงเข้าสาย" อยู่ อาจไม่ยอมปล่อย resource ของสาย
            ("AT+CCMXSTOP", "ปิด session เล่นไฟล์เสียงที่อาจค้างอยู่"),
            ("AT+CHUP", "ลองวางสายซ้ำอีกครั้งหลังปิด session เสียงแล้ว"),
        ]

        for cmd, why in steps:
            # ล้างบัฟเฟอร์ก่อนทุกครั้ง — URC ที่ทยอยเข้ามาเอง (VOICE CALL: END, NO CARRIER)
            # จะไปปนกับ response ของคำสั่งถัดไปจนอ่านผลผิด ถ้าไม่เคลียร์ทิ้งก่อน
            if self.ser:
                self.ser.reset_input_buffer()
            resp = self._send_at(cmd, wait=0.5)
            logger.info("วางสาย: %s (%s) → %r", cmd, why, resp.strip())

            if not self._call_still_active():
                logger.info("สายถูกตัดเรียบร้อยด้วยคำสั่ง %s", cmd)
                return

        self._force_release_via_radio()

    def _force_release_via_radio(self):
        """ทางออกสุดท้ายของ hangup() — ตัดสายด้วยการปิด-เปิดคลื่นวิทยุ เมื่อคำสั่งวางสายทุกตัวไม่ได้ผล"""
        logger.warning("คำสั่งวางสายทุกตัวไม่ได้ผล — ตัดสายด้วยการปิด/เปิดคลื่นวิทยุแทน")
        self.restart_radio()

    def restart_radio(self, wait_register_seconds: float = 30.0) -> bool:
        """
        ปิด-เปิดภาครับส่งสัญญาณของโมดูล แล้วรอจน register เข้าเครือข่ายใหม่ — คืน True ถ้าสำเร็จ

        AT+CFUN=4 = ปิดภาครับ-ส่งสัญญาณ (เทียบเท่าโหมดเครื่องบิน) สายที่ค้างอยู่จะหลุดทันที
        เพราะลิงก์กับเสาสัญญาณหายไป · AT+CFUN=1 เปิดกลับ โมดูลจะหาเครือข่ายใหม่เอง

        ── ทำไมไม่ใช้ AT+CRESET (รีบูตโมดูลเต็มรูปแบบ) ──────────────────────────
        CRESET ทำให้โมดูลถอนตัวออกจาก USB แล้วต่อกลับเข้ามาใหม่ (re-enumerate)
        ซึ่งบนเครื่องที่รันใน Docker เป็นปัญหาใหญ่: container ได้ /dev/ttyUSB2 มาแบบผูก
        major:minor ไว้ตั้งแต่ตอนสร้าง container ถ้าโมดูลกลับมาแล้วได้เลขใหม่
        node ในนั้นจะกลายเป็นของตาย ชี้ไปยังอุปกรณ์ที่ไม่มีอยู่แล้ว
        = ต้อง recreate container ถึงจะกลับมาใช้ได้ ซึ่งกดจากหน้าเว็บไม่ได้
        กลายเป็นปุ่มที่ทำให้ระบบพังหนักกว่าเดิมและกู้เองไม่ได้

        CFUN=4/1 รีเซ็ตทุกอย่างที่เกี่ยวกับเครือข่าย (การ register, สัญญาณ, สายค้าง)
        ซึ่งครอบคลุมอาการค้างเกือบทั้งหมดที่เจอจริง โดยพอร์ต serial ไม่หลุดเลย
        """
        self._send_at("AT+CFUN=4", wait=2.0)
        time.sleep(2.0)
        self._send_at("AT+CFUN=1", wait=3.0)

        # รอให้กลับเข้าเครือข่ายก่อนคืนการควบคุม ไม่งั้นงานถัดไปในคิวจะโทรออกทันทีแล้วพลาด
        # เพราะยังไม่ register เสร็จ (AT+CREG? ตอบ ,1 = บ้านตัวเอง / ,5 = โรมมิ่ง ทั้งคู่คือพร้อมใช้)
        deadline = time.monotonic() + wait_register_seconds
        while time.monotonic() < deadline:
            reg = self._query("AT+CREG?", timeout=2.0)
            if ",1" in reg or ",5" in reg:
                logger.warning("กลับเข้าเครือข่ายแล้ว พร้อมรับงานถัดไป")
                return True
            time.sleep(2.0)

        logger.error(
            "เปิดคลื่นวิทยุกลับแล้วแต่ยังไม่ register เข้าเครือข่ายใน %s วิ — งานถัดไปอาจโทรไม่ออก",
            wait_register_seconds,
        )
        return False

    def prepare_audio(self, audio_file_path: str, on_progress=None):
        """
        อัปโหลดไฟล์เสียงเข้า filesystem ของโมดูลไว้ล่วงหน้า — **ต้องเรียกก่อน dial() เสมอ**

        ทำไมต้องแยกจากการเล่น: การอัปโหลดถูกบังคับให้ส่งทีละ 256 byte หน่วง 50ms ต่อก้อน
        (ข้อกำหนดของ SIMCOM ดู _try_cftranrx) ไฟล์เสียงราว 50KB จึงใช้เวลาราว 15-20 วินาที
        ถ้าอัปโหลดหลังจากปลายสายรับแล้ว คนรับจะได้ยินความเงียบยาวเป็นสิบวินาทีก่อนเสียงจะเริ่ม
        ซึ่งนานพอที่คนจะวางสายไปก่อนเพราะนึกว่าสายหลุด/โทรผิด

        ย้ายมาทำก่อนโทร = เสียเวลาช่วงที่ยังไม่มีใครรอฟัง พอรับสายปุ๊บได้ยินเสียงทันที
        (ตาม A76XX AT Command Manual V1.09 หัวข้อ 21.2.1 ไฟล์ที่อัปโหลดไว้ค้างอยู่ในโมดูลได้
        ไม่ต้องอัปโหลดใหม่ตอนจะเล่น)
        """
        self._upload_file(audio_file_path, MODULE_AUDIO_PATH, on_progress=on_progress)

    def play_audio(self):
        """
        เล่นไฟล์ที่ prepare_audio() อัปโหลดไว้แล้ว เข้าไปในสายที่เชื่อมต่ออยู่
        ให้ปลายสายได้ยิน (ไม่ใช่เล่นออกลำโพงของโมดูลเอง)

        AT+CCMXPLAY="<path>",1,0 — พารามิเตอร์ 1 = เล่นให้ remote ได้ยิน (0 = เล่นเองในเครื่อง)
        แล้วรอ URC "+AUDIOSTATE: audio play stop" ยืนยันว่าเล่นจบก่อนค่อย hangup (เรียกจาก caller)

        คำสั่งนี้เริ่มเล่นทันที เพราะไฟล์อยู่ในโมดูลแล้ว — ปลายสายจึงได้ยินเสียงแทบจะทันทีที่รับ
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        logger.info("เล่นเสียงเข้าสาย: %s", MODULE_AUDIO_PATH)
        self.ser.write(f'AT+CCMXPLAY="{MODULE_AUDIO_PATH}",1,0\r\n'.encode())
        # timeout ยาวหน่อยเผื่อข้อความเสียงยาว — ต้องมากกว่าความยาวเสียงจริงเสมอ
        response = self._read_until(AUDIO_PLAY_STOP, timeout=30.0)
        if "ERROR" in response or AUDIO_PLAY_STOP not in response:
            raise RuntimeError(f"AT+CCMXPLAY เล่นเสียงไม่สำเร็จหรือไม่จบใน 30 วิ: {response!r}")

    def stream_audio(self, audio_file_path: str):
        """อัปโหลด+เล่นในขั้นตอนเดียว — ใช้กับสคริปต์ทดสอบที่โทรเองทั้งกระบวนการ
        ส่วน call_worker ใช้ prepare_audio() ก่อน dial() แล้วค่อย play_audio() เพื่อไม่ให้คนรับต้องรอ"""
        self.prepare_audio(audio_file_path)
        self.play_audio()

    def _upload_file(self, local_path: str, module_path: str, on_progress=None):
        """
        อัปโหลดไฟล์เข้า filesystem ของโมดูลผ่าน AT+CFTRANRX

        ลองอัปโหลดตรงๆ ก่อนเสมอ (ไม่ลบไฟล์ล่วงหน้า) — ทดสอบกับฮาร์ดแวร์จริงแล้วพบว่า AT+FSDEL
        ที่ตอบ ERROR (ลบไฟล์ที่ไม่มีอยู่จริง) ทำให้คำสั่ง filesystem ตัวถัดไป (แม้เป็นคำสั่งที่ปกติ
        ทำงานได้) พังไปด้วย ต้อง reset โมดูลถึงจะหาย — จึงห้ามเรียก FSDEL แบบเดาสุ่มเด็ดขาด
        เรียกเฉพาะตอนอัปโหลดตรงๆ ล้มเหลวจริง (แปลว่ามีไฟล์ค้างจากรอบก่อน เช่น process เคย crash
        กลางทางโดยไม่ได้ลบไฟล์ทิ้ง) ซึ่งตอนนั้น FSDEL จะลบไฟล์ที่มีอยู่จริง ไม่ error แน่นอน
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        with open(local_path, "rb") as f:
            data = f.read()

        if self._try_cftranrx(module_path, data, on_progress=on_progress):
            return

        drive, _, filename = module_path.rpartition("/")
        self._send_at(f"AT+FSCD={drive}", wait=0.3)
        self._send_at(f"AT+FSDEL={filename}", wait=0.3)
        if not self._try_cftranrx(module_path, data, on_progress=on_progress):
            raise RuntimeError(f"อัปโหลดไฟล์เสียงเข้าโมดูลไม่สำเร็จแม้ลบไฟล์เดิมแล้ว: {module_path}")

    def _try_cftranrx(self, module_path: str, data: bytes, on_progress=None) -> bool:
        """ส่ง AT+CFTRANRX + ไฟล์ดิบ 1 ครั้ง คืน True ถ้าสำเร็จ — ไม่ raise เพราะ caller
        (_upload_file) เป็นคนตัดสินใจเองว่าจะลองใหม่หลังลบไฟล์เดิมหรือไม่

        log ทุกขั้นแบบเดียวกับ _send_at() — เดิมใช้ self.ser.write() ตรงๆ ไม่ผ่าน _send_at()
        เพราะต้องรอ '>' prompt ที่เวลาไม่แน่นอน แต่ผลคือ debug log มองไม่เห็นเลยว่า module
        ตอบอะไรกลับมาจริงๆ ตอน CFTRANRX ล้มเหลว ทำให้ดีบักปัญหาจริงยากเกินจำเป็น
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        command = f'AT+CFTRANRX="{module_path}",{len(data)}'
        self.ser.write((command + "\r\n").encode())
        prompt = self._read_until(">", timeout=5.0)
        logger.debug("AT> %s | Response: %s", command, prompt.strip())
        if ">" not in prompt:
            return False

        # AT Command Manual หัวข้อ 13.2.1 NOTE 2: "If sending file fails, increase the delay
        # time between each 256 byte reach to 50ms, and then try to send file again."
        # ส่งทีเดียวทั้งก้อน (self.ser.write(data) เฉยๆ) ทำให้โมดูลตอบ ERROR ตอนอัปโหลดจริงเสมอ
        # (รับข้อมูลไม่ทันตอนส่งรวดเดียว) — ต้องแบ่งส่งเป็นก้อนละ 256 byte หน่วง 50ms ต่อก้อนแทน
        chunk_size = 256
        chunk_delay = 0.05
        total = len(data)
        for i in range(0, total, chunk_size):
            self.ser.write(data[i : i + chunk_size])
            time.sleep(chunk_delay)
            # รายงานความคืบหน้าจริงตามจำนวน byte ที่ส่งไปแล้ว — ขั้นนี้กินเวลา 15-20 วินาที
            # ถ้าไม่รายงาน หน้าเว็บจะค้างนิ่งอยู่ขั้นเดียวนานจนดูเหมือนระบบแฮงค์
            if on_progress is not None:
                on_progress(min(1.0, (i + chunk_size) / total))

        # เวลารอ OK: ใช้เวลารวมที่เพิ่งใช้ส่งเป็นก้อนๆ ไปแล้วเป็นฐาน บวก buffer ให้โมดูลเขียนเสร็จ
        send_duration = (len(data) / chunk_size) * chunk_delay
        timeout = max(10.0, send_duration * 1.5)
        result = self._read_until("OK", timeout=timeout)
        logger.debug("AT> <%d bytes ของไฟล์เสียง ส่งเป็นก้อนละ %d byte> | Response: %s", len(data), chunk_size, result.strip())
        return "OK" in result

    def _read_until(self, needle: str, timeout: float) -> str:
        """
        อ่านจาก serial สะสมไปเรื่อยๆ จนเจอ needle, เจอ "ERROR", หรือหมดเวลา — คืน buffer ที่อ่านได้
        (เจอ "ERROR" แล้วหยุดเลยแทนที่จะรอจน timeout เต็มเวลาทุกครั้งที่ล้มเหลว)

        ใช้แทน _send_at() แบบ sleep คงที่ตอนต้องรอ URC/prompt ที่เวลาไม่แน่นอนล่วงหน้า
        (เช่น '>' prompt ตอนอัปโหลดไฟล์ที่ขนาดไม่เท่ากันทุกครั้ง, +AUDIOSTATE ตอนเล่นเสียงจบ
        ซึ่งขึ้นกับความยาวข้อความจริง) — คำสั่งสั้นๆ อื่นในไฟล์นี้ยังใช้ _send_at() ตามเดิม
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        buf = ""
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            buf += self.ser.read(self.ser.in_waiting or 1).decode(errors="ignore")
            if needle in buf or "ERROR" in buf:
                break
        return buf

    # ---------- Status Query (สำหรับ dashboard, ไม่เกี่ยวกับ call state machine) ----------

    def is_responsive(self) -> bool:
        """
        โมดูลยังตอบสนองอยู่จริงหรือไม่ — ส่ง AT เปล่าแล้วดูว่าได้ OK กลับมาไหม

        จำเป็นต้องมี เพราะ "เปิด serial port ค้างไว้ได้" ไม่ได้แปลว่าโมดูลยังเสียบอยู่:
        ถ้าถอด USB ออกกลางคัน handle เดิมยังอยู่แต่จะอ่านไม่ได้อะไรเลย (หรือ raise แล้วแต่ OS)
        ถ้าไม่เช็คตรงนี้ dashboard จะค้างแสดง "โมดูลพร้อม" ตลอดไปทั้งที่ถอดโมดูลไปแล้ว

        คืน False แทนการ raise เพราะผู้เรียกคือ status poller ที่ต้องรายงานสถานะ ไม่ใช่ล้มทั้ง worker
        """
        if not self.ser:
            return False
        try:
            return "OK" in self._query("AT", timeout=1.0)
        except Exception:
            return False

    def _query(self, command: str, timeout: float = 1.0) -> str:
        """
        ส่งคำสั่งถามค่าแล้วคืนคำตอบทันทีที่โมดูลตอบจบ (ไม่หน่วงคงที่แบบ _send_at)

        ใช้กับคำสั่ง "ถามค่า" ที่ถูกเรียกซ้ำบ่อยๆ เท่านั้น — คำสั่งที่เปลี่ยนสถานะสาย (ATD/ATH ฯลฯ)
        ยังใช้ _send_at ตามเดิม เพราะบางคำสั่งต้องเผื่อเวลาให้โมดูลทำงานจริงก่อน ไม่ใช่แค่รอข้อความตอบ
        """
        if not self.ser:
            raise RuntimeError("GSM module ยังไม่ได้ connect()")
        self.ser.reset_input_buffer()
        self.ser.write((command + "\r\n").encode())
        response = self._read_until("OK", timeout=timeout)
        logger.debug("AT> %s | Response: %s", command, response.strip())
        return response

    def get_signal_quality(self) -> int | None:
        """คืนค่า RSSI ดิบ 0-31 ตาม AT+CSQ (0=แย่มาก, 31=ดีมาก) — None ถ้าไม่ทราบ (99) หรือ parse ไม่ได้"""
        response = self._query("AT+CSQ")
        match = CSQ_PATTERN.search(response)
        if not match:
            return None
        rssi = int(match.group(1))
        return rssi if rssi != 99 else None

    def get_operator_info(self) -> tuple[str | None, str | None]:
        """คืน (ชื่อ operator เช่น AIS/dtac/TrueMove, network mode เช่น '4G (LTE)') ตาม AT+COPS?"""
        response = self._query("AT+COPS?")
        match = COPS_PATTERN.search(response)
        if not match:
            return None, None
        operator = match.group(1) or None
        act_code = match.group(2)
        mode = ACT_MODE_MAP.get(int(act_code)) if act_code is not None else None
        return operator, mode
