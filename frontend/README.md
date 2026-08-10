
  # 4G Gateway — Dashboard

  Dashboard ของ [4G Automated Voice Notification Gateway](../README.md) (Vite + React + TypeScript +
  Tailwind + shadcn/ui) โค้ดชุดนี้เริ่มจาก code bundle ของ Figma Make
  (ต้นฉบับ: https://www.figma.com/design/EIHFn12s9ncBKOEotMArCd/4G-Gateway) แล้วต่อเข้ากับ backend จริง
  ผ่าน `src/app/api/` — ดูสเปกดีไซน์เต็มที่ [figma/handoff/README.md](../figma/handoff/README.md)

  ## Running the code

  ```bash
  npm i          # ติดตั้ง dependencies
  npm run dev    # dev server (default: http://localhost:5173 — ต้องตรงกับ DASHBOARD_ORIGIN ใน .env ของ backend)
  npm run build  # build เป็น static bundle ให้ FastAPI เสิร์ฟ (ดู Dockerfile)
  npm run typecheck
  ```
  