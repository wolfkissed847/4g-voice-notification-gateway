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


def get_state() -> WorkerState:
    with _lock:
        return dataclasses.replace(_state)
