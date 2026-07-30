"""
System Metrics — อ่านสถานะฮาร์ดแวร์ของ Raspberry Pi (CPU/RAM/อุณหภูมิ) สำหรับหน้า Overview
อ่านตรงจาก OS ทุกครั้งที่เรียก (เบา ไม่ต้องแคช) ไม่เกี่ยวกับ GSM serial port จึงเรียกจาก
API request thread ได้ตรงๆ โดยไม่ชนกับ call worker thread
"""
import psutil


def _read_cpu_temp_celsius() -> float | None:
    """อ่านอุณหภูมิ CPU จาก thermal zone ของ Linux — คืน None บนเครื่องที่ไม่มี (เช่น Windows ตอน dev)"""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp") as f:
            return round(int(f.read().strip()) / 1000, 1)
    except (FileNotFoundError, ValueError, OSError):
        return None


def get_pi_metrics() -> dict:
    mem = psutil.virtual_memory()
    return {
        "cpu_percent": psutil.cpu_percent(interval=0.2),
        "mem_percent": mem.percent,
        "mem_used_mb": round(mem.used / (1024 * 1024), 1),
        "mem_total_mb": round(mem.total / (1024 * 1024), 1),
        "cpu_temp_c": _read_cpu_temp_celsius(),
    }
