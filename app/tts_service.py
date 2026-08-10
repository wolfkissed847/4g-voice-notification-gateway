"""
TTS Service — แปลงข้อความภาษาไทยเป็นไฟล์เสียงด้วย gTTS

ไม่ cache ไฟล์เสียงไว้ใช้ซ้ำ — แปลงใหม่ทุกครั้งที่จะโทร (ตัดสินใจ 6 ส.ค. 2569 หลังวัดเวลาจริงแล้ว
gTTS ใช้เวลาแค่ ~0.3-0.9 วิ ต่อข้อความ เทียบกับเวลาอัปโหลดไฟล์เสียงเข้าโมดูล GSM ที่กินเวลา
เป็นสิบวิ (ดู gsm_module.py) ส่วนต่างนี้ผู้ใช้ไม่รู้สึกเลย จึงไม่คุ้มความซับซ้อนของการทำ cache
ดู LIMITATIONS.md ข้อ 1 สำหรับผลที่ตามมา: ถ้าอินเทอร์เน็ตล่มตอนจะโทร จะสร้างเสียงไม่ได้เสมอ
(ไม่ใช่แค่ตอนข้อความยังไม่เคยสร้าง เหมือนตอนที่ยังมี cache)

ใช้ชื่อไฟล์คงที่ ไม่ใช่ hash ต่อข้อความ — เพราะ worker ประมวลผลทีละ job เดียว (ซิมใบเดียว
โทรได้ทีละสาย ดู DEPLOYMENT_MODELS.md §5) จึงไม่มีโอกาสสองสายเขียนทับกันพร้อมกัน และ
ไฟล์เก่าที่ไม่ได้ใช้ต่อจะไม่ค้างสะสมในดิสก์เหมือนตอนที่ยัง cache ด้วย hash
"""
import logging
import os

from gtts import gTTS

from app.config import settings

logger = logging.getLogger("tts_service")

_OUTPUT_FILENAME = "notify.mp3"


def text_to_speech(text: str) -> str:
    """แปลงข้อความเป็นไฟล์เสียง mp3 แล้วคืน path ของไฟล์ — สร้างใหม่ทับไฟล์เดิมทุกครั้ง"""
    os.makedirs(settings.audio_cache_dir, exist_ok=True)
    file_path = os.path.join(settings.audio_cache_dir, _OUTPUT_FILENAME)

    tts = gTTS(text=text, lang=settings.tts_language)
    tts.save(file_path)
    logger.info("สร้างไฟล์เสียง: %s", file_path)
    return file_path
