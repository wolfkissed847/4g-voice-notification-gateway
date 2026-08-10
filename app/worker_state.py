"""
Worker State — สถานะรันไทม์ของ call worker thread แชร์กับ FastAPI process เดียวกัน
ใช้แค่แสดงผลใน dashboard (Overview → System Info) ไม่ใช่แหล่งความจริงของ business logic ใดๆ
"""
import dataclasses
import datetime
import threading


@dataclasses.dataclass
class WorkerState:
    started_at: datetime.datetime | None = None
    gsm_connected: bool = False
    gsm_port: str | None = None
    gsm_signal_quality: int | None = None
    gsm_operator: str | None = None
    gsm_network_mode: str | None = None
    gsm_status_updated_at: datetime.datetime | None = None
    # ขั้นตอนย่อยที่ worker กำลังทำกับงานปัจจุบัน (ดู CallStep ด้านล่าง)
    # เก็บในหน่วยความจำอย่างเดียว ไม่ลง DB เพราะเป็นข้อมูลชั่วขณะที่หมดความหมายทันทีที่ process ตาย
    # และซิมมีใบเดียว = โทรได้ทีละสาย จึงมีงานที่ "กำลังทำอยู่" ได้แค่งานเดียวเสมอ
    current_job_id: int | None = None
    current_step: str | None = None
    # ความคืบหน้าภายในขั้นตอนปัจจุบัน 0.0-1.0 (None = ขั้นนี้วัดความคืบหน้าไม่ได้)
    # ตอนนี้มีแค่ขั้นอัปโหลดไฟล์เสียงที่วัดได้ เพราะรู้ขนาดไฟล์และส่งเป็นก้อนๆ นับได้
    current_progress: float | None = None


class CallStep:
    """ขั้นตอนย่อยระหว่างประมวลผลงานโทร 1 งาน — ละเอียดกว่า CallStatus ที่เก็บลง DB

    มีไว้ให้หน้า Signal Flow Monitor ไล่ไฟทีละขั้นตามงานจริง ไม่ใช่กระโดดจาก "เข้าคิว"
    ไปเป็น "กำลังต่อสาย" ทันที (CallStatus ใน DB หยาบเกินไปสำหรับการแสดงผลแบบนี้:
    ระหว่าง in_progress ยาวๆ มันเกิดหลายอย่างที่ผู้ใช้ควรเห็นแยกกัน)
    """
    PREPARING_AUDIO = "preparing_audio"   # เรียก gTTS แปลงข้อความเป็นเสียง
    UPLOADING_AUDIO = "uploading_audio"   # ส่งไฟล์เสียงเข้าโมดูล (ขั้นที่กินเวลาที่สุด)
    DIALING = "dialing"                   # ATD โทรออก รอปลายสายรับ
    PLAYING = "playing"                   # ปลายสายรับแล้ว กำลังเล่นข้อความเสียง
    WAITING_RETRY = "waiting_retry"       # สายจบแบบไม่สำเร็จ กำลังรอครบเวลาก่อนโทรซ้ำ


_state = WorkerState()
_lock = threading.Lock()


def mark_started():
    with _lock:
        _state.started_at = datetime.datetime.utcnow()


def set_gsm_connected(connected: bool, port: str | None = None):
    with _lock:
        _state.gsm_connected = connected
        if port is not None:
            _state.gsm_port = port


def set_gsm_status(signal_quality: int | None, operator: str | None, network_mode: str | None):
    with _lock:
        _state.gsm_signal_quality = signal_quality
        _state.gsm_operator = operator
        _state.gsm_network_mode = network_mode
        _state.gsm_status_updated_at = datetime.datetime.utcnow()


def set_current_step(job_id: int | None, step: str | None, progress: float | None = None):
    """บอกว่า worker กำลังทำขั้นตอนไหนกับงานไหนอยู่ — ส่ง (None, None) เมื่อว่างงาน"""
    with _lock:
        _state.current_job_id = job_id
        _state.current_step = step
        _state.current_progress = progress


def set_progress(progress: float):
    """อัปเดตความคืบหน้าของขั้นตอนปัจจุบันอย่างเดียว (ไม่แตะ step) — เรียกถี่ได้ระหว่างอัปโหลด"""
    with _lock:
        _state.current_progress = progress


def get_state() -> WorkerState:
    with _lock:
        return dataclasses.replace(_state)
