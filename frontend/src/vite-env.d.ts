/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** เวอร์ชันแอปที่ถูกฝังตอน build — อ่านมาจาก app/main.py (ดู vite.config.ts) */
declare const __APP_VERSION__: string;
