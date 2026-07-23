# ===================================================================
# Multi-stage build — build บน Raspberry Pi 3 เอง (native build ผ่าน self-hosted runner)
# ไม่มี cross-compile/QEMU แล้ว เพราะ build ตรงบนสถาปัตยกรรมเดียวกับที่จะรัน
# ===================================================================

# ---------- Stage 1: Build frontend (Vite + React + Tailwind) ----------
FROM node:20-slim AS frontend-builder

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install

COPY frontend/ ./
RUN npm run build
# ผลลัพธ์: /frontend/dist (static HTML/JS/CSS)


# ---------- Stage 2: Python runtime (FastAPI + worker) ----------
FROM python:3.12-slim

WORKDIR /app

# gcc เผื่อ pip ต้อง compile package ที่ไม่มี wheel สำเร็จรูปให้ (ปกติไม่ต้องใช้ถ้า piwheels มีให้)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
# ใช้ piwheels.org (wheel mirror ที่ compile ไว้ให้แล้วสำหรับ ARM/Raspberry Pi โดยเฉพาะ)
# ลดเวลา build cryptography/bcrypt จากหลักสิบนาที (compile จาก source) เหลือไม่กี่วินาที (ดาวน์โหลด wheel)
# ถ้า build บนเครื่องที่ไม่ใช่ ARM (เช่น dev บน x86) pip จะ fallback ไป PyPI ปกติเองถ้า piwheels ไม่มี wheel ให้
RUN pip install --no-cache-dir \
    --index-url https://www.piwheels.org/simple \
    --extra-index-url https://pypi.org/simple \
    -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/

# เอา frontend ที่ build เสร็จจาก stage 1 มาไว้ที่ /app/static
COPY --from=frontend-builder /frontend/dist ./static

RUN mkdir -p audio_cache logs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
