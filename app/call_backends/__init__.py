"""Backend Selector — เลือก GSM หรือ VoIP ตาม config ที่ user ตั้งผ่าน dashboard (ไม่ใช่ .env อีกต่อไป)"""
from app.call_backends.base import CallBackend
from app.call_backends.gsm_backend import GSMBackend
from app.call_backends.voip_backend import VoIPBackend
from app.config_service import EffectiveConfig


def get_call_backend(cfg: EffectiveConfig) -> CallBackend:
    backend = cfg.call_backend.lower()
    if backend == "gsm":
        return GSMBackend()
    if backend == "voip":
        return VoIPBackend(
            ami_host=cfg.ami_host,
            ami_port=cfg.ami_port,
            ami_username=cfg.ami_username,
            ami_secret=cfg.ami_secret,
            trunk_name=cfg.zadarma_trunk_name,
            dial_context=cfg.voip_dial_context,
            callerid=cfg.voip_callerid,
            ring_timeout_seconds=cfg.call_ring_timeout_seconds,
        )
    raise ValueError(f"call_backend ไม่ถูกต้อง: '{backend}' (ต้องเป็น 'gsm' หรือ 'voip')")
