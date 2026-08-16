import { defineConfig } from 'vite'
import fs from 'fs'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

/**
 * เวอร์ชันแอปมาจาก app/main.py ที่เดียว — ไม่ให้ frontend ถือเลขเวอร์ชันของตัวเอง
 * เพราะพอมีสองที่มันเพี้ยนกันเสมอ (package.json ค้างอยู่ที่ 0.2.0 มาตลอด
 * ทั้งที่ตัวแอปเดินมาถึง 0.5.0 แล้ว) ค่านี้ถูกฝังตอน build ผ่าน define ด้านล่าง
 * อ่านไม่ได้ก็ถอยเป็น "dev" ไม่ให้ build ล้มเพราะเรื่องป้ายเวอร์ชัน
 */
function readAppVersion(): string {
  try {
    const src = fs.readFileSync(path.resolve(__dirname, '../app/main.py'), 'utf-8')
    return /^\s*version="([^"]+)"/m.exec(src)?.[1] ?? 'dev'
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(readAppVersion()),
  },
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
  ],
  base: "/",
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  // No dev proxy needed — the frontend talks to the FastAPI backend directly via
  // VITE_API_BASE_URL (see src/app/api/client.ts), defaulting to http://localhost:8000.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
