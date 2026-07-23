// API client — คุยกับ FastAPI backend
// token เก็บใน localStorage (single-user dashboard ภายในองค์กร ความเสี่ยงต่ำกว่า multi-tenant app ทั่วไป)

const TOKEN_KEY = "gateway_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Session หมดอายุ กรุณา login ใหม่");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ detail: "เกิดข้อผิดพลาด" }));
    throw new Error(body.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

export interface QueueItem {
  job_id: number;
  status: string;
  priority_group: string;
  retry_count: number;
  created_at: string;
}

export interface QueueStatus {
  total_pending: number;
  items: QueueItem[];
}

export interface AppConfig {
  call_retry_count: number;
  call_retry_delay_seconds: number;
  call_ring_timeout_seconds: number;
  sms_fallback_enabled: boolean;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),

  getQueueStatus: () => request<QueueStatus>("/queue/status"),

  getConfig: () => request<AppConfig>("/config"),

  updateConfig: (partial: Partial<AppConfig>) =>
    request<AppConfig>("/config", {
      method: "PUT",
      body: JSON.stringify(partial),
    }),
};
