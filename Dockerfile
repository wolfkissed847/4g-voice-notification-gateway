# ===================================================================
# Multi-stage build — build บน GitHub Actions runner (cloud) เท่านั้น
# Pi 3 แค่ pull image สำเร็จรูปมารัน ไม่ต้อง build อะไรเองเลย
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

# ติดตั้ง dependency ของระบบที่ pyserial/cryptography ต้องใช้ตอน build (แล้วลบ cache ทิ้ง)
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
COPY scripts/ ./scripts/

# เอา frontend ที่ build เสร็จจาก stage 1 มาไว้ที่ /app/static
# main.py จะเช็คโฟลเดอร์นี้แล้วเสิร์ฟเป็น static file ให้เอง (ดู app/main.py ท้ายไฟล์)
COPY --from=frontend-builder /frontend/dist ./static

# audio_cache และ logs ต้อง persist ข้าม container restart — mount เป็น volume ใน docker-compose.yml
RUN mkdir -p audio_cache logs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
