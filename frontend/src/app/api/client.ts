// ─── Fetch wrapper ────────────────────────────────────────────────────────────
// Base URL, JWT header injection, FastAPI {detail} error handling, 401 redirect.

import { clearSnapshots } from "../lib/snapshot";

/**
 * ที่อยู่ของ API
 *
 * ── ทำไม production ต้องเป็น window.location.origin ────────────────────────
 * FastAPI เสิร์ฟทั้งหน้าเว็บและ API จาก origin เดียวกัน (ดู app/main.py ท้ายไฟล์)
 * ยิงแบบ same-origin จึงถูกต้องเสมอไม่ว่าจะเปิดจากที่ไหน:
 *   http://192.168.1.185:8000   (ในวง LAN)
 *   https://4gcall.example.dev  (ผ่าน Cloudflare Tunnel)
 *
 * เดิม default เป็น "http://localhost:8000" ซึ่งถูกฝังลงไฟล์ JS ตอน build
 * (Vite แทนค่า import.meta.env ตอน build ไม่ใช่ตอนรัน) ผลคือเปิดเว็บผ่าน tunnel
 * แล้วเบราว์เซอร์ยิง API ไปที่ localhost ของ "เครื่องคนเปิดเว็บ" ไม่ใช่ของ Pi
 * → Chrome เด้งขอสิทธิ์ Local Network Access แล้ว login ไม่ผ่านเพราะไม่มีเซิร์ฟเวอร์ตรงนั้น
 *
 * ── ทำไม dev ยังต้องเป็น localhost:8000 ───────────────────────────────────
 * ตอน `npm run dev` หน้าเว็บอยู่ที่พอร์ต 5173 แต่ API อยู่ที่ 8000 คนละ origin กัน
 * ถ้าใช้ origin ของหน้าเว็บจะยิงไปที่ 5173 ซึ่งไม่มี API อยู่
 * (import.meta.env.DEV เป็นค่าคงที่ตอน build — โค้ดสาขานี้จึงถูกตัดทิ้งจาก bundle จริง)
 *
 * ตั้ง VITE_API_BASE_URL ทับได้ทั้งสองกรณี ถ้าต้องแยกโดเมน API ออกไปจริงๆ
 */
export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ||
  (import.meta.env.DEV ? "http://localhost:8000" : window.location.origin);

export const TOKEN_STORAGE_KEY = "gateway_jwt";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  // ข้อมูลที่หน้าต่างๆ แคชไว้เป็นของ session ที่เพิ่งจบ ต้องทิ้งไปพร้อมกัน
  // ไม่งั้นคนที่ login รอบถัดไปจะเห็นรายการของรอบก่อนแวบหนึ่งก่อนโหลดใหม่
  clearSnapshots();
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  auth?: boolean; // default true — send Authorization header
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, query, auth = true } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(buildUrl(path, query), {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth) {
    clearToken();
    if (typeof window !== "undefined" && window.location.pathname !== "/login") {
      window.location.assign("/login");
    }
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      if (data && typeof data.detail === "string") detail = data.detail;
      else if (data && data.detail) detail = JSON.stringify(data.detail);
    } catch {
      // response body wasn't JSON — keep statusText
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}
