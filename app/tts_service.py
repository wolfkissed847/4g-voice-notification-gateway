"""
TTS Service — แปลงข้อความภาษาไทยเป็นไฟล์เสียงด้วย gTTS

ไม่ cache ไฟล์เสียงไว้ใช้ซ้ำ — แปลงใหม่ทุกครั้งที่จะโทร (ตัดสินใจ 6 ส.ค. 2569 หลังวัดเวลาจริงแล้ว
gTTS ใช้เวลาแค่ ~0.3-0.9 วิ ต่อข้อความ เทียบกับเวลาอัปโหลดไฟล์เสียงเข้าโมดูล GSM ที่กินเวลา
เป็นสิบวิ (ดู gsm_module.py) ส่วนต่างนี้ผู้ใช้ไม่รู้สึกเลย จึงไม่คุ้มความซับซ้อนของการทำ cache
ดู LIMITATIONS.md ข้อ 1 สำหรับผลที่ตามมา: ถ้าอินเทอร์เน็ตล่มตอนจะโทร จะสร้างเสียงไม่ได้เสมอ
(ไม่ใช่แค่ตอนข้อความยังไม่เคยสร้าง เหมือนตอนที่ยังมี cache)

ใช้ชื่อไฟล์คงที่ ไม่ใช่ hash ต่อข้อความ — เพราะ worker ประมวลผลทีละ job เดียว (ซิมใบเดียว
โทรได้ทีละสาย ดู LIMITATIONS.md ข้อ 2) จึงไม่มีโอกาสสองสายเขียนทับกันพร้อมกัน และ
ไฟล์เก่าที่ไม่ได้ใช้ต่อจะไม่ค้างสะสมในดิสก์เหมือนตอนที่ยัง cache ด้วย hash
"""
import logging
import os
import shutil
import subprocess

from gtts import gTTS

from app.config import settings

logger = logging.getLogger("tts_service")

_OUTPUT_FILENAME = "notify.mp3"
_RAW_FILENAME = "notify_raw.mp3"

# บีบไฟล์เสียงก่อนอัปเข้าโมดูลด้วย sox — วัดกับ A7670E จริง 22 ก.ย. 2569:
# gTTS ส่งมาที่ 24kbps/24kHz ได้ไฟล์ ~71KB ต่อข้อความ 9 วินาที ซึ่งใหญ่เกินจำเป็นมาก
# เพราะสายโทรศัพท์ตัดความถี่เหลือ 8kHz อยู่แล้ว ปลายสายจึงไม่ได้ยินส่วนที่เกินนั้นเลย
# 8kbps/8kHz mono เหลือ ~9KB (เล็กลง 8 เท่า) เสียงที่ปลายสายได้ยินเหมือนเดิม
#
# ทำไมไม่ใช้ AMR-NB ทั้งที่เป็นโคเดกของโทรศัพท์โดยตรงและคู่มือบอกว่ารองรับ:
# ทดสอบแล้วโมดูล "รับไฟล์ครบและตอบ OK ทุกขั้น" แต่ตอนเล่นจริงได้แค่ 0.24 วิ
# จากเสียงยาว 8.93 วิ — คือเงียบทั้งสาย โดยไม่มี error ให้จับได้เลยสักจุด
# (ลองทั้ง 12.2kbps และ default 4.75kbps ผลเหมือนกัน) ห้ามเปลี่ยนกลับไปใช้ .amr
# นอกจากจะทดสอบการเล่นจริงกับฮาร์ดแวร์แล้วว่าความยาวตรงกับไฟล์ต้นทาง
_TARGET_BITRATE = "8"
_TARGET_RATE = "8000"


def _compress_for_module(src: str, dst: str) -> bool:
    """บีบ mp3 ให้เล็กลงด้วย sox คืน True ถ้าสำเร็จ

    ไม่มี sox ในเครื่อง = ไม่ใช่เหตุให้โทรไม่ออก แค่กลับไปใช้ไฟล์เดิมที่ใหญ่กว่า
    (ช้าลงแต่ยังทำงานได้) จึงจับ exception ทั้งหมดแล้วคืน False แทนที่จะโยนต่อ
    """
    if not shutil.which("sox"):
        logger.warning("ไม่พบ sox — ใช้ไฟล์เสียงขนาดเต็มแทน อัปโหลดเข้าโมดูลจะช้ากว่าปกติ")
        return False
    try:
        subprocess.run(
            ["sox", src, "-r", _TARGET_RATE, "-c", "1", "-C", _TARGET_BITRATE, dst],
            check=True,
            capture_output=True,
            timeout=30,
        )
    except (subprocess.SubprocessError, OSError) as exc:
        logger.warning("บีบไฟล์เสียงไม่สำเร็จ ใช้ไฟล์ขนาดเต็มแทน: %s", exc)
        return False
    # sox จบด้วย exit 0 แต่ได้ไฟล์เปล่าถือว่าล้มเหลว — ปล่อยไปจะกลายเป็นสายเงียบ
    if not os.path.exists(dst) or os.path.getsize(dst) == 0:
        logger.warning("sox คืนไฟล์เปล่า ใช้ไฟล์ขนาดเต็มแทน")
        return False
    return True


def text_to_speech(text: str) -> str:
    """แปลงข้อความเป็นไฟล์เสียง mp3 แล้วคืน path ของไฟล์ — สร้างใหม่ทับไฟล์เดิมทุกครั้ง"""
    os.makedirs(settings.audio_cache_dir, exist_ok=True)
    file_path = os.path.join(settings.audio_cache_dir, _OUTPUT_FILENAME)
    raw_path = os.path.join(settings.audio_cache_dir, _RAW_FILENAME)

    tts = gTTS(text=text, lang=settings.tts_language)
    tts.save(raw_path)

    if _compress_for_module(raw_path, file_path):
        logger.info(
            "สร้างไฟล์เสียง: %s (%d ไบต์ จากต้นฉบับ %d ไบต์)",
            file_path,
            os.path.getsize(file_path),
            os.path.getsize(raw_path),
        )
    else:
        shutil.copyfile(raw_path, file_path)
        logger.info("สร้างไฟล์เสียง: %s (%d ไบต์ ไม่ได้บีบ)", file_path, os.path.getsize(file_path))
    return file_path
