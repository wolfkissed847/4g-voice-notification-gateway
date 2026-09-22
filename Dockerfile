# ===================================================================
# Multi-stage build — build บน Raspberry Pi 3 เอง (native build ผ่าน self-hosted runner)
# ไม่มี cross-compile/QEMU แล้ว เพราะ build ตรงบนสถาปัตยกรรมเดียวกับที่จะรัน
# ===================================================================

# ---------- Stage 1: Build frontend (Vite + React + Tailwind) ----------
FROM node:20-slim AS frontend-builder

WORKDIR /frontend
# ไม่มี * ต่อท้าย package-lock.json โดยตั้งใจ — ต้องมีไฟล์นี้จริงเท่านั้น
# ถ้าใส่ * ไว้แล้ววันหนึ่ง lockfile หายไป COPY จะผ่านเงียบๆ แล้วไปตายที่ npm ci
# ด้วย error ที่อ่านไม่รู้เรื่องว่าสาเหตุคือไฟล์ไม่ถูกก๊อปเข้ามา
COPY frontend/package.json frontend/package-lock.json ./

# npm ci ไม่ใช่ npm install — ติดตั้งตาม package-lock.json เป๊ะๆ ไม่คิดเวอร์ชันใหม่เอง
#
# ที่ต้องเป็น ci: npm install จะ "แก้" lockfile ให้เองเงียบๆ ถ้ามันไม่ตรงกับ package.json
# ผลคือ image ที่ deploy อาจได้ dependency คนละชุดกับที่ทดสอบบนเครื่อง dev
# และถ้ามี peer dependency ขัดกัน npm บนเครื่อง dev (v11) กับบน Pi (v10) ตัดสินไม่เหมือนกัน
# — เจอมาแล้ว 16 ก.ย. 2569: เครื่อง dev build ผ่าน แต่ Pi ตกที่ ERESOLVE
#   เพราะ @types/react-dom ค้างอยู่ที่ v19 ทั้งที่โปรเจคใช้ React 18
#
# npm ci อ่าน lockfile อย่างเดียว ไม่ re-resolve จึงได้ผลเหมือนกันทุกเครื่องทุกรอบ
# และถ้า lockfile ไม่ตรงกับ package.json มันจะฟ้องทันทีตั้งแต่ต้น แทนที่จะเงียบแล้วไปพังทีหลัง
# (ผลพลอยได้: เร็วกว่าเพราะข้ามขั้นตอนคิดว่าจะลงเวอร์ชันไหน)
RUN npm ci

COPY frontend/ ./

# เลขเวอร์ชันที่หน้าเว็บแสดง อ่านจาก app/main.py ตอน build (ดู readAppVersion ใน vite.config.ts)
# ถ้าไม่ก๊อปไฟล์นี้เข้ามา readAppVersion จะ throw แล้วถอยไปใช้คำว่า "dev" เงียบๆ
# ผลคือ build ที่ deploy จริงขึ้นว่า "เวอร์ชัน dev" ที่หน้าเข้าสู่ระบบ ทั้งที่ไม่ใช่เครื่อง dev
# ก๊อปเฉพาะ main.py ไฟล์เดียวพอ ไม่เอาทั้ง app/ เพื่อไม่ให้ layer cache ของ stage นี้
# ถูกล้างทุกครั้งที่แก้โค้ดฝั่ง backend ซึ่งไม่เกี่ยวกับหน้าเว็บเลย
COPY app/main.py /app/main.py

RUN npm run build
# ผลลัพธ์: /frontend/dist (static HTML/JS/CSS)


# ---------- Stage 2: Python runtime (FastAPI + worker) ----------
FROM python:3.12-slim

WORKDIR /app

# gcc เผื่อ pip ต้อง compile package ที่ไม่มี wheel สำเร็จรูปให้ (ปกติไม่ต้องใช้ถ้า piwheels มีให้)
# sox + libsox-fmt-all: บีบไฟล์เสียงจาก gTTS ให้เล็กลงก่อนอัปเข้าโมดูล (ดู tts_service.py)
# ต้องมี libsox-fmt-all ด้วย ไม่งั้น sox อ่าน mp3 ไม่ได้ (ตัว sox เปล่าไม่มี handler ของ mp3)
# เลือก sox แทน ffmpeg เพราะ ffmpeg ลากมา 200 packages ส่วน sox ชุดนี้ 44 — บน Pi ต่างกันมาก
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    sox \
    libsox-fmt-all \
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
# migrations/ จำเป็นตอน runtime ไม่ใช่แค่ตอน dev — init_db() เรียก `alembic upgrade head`
# ตอน startup ถ้าไม่มีโฟลเดอร์นี้ใน image container จะขึ้นไม่ได้เลย
# alembic.ini ติดมาด้วยเพื่อให้รัน alembic CLI ใน container ได้ (เช่น docker compose exec gateway alembic history)
COPY migrations/ ./migrations/
COPY alembic.ini .

# เอา frontend ที่ build เสร็จจาก stage 1 มาไว้ที่ /app/static
COPY --from=frontend-builder /frontend/dist ./static

# commit ที่ image นี้ถูก build มา — ส่งเข้ามาจาก workflow (ดู .github/workflows/deploy.yml)
# วางไว้ท้ายๆ โดยตั้งใจ: ค่านี้เปลี่ยนทุก commit ถ้าวางไว้ต้นไฟล์ Docker จะทิ้ง cache
# ของทุกชั้นที่อยู่หลังมัน = build ใหม่หมดทุกรอบ (npm ci/pip install ใหม่ทุกครั้ง)
ARG GIT_SHA=dev
ENV APP_GIT_SHA=$GIT_SHA

RUN mkdir -p audio_cache logs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
