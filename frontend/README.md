# Gateway Dashboard (Frontend)

Vite + React + Tailwind — build เป็น static bundle ล้วนๆ ไม่มี Node.js server รันตอนใช้งานจริง

## Dev (บนเครื่องคุณ ไม่ใช่บน Pi)

```bash
cd frontend
npm install
npm run dev
```

รันคู่กับ backend (`uvicorn app.main:app --reload` ที่ root โปรเจค) — Vite dev server จะ proxy
request `/notify`, `/auth`, `/queue`, `/config` ไปที่ FastAPI ที่ `:8000` ให้อัตโนมัติ (ดู `vite.config.ts`)

## Build

```bash
npm run build
```

ได้โฟลเดอร์ `dist/` (static HTML/JS/CSS, ~55KB gzip) — **ไม่ต้อง build บน Pi เลย** เพราะ
`Dockerfile` ที่ root โปรเจคจะ build ให้อัตโนมัติผ่าน GitHub Actions ทุกครั้งที่ push

## Deploy จริง

ไม่ต้องทำอะไรเพิ่มด้วยมือ — flow ทั้งหมดเป็นแบบนี้:

```
git push → self-hosted runner บน Pi รับงาน → build Docker image เอง (native, ไม่ cross-compile)
         → restart container ด้วย image ใหม่
```

ดูรายละเอียดที่ [`../README.md`](../README.md) หัวข้อ "Deploy ด้วย Docker + CI/CD"
