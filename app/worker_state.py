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
    # อ่านจากขา STATUS ของโมดูลตรงๆ — None = ตอบไม่ได้ (ไม่ได้ต่อ GPIO ไว้ หรือเป็นโมดูล USB)
    #
    # ต่างจาก gsm_connected ที่หมายถึง "คุย AT กับโมดูลรู้เรื่องไหม" — สองอย่างนี้ไม่เหมือนกัน
    # และตอนต่างกันคือตอนที่มีประโยชน์ที่สุด: ไฟติดแต่ AT ไม่ตอบ = เฟิร์มแวร์ค้าง (แก้ด้วยรีบูต)
    # ส่วนไฟไม่ติดเลย = ไฟเลี้ยงหรือสายมีปัญหา (รีบูตไปก็ไม่ช่วย) คนละอาการคนละวิธีแก้
    gsm_power_on: bool | None = None
    # ขั้นตอนย่อยที่ worker กำลังทำกับงานปัจจุบัน (ดู CallStep ด้านล่าง)
    # เก็บในหน่วยความจำอย่างเดียว ไม่ลง DB เพราะเป็นข้อมูลชั่วขณะที่หมดความหมายทันทีที่ process ตาย
    # และซิมมีใบเดียว = โทรได้ทีละสาย จึงมีงานที่ "กำลังทำอยู่" ได้แค่งานเดียวเสมอ
    current_job_id: int | None = None
    current_step: str | None = None
    # ความคืบหน้าภายในขั้นตอนปัจจุบัน 0.0-1.0 (None = ขั้นนี้วัดความคืบหน้าไม่ได้)
    # ตอนนี้มีแค่ขั้นอัปโหลดไฟล์เสียงที่วัดได้ เพราะรู้ขนาดไฟล์และส่งเป็นก้อนๆ นับได้
    current_progress: float | None = None

    # ── คำสั่งรีสตาร์ทโมดูลจากหน้าเว็บ ────────────────────────────────────
    # ทำเป็น "ธง" ให้ worker มาหยิบไปทำเอง ไม่ใช่ให้ API thread สั่งโมดูลตรงๆ
    # เพราะพอร์ต serial เปิดได้ทีละโปรแกรม/ทีละ thread — worker ถือไว้ตลอดเวลา
    # ถ้า API แทรกเข้าไปเขียนพร้อมกัน คำสั่งสองชุดจะปนกันในสายเดียว แล้วอ่านคำตอบผิดทั้งคู่
    # ผลพลอยได้: worker เช็คธงนี้เฉพาะตอนไม่มีงานโทรค้างอยู่ จึงไม่มีทางไปตัดสายที่กำลังคุยอยู่
    gsm_restart_requested: bool = False
    gsm_restarting: bool = False
    gsm_restart_result: str | None = None   # 'ok' | 'failed' | None (ยังไม่เคยสั่ง)
    gsm_restart_at: datetime.datetime | None = None


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


def set_gsm_power_on(power_on: bool | None):
    """บันทึกสถานะขา STATUS ของโมดูล — worker เป็นคนเรียก เพราะเป็นฝ่ายที่ถือ GPIO ไว้"""
    with _lock:
        _state.gsm_power_on = power_on


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


def request_gsm_restart() -> bool:
    """
    ขอให้ worker รีสตาร์ทโมดูลในรอบถัดไป — คืน False ถ้ามีคำขอค้างอยู่แล้วหรือกำลังทำอยู่

    เรียกจาก API thread เท่านั้น ตัวที่ลงมือทำจริงคือ worker (ดูเหตุผลที่ dataclass ด้านบน)
    """
    with _lock:
        if _state.gsm_restart_requested or _state.gsm_restarting:
            return False
        _state.gsm_restart_requested = True
        return True


def take_gsm_restart_request() -> bool:
    """worker เรียกเพื่อ 'รับงาน' — คืน True ครั้งเดียวต่อ 1 คำขอ แล้วเคลียร์ธงทันที"""
    with _lock:
        if not _state.gsm_restart_requested:
            return False
        _state.gsm_restart_requested = False
        _state.gsm_restarting = True
        _state.gsm_restart_result = None
        return True


def finish_gsm_restart(ok: bool):
    with _lock:
        _state.gsm_restarting = False
        _state.gsm_restart_result = "ok" if ok else "failed"
        _state.gsm_restart_at = datetime.datetime.utcnow()


def get_state() -> WorkerState:
    with _lock:
        return dataclasses.replace(_state)
