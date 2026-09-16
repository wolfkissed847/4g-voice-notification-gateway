# 4G Gateway — Dashboard

Dashboard ของ [4G Automated Voice Notification Gateway](../README.md)
(Vite + React + TypeScript + Tailwind CSS v4)

โค้ดชุดนี้เริ่มจาก code bundle ของ Figma Make แล้วต่อเข้ากับ backend จริงผ่าน `src/app/api/`
ส่วนที่เหลือจากต้นฉบับถูกรื้อออกหมดแล้ว — component ของ shadcn/ui เหลือเฉพาะ 4 ตัวที่ใช้จริง
(`dialog` · `alert-dialog` · `button` · `utils`) ที่เหลือเขียนเองทั้งหมดใน `components/`

## วิธีรัน

```bash
npm i          # ติดตั้ง dependencies
npm run dev    # dev server (http://localhost:5173 — ต้องตรงกับ DASHBOARD_ORIGIN ใน .env ของ backend)
npm run build  # build เป็น static bundle ให้ FastAPI เสิร์ฟ (ดู Dockerfile)
npm run typecheck
```

ตอน deploy จริงไม่ต้องรันเอง — `Dockerfile` build ให้ในขั้น `frontend-builder` แล้วก๊อป
`dist/` ไปไว้ที่ `/app/static` ให้ FastAPI เสิร์ฟ

## โครงไฟล์

| โฟลเดอร์ | มีอะไร |
|---|---|
| `src/app/api/` | ตัวเรียก backend แยกตามโดเมน (auth · queue · groups · history …) |
| `src/app/pages/` | หน้าเว็บทั้งหมด — 8 route ที่มีเนื้อหา |
| `src/app/components/` | component ที่เขียนเอง (`primitives.tsx` เป็นตัวหลัก) |
| `src/app/components/ui/` | shadcn/ui เฉพาะ 4 ตัวที่ยังใช้อยู่ |
| `src/app/lib/` | ตัวช่วยที่ไม่ผูกกับหน้าไหนโดยเฉพาะ |
| `src/styles/` | ธีมและ token — เริ่มที่ `index.css` ซึ่ง import ที่เหลือตามลำดับ |

## ตัวแปรสภาพแวดล้อม

```bash
cp .env.example .env    # VITE_API_BASE_URL — ไม่ตั้งจะใช้ http://localhost:8000
```
