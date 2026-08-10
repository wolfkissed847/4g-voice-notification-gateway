"""
System Metrics — อ่านสถานะฮาร์ดแวร์ของ Raspberry Pi (CPU/RAM/อุณหภูมิ) สำหรับหน้า Overview
อ่านตรงจาก OS ทุกครั้งที่เรียก (เบา ไม่ต้องแคช) ไม่เกี่ยวกับ GSM serial port จึงเรียกจาก
API request thread ได้ตรงๆ โดยไม่ชนกับ call worker thread
"""
import psutil

# เรียกครั้งแรกตอน import เพื่อ "ตั้งต้น" ตัวนับของ psutil
# psutil.cpu_percent(interval=None) คืนค่าเฉลี่ย "นับจากครั้งที่เรียกก่อนหน้า" ครั้งแรกสุด
# จึงไม่มีอะไรให้เทียบและคืน 0.0 เสมอ — เรียกทิ้งไว้ตรงนี้ครั้งเดียวเพื่อให้ครั้งถัดไปมีค่าจริง
psutil.cpu_percent(interval=None)


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
        # interval=None ไม่ใช่ 0.2 — แบบเดิมจะ "หยุดรอวัด" 200ms ทุกครั้งที่มีคนเรียก
        # ซึ่งกลายเป็นปัญหาเมื่อหน้าเว็บ poll ถี่ขึ้นเป็นทุก 2 วินาที (บล็อก thread 10% ของเวลา
        # บน Pi 3B ที่ CPU ไม่เหลือเฟือ) แบบ None คืนค่าเฉลี่ยนับจากครั้งก่อนหน้าทันทีโดยไม่รอเลย
        # ซึ่งกับการ poll ทุก 2 วิ = ค่าเฉลี่ยจริงของ 2 วินาทีที่ผ่านมา แม่นกว่าการสุ่มวัด 200ms ด้วยซ้ำ
        "cpu_percent": psutil.cpu_percent(interval=None),
        "mem_percent": mem.percent,
        "mem_used_mb": round(mem.used / (1024 * 1024), 1),
        "mem_total_mb": round(mem.total / (1024 * 1024), 1),
        "cpu_temp_c": _read_cpu_temp_celsius(),
    }
