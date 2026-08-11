"""
กันเดารหัสผ่านหน้า login — จำกัดจำนวนครั้งที่ล็อกอินผิดได้ต่อหนึ่งต้นทาง

── ทำไมต้องมี ────────────────────────────────────────────────────────────────
/auth/login เป็น endpoint เดียวที่เปิดให้ทุกคนบนอินเทอร์เน็ตยิงได้โดยไม่ต้องมีอะไรติดตัวมาเลย
และระบบนี้มีผู้ใช้คนเดียวคือ "admin" ผู้โจมตีจึงรู้ชื่อผู้ใช้อยู่แล้ว เหลือแค่เดารหัสผ่านอย่างเดียว
ถ้าไม่จำกัดจำนวนครั้ง สคริปต์ตัวเดียวก็ไล่เดารหัสผ่านได้ไม่จำกัดจนกว่าจะเจอ

bcrypt ที่ใช้ตรวจรหัสผ่านช้าอยู่แล้วประมาณ 0.1 วินาทีต่อครั้ง ซึ่งช่วยชะลอได้บ้าง
แต่ยังเปิดให้ลองได้ราว 8 แสนครั้งต่อวัน — มากพอจะเดารหัสผ่านที่ไม่แข็งแรงได้สบาย

── ทำไมไม่ล็อกทั้งระบบเมื่อผิดหลายครั้ง ──────────────────────────────────────
เพราะจะกลายเป็นช่องให้คนอื่นกันผู้ดูแลตัวจริงออกจากระบบได้ ด้วยการยิงรหัสผิดรัวๆ
จึงนับแยกรายต้นทาง (IP) แทน ผู้ดูแลที่นั่งอยู่คนละที่กับผู้โจมตีจึงยังเข้าได้ตามปกติ
"""
import threading
import time

# ยอมให้ผิดได้ 10 ครั้งต่อ 15 นาที — เผื่อผู้ดูแลพิมพ์ผิดหรือจำรหัสสลับกันหลายรอบ
# แต่ยังต่ำพอที่การไล่เดาแบบอัตโนมัติจะไม่มีความหมาย
MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60

_lock = threading.Lock()
_failures: dict[str, list[float]] = {}


def _prune(stamps: list[float], now: float) -> list[float]:
    return [t for t in stamps if now - t < WINDOW_SECONDS]


def client_key(request) -> str:
    """
    หา "ต้นทาง" ของคำขอ — ต้องอ่านจาก header ของ Cloudflare ก่อน

    ระบบนี้เข้าถึงจากภายนอกผ่าน Cloudflare Tunnel ทุกคำขอจึงมาถึงแอปในนามของ 127.0.0.1
    ถ้านับจาก request.client.host ตรงๆ ทุกคนบนอินเทอร์เน็ตจะถูกนับรวมเป็นต้นทางเดียวกันหมด
    ผลคือคนแปลกหน้าที่ยิงรหัสผิดรัวๆ จะทำให้ผู้ดูแลตัวจริงล็อกอินไม่ได้ไปด้วย
    """
    for header in ("cf-connecting-ip", "x-forwarded-for"):
        value = request.headers.get(header)
        if value:
            return value.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def seconds_until_allowed(key: str) -> int:
    """0 = ลองได้เลย, มากกว่านั้น = ต้องรออีกกี่วินาที"""
    now = time.time()
    with _lock:
        stamps = _prune(_failures.get(key, []), now)
        _failures[key] = stamps
        if len(stamps) < MAX_FAILURES:
            return 0
        return max(1, int(WINDOW_SECONDS - (now - stamps[0])))


def record_failure(key: str) -> None:
    now = time.time()
    with _lock:
        _failures[key] = _prune(_failures.get(key, []), now) + [now]


def record_success(key: str) -> None:
    """ล็อกอินถูกแล้วล้างประวัติทิ้ง — คนที่พิมพ์ผิดไปหลายครั้งก่อนหน้าไม่ควรโดนจำกัดต่อ"""
    with _lock:
        _failures.pop(key, None)
