"""
TTS Service — แปลงข้อความภาษาไทยเป็นไฟล์เสียงด้วย gTTS
"""
import hashlib
import logging
import os

from gtts import gTTS

from app.config import settings

logger = logging.getLogger("tts_service")


def text_to_speech(text: str) -> str:
    """
    แปลงข้อความเป็นไฟล์เสียง mp3 แล้วคืน path ของไฟล์
    ใช้ hash ของข้อความเป็นชื่อไฟล์เพื่อ cache ไม่ต้อง generate ซ้ำ
    """
    os.makedirs(settings.audio_cache_dir, exist_ok=True)

    text_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]
    file_path = os.path.join(settings.audio_cache_dir, f"{text_hash}.mp3")

    if os.path.exists(file_path):
        logger.info("ใช้ไฟล์เสียงจาก cache: %s", file_path)
        return file_path

    tts = gTTS(text=text, lang=settings.tts_language)
    tts.save(file_path)
    logger.info("สร้างไฟล์เสียงใหม่: %s", file_path)
    return file_path
