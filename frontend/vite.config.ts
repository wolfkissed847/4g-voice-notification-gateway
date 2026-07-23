import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Build เป็น static bundle ล้วนๆ ไม่มี SSR — ให้ FastAPI เสิร์ฟเป็น static file ธรรมดา
// base: "/" เพราะ FastAPI เสิร์ฟที่ root path
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    proxy: {
      // ตอน dev (npm run dev) ให้ proxy API request ไปที่ FastAPI ที่รันคู่กันบน :8000
      "/notify": "http://localhost:8000",
      "/auth": "http://localhost:8000",
      "/queue": "http://localhost:8000",
      "/config": "http://localhost:8000",
      "/health": "http://localhost:8000",
    },
  },
});
