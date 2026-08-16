"""
คุมไฟของโมดูล 4G ผ่านขา GPIO ของ Raspberry Pi — เปิด / ปิด / รีบูตระดับฮาร์ดแวร์

ใช้ได้เฉพาะโมดูลที่ต่อผ่านหัว GPIO (UART) เท่านั้น โมดูลที่เสียบผ่าน USB ไม่มีขาพวกนี้
ให้แตะ จึงต้องปิดสวิตช์ด้วย GSM_GPIO_ENABLED=false (ค่าเริ่มต้น) แล้วทุกฟังก์ชันจะกลาย
เป็นการตอบว่า "ทำไม่ได้" อย่างสุภาพ แทนที่จะโยน exception ใส่ worker

── ทำไมถึงคุ้มที่จะมี ────────────────────────────────────────────────────────
ตอนต่อผ่าน USB ปุ่ม "รีสตาร์ทโมดูล" บนหน้าเว็บทำได้แค่ AT+CFUN=4/1 (ปิด-เปิดคลื่นวิทยุ)
เพราะ AT+CRESET ทำให้โมดูลถอนตัวออกจาก USB แล้วต่อกลับมาเป็น node ใหม่ ซึ่ง container
ตามไม่ทัน (เหตุผลเต็มอยู่ที่ gsm_module.restart_radio)

พอย้ายมาต่อ UART ข้อจำกัดนั้นหายไป ไฟล์นี้จึงทำสองอย่างที่เมื่อก่อนทำไม่ได้เลย:

  1. **ปลุกโมดูลเองเมื่อพบว่ามันดับ** — เคสหลักคือไฟดับแล้วกลับมา โมดูลตัวนี้ไม่ติดเอง
     ตอนได้ไฟ (ทดสอบแล้ว: ถอดไฟเลี้ยงแล้วเสียบใหม่ ไฟเขียวไม่ติด) ต้องมีคนกด PWRKEY
     ถ้าไม่มีใครกด ระบบจะขึ้นเขียวทุกอย่างแต่โทรไม่ออกจริงจนกว่าจะมีคนสังเกต
  2. รู้สถานะจากขา STATUS ตรงๆ ว่าโมดูล "ติดอยู่จริงไหม" แทนที่จะเดาจาก "AT ตอบไหม"
     ซึ่งแยกไม่ออกระหว่างโมดูลดับ / สายหลวม / เฟิร์มแวร์ค้าง

── ที่เคยมีแล้วถอดออก (16 ส.ค. 2569) ────────────────────────────────────────
เคยมี power_off() และ hard_reset() ด้วย ถอดออกทั้งคู่หลังทดสอบกับฮาร์ดแวร์จริง:

  ปิดโมดูล   `AT+CPOF` ปิดได้จริง แต่ปลุกกลับด้วย PWRKEY ไม่ขึ้นอีกเลย ต้องถอดไฟเลี้ยง
             หรือกดปุ่มที่ตัวเครื่อง = ปุ่มทางเดียวที่ทำให้ระบบแจ้งเตือนตายจนกว่าจะมีคนไปถึง
  รีบูตด้วย RST  ต่อสาย RST เข้าขา GPIO แล้วโมดูลไม่ยอมบูตเลย ลองสองขา (pin 15/16)
             ทั้งแบบปล่อยลอยและแบบ pull-up ได้ผลเหมือนกันหมด พอถอดสายออกบูตทันทีใน 4 วิ
             จึงเลิกใช้ขานี้ ปุ่ม "รีสตาร์ทโมดูล" ที่ใช้ AT+CFUN=4/1 ทำงานได้อยู่แล้ว
             และครอบคลุมอาการค้างเกือบทั้งหมดโดยไม่ต้องพึ่ง GPIO เลย

── กฎความปลอดภัยของขา (สำคัญที่สุดในไฟล์นี้) ─────────────────────────────────
PWRKEY กับ RESET เป็น active-low และอ้างอิงแรงดันภายในของโมดูลซึ่งอาจเป็น 1.8V
**ห้ามขับ HIGH ใส่ขาพวกนี้เด็ดขาด** — ขา 3.3V ของ Pi จะดันกระแสเข้าไปจนขาโมดูลพังได้

วิธีที่ถูกคือทำตัวเป็นสวิตช์ต่อลงกราวด์:
    กด    = ตั้งเป็น output แล้วขับ LOW  (เท่ากับต่อขานั้นลง GND เหมือนกดปุ่มบนบอร์ด)
    ปล่อย = ตั้งกลับเป็น input           (ลอย hi-Z ปล่อยให้ pull-up ในโมดูลดึงขึ้นเอง)

โค้ดในไฟล์นี้จึงไม่มีที่ไหนสั่งขับ HIGH ใส่ PWRKEY/RESET เลยแม้แต่จุดเดียว
ถ้าจะแก้ไฟล์นี้ในอนาคต ข้อนี้คือข้อที่ห้ามพลาด
"""

from __future__ import annotations

import logging
import threading
import time

from .config import settings

logger = logging.getLogger(__name__)

# ระยะเวลากดปุ่ม — วัดจากฮาร์ดแวร์จริง กด 1.5 วิ แล้ว AT ตอบภายใน 4 วินาที
PWRKEY_ON_SECONDS = 1.5    # สั้นกว่า 1 วิ โมดูลไม่ถือว่าเป็นการกด
BOOT_TIMEOUT = 25.0        # เวลารอให้ STATUS ขึ้นหลังปล่อยปุ่ม
POLL_INTERVAL = 0.5


class GsmPower:
    """
    คุมขา PWRKEY / STATUS ของโมดูล

    ปลอดภัยต่อการเรียกจากหลาย thread — worker เรียกตอนกู้โมดูลเอง ส่วน API เรียกตอน
    คนกดปุ่มบนหน้าเว็บ ทั้งคู่ผ่าน lock ตัวเดียวกัน จะได้ไม่กดปุ่มซ้อนกัน
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._lg = None          # โมดูล lgpio
        self._chip = None        # handle ของ gpiochip
        self._reason: str | None = None

        if not settings.gsm_gpio_enabled:
            self._reason = "ปิดสวิตช์ไว้ (GSM_GPIO_ENABLED=false)"
            return

        # import ตรงนี้ ไม่ใช่หัวไฟล์ — เครื่องพัฒนาที่ไม่ใช่ Pi จะได้ import โมดูลนี้ผ่าน
        try:
            import lgpio
        except Exception as exc:
            self._reason = f"ไม่มีไลบรารี lgpio ({exc})"
            logger.warning("คุมไฟโมดูลผ่าน GPIO ไม่ได้: %s", self._reason)
            return

        try:
            self._chip = lgpio.gpiochip_open(settings.gsm_gpio_chip)
            self._lg = lgpio
            # ── STATUS ต้องเปิด pull-down ภายในเสมอ ห้ามลืม ──────────────────
            # ตอนโมดูลดับ ขา STATUS ไม่ได้ถูกขับเป็น LOW แต่เป็น hi-Z (ลอย) ถ้าอ่านแบบ
            # ไม่มีแรงดึงจะได้สัญญาณรบกวนสลับ hi/lo มั่วไปเรื่อย ซึ่งแย่กว่าอ่านผิดทางเดียว
            # เพราะทำให้ระบบ "เห็นโมดูลติดๆ ดับๆ" ทั้งที่มันดับสนิทอยู่เฉยๆ
            #
            # เจอจากการทดสอบจริง: สั่งปิดโมดูลแล้วหน้าเว็บโชว์ power_on สลับไปมาทุกรอบ poll
            # และ worker เผลอข้ามขั้นตอนปลุกโมดูลตอนสตาร์ตเพราะบังเอิญอ่านได้ hi พอดี
            #
            # pull-down ทำให้ "ไม่มีใครขับ" = LOW เสมอ ส่วนตอนโมดูลติดมันขับ HIGH
            # แรงกว่าตัวต้านทานภายในมาก จึงอ่านได้ถูกทั้งสองสถานะ
            lgpio.gpio_claim_input(self._chip, settings.gsm_gpio_status, lgpio.SET_PULL_DOWN)
            logger.info(
                "คุมไฟโมดูลผ่าน GPIO พร้อมใช้งาน — PWRKEY=GPIO%s STATUS=GPIO%s",
                settings.gsm_gpio_pwrkey, settings.gsm_gpio_status,
            )
        except Exception as exc:  # pragma: no cover — ขึ้นกับฮาร์ดแวร์
            self._reason = f"เปิด gpiochip{settings.gsm_gpio_chip} ไม่ได้ ({exc})"
            logger.warning("คุมไฟโมดูลผ่าน GPIO ไม่ได้: %s", self._reason)
            self._chip = None
            self._lg = None

    # ── สถานะ ────────────────────────────────────────────────────────────────

    @property
    def available(self) -> bool:
        return self._chip is not None

    @property
    def unavailable_reason(self) -> str | None:
        return self._reason

    def is_on(self) -> bool | None:
        """
        โมดูลติดอยู่ไหม อ่านจากขา STATUS — None = ตอบไม่ได้ (ไม่ได้ต่อ GPIO ไว้)

        None ต่างจาก False ตรงที่ False แปลว่า "รู้แน่ว่าดับ" ส่วน None แปลว่า "ไม่รู้"
        หน้าเว็บต้องแยกสองอย่างนี้ ไม่งั้นเครื่องที่ไม่ได้ต่อ GPIO จะขึ้นว่าโมดูลดับตลอดเวลา
        """
        if not self.available:
            return None
        try:
            return bool(self._lg.gpio_read(self._chip, settings.gsm_gpio_status))
        except Exception:
            logger.exception("อ่านขา STATUS ไม่สำเร็จ")
            return None

    # ── การกดปุ่ม ────────────────────────────────────────────────────────────

    def _press(self, gpio: int, seconds: float) -> None:
        """
        แตะขาลง GND เป็นเวลาที่กำหนด แล้วปล่อยกลับเป็น hi-Z

        finally สำคัญมาก: ถ้ากดค้างแล้วเกิด exception ระหว่างนั้นโดยไม่ปล่อย
        ขาจะค้างอยู่ที่ LOW ตลอดไป = โมดูลถูกกดปุ่มค้าง (ถ้าเป็น RESET คือโมดูล
        ไม่มีวันบูตได้อีกเลยจนกว่าจะรีสตาร์ททั้ง container)
        """
        self._lg.gpio_claim_output(self._chip, gpio, 0)
        try:
            time.sleep(seconds)
        finally:
            try:
                self._lg.gpio_free(self._chip, gpio)
                # PWRKEY/RESET มี pull-up อยู่ในโมดูลแล้ว ปล่อยลอยได้เลย ไม่ต้องใส่แรงดึง
                self._lg.gpio_claim_input(self._chip, gpio)
            except Exception:
                logger.exception("ปล่อยขา GPIO%s กลับเป็น input ไม่สำเร็จ", gpio)

    def _wait_status(self, want: bool, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.is_on() is want:
                return True
            time.sleep(POLL_INTERVAL)
        return False

    # ── คำสั่งหลัก ───────────────────────────────────────────────────────────

    def power_on(self) -> bool:
        """
        กด PWRKEY เปิดโมดูล — คืน True ถ้า STATUS ขึ้นภายในเวลาที่รอ

        ไม่เช็คก่อนว่า "ติดอยู่แล้วรึเปล่า" โดยตั้งใจ — บอร์ดที่ใช้จริงมีจังหวะที่ขา STATUS
        ค้างสูงทั้งที่โมดูลไม่ทำงานแล้ว ถ้าเช็คแล้วข้ามการกด ระบบจะไม่มีวันปลุกโมดูลได้เลย
        ในสถานการณ์ที่ต้องปลุกที่สุด (เจอจากการทดสอบจริง 16 ส.ค. 2569)
        
        การกดตอนโมดูลติดอยู่แล้วไม่มีผลเสีย — SIMCom ต้องกดค้างยาวกว่านี้มากถึงจะปิดเครื่อง
        ส่วนผู้เรียกเป็นคนตัดสินอยู่แล้วว่าควรปลุกไหม (เรียกเมื่อ AT ไม่ตอบเท่านั้น)
        """
        if not self.available:
            logger.warning("สั่งเปิดโมดูลไม่ได้: %s", self._reason)
            return False
        with self._lock:
            logger.warning("กด PWRKEY เปิดโมดูล (%.1f วิ)", PWRKEY_ON_SECONDS)
            self._press(settings.gsm_gpio_pwrkey, PWRKEY_ON_SECONDS)
            ok = self._wait_status(True, BOOT_TIMEOUT)
            logger.warning("เปิดโมดูล%s", "สำเร็จ" if ok else f"ไม่สำเร็จ (STATUS ไม่ขึ้นใน {BOOT_TIMEOUT:.0f} วิ)")
            return ok

    def close(self) -> None:
        if self._chip is None:
            return
        try:
            self._lg.gpiochip_close(self._chip)
        except Exception:
            logger.exception("ปิด gpiochip ไม่สำเร็จ")
        finally:
            self._chip = None
            self._lg = None
