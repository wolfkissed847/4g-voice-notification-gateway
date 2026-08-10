// ─── Shared types ─────────────────────────────────────────────────────────────
// Domain types mirror the FastAPI Pydantic schemas in app/schemas.py exactly —
// keep these two in sync when the backend contract changes.

export type Lang = "th" | "en";

// Real backend CallStatus enum values (app/database.py::CallStatus)
export type CallStatus =
  | "queued"
  | "in_progress"
  | "connected"
  | "no_answer"
  | "busy"
  | "retrying"
  | "escalated"
  | "failed";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse {
  access_token: string;
  token_type: string;
}

// ─── Queue ────────────────────────────────────────────────────────────────────

export interface QueueStatusItem {
  job_id: number;
  status: CallStatus;
  priority_group: string;
  retry_count: number;
  created_at: string;
}

/** ขั้นตอนย่อยที่ worker กำลังทำอยู่ — ละเอียดกว่า CallStatus ที่เก็บใน DB */
export type CallStep =
  | "preparing_audio"
  | "uploading_audio"
  | "dialing"
  | "playing"
  | "waiting_retry";

export interface QueueStatusResponse {
  total_pending: number;
  items: QueueStatusItem[];
  /** null = worker ว่างงาน */
  current_job_id: number | null;
  current_step: CallStep | null;
  /** ความคืบหน้าภายในขั้นตอนปัจจุบัน 0.0-1.0 (null = ขั้นนี้วัดไม่ได้) */
  current_progress: number | null;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export interface AppConfig {
  call_retry_count: number;
  call_retry_delay_seconds: number;
  call_ring_timeout_seconds: number;
}

export type AppConfigUpdate = Partial<AppConfig>;

// ─── Groups & contacts ────────────────────────────────────────────────────────

export interface Group {
  id: number;
  name: string;
  description: string | null;
  contact_count: number;
}

export interface Contact {
  id: number;
  group_id: number;
  name: string | null;
  phone_number: string;
  order_index: number;
}

// ─── Event types ──────────────────────────────────────────────────────────────

export interface EventType {
  id: number;
  code: string;
  display_name: string;
  message_template: string;
  group_id: number;
  group_name: string;
  is_active: boolean;
}

// ─── API keys ─────────────────────────────────────────────────────────────────

/** event type ที่ key นี้ได้รับอนุญาตให้ยิง (ย่อจาก EventType เต็ม) */
export interface ApiKeyEventTypeRef {
  id: number;
  code: string;
  display_name: string;
}

/**
 * 1 key = 1 อุปกรณ์ — `name` คือชื่ออุปกรณ์ที่ backend เอาไปเติม {device} ในข้อความเสียง
 * ไม่มี field key เต็ม เพราะ backend เก็บแค่ sha256 hash — plaintext เห็นครั้งเดียวตอนสร้าง
 */
export interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
  allowed_event_types: ApiKeyEventTypeRef[];
}

export interface ApiKeyCreateResponse extends ApiKey {
  plaintext_key: string;
}

export interface ApiKeyUpdate {
  name?: string;
  event_type_ids?: number[];
}

// ─── Test notify ──────────────────────────────────────────────────────────────

export interface NotifyResponse {
  job_id: number;
  status: string;
  message: string;
}

// ─── History ──────────────────────────────────────────────────────────────────

export interface HistoryItem {
  job_id: number;
  event_type_code: string | null;
  event_type_display_name: string | null;
  group_name: string;
  /** ชื่ออุปกรณ์ต้นทาง ณ ตอนสั่งโทร (null = สั่งทดสอบจาก dashboard) */
  source_device: string | null;
  message: string;
  status: CallStatus;
  retry_count: number;
  contact_index: number;
  created_at: string;
  updated_at: string;
  last_result: string | null;
  last_phone_masked: string | null;
  /** รายละเอียดผลลัพธ์ล่าสุด เช่น error message ตอนล้มเหลว (null = ไม่มี/ยังไม่เคยลองเลย) */
  last_detail: string | null;
}

export interface HistoryResponse {
  total_count: number;
  page: number;
  page_size: number;
  items: HistoryItem[];
}

// ─── System info ──────────────────────────────────────────────────────────────

export interface SystemInfo {
  app_version: string;
  worker_started_at: string | null;
  gsm_connected: boolean;
  gsm_port: string | null;
  db_size_bytes: number | null;
}

export interface GsmDetail {
  connected: boolean;
  signal_quality: number | null;
  operator: string | null;
  network_mode: string | null;
  port: string | null;
  updated_at: string | null;
  /** worker กำลังปิด/เปิดคลื่นวิทยุอยู่ตอนนี้ */
  restarting: boolean;
  /** ผลของการรีสตาร์ทครั้งล่าสุด */
  restart_result: 'ok' | 'failed' | null;
  restart_at: string | null;
}

export interface GsmRestartResponse {
  accepted: boolean;
  message: string;
}

export interface PiDetail {
  cpu_percent: number | null;
  mem_percent: number | null;
  mem_used_mb: number | null;
  mem_total_mb: number | null;
  cpu_temp_c: number | null;
}

export interface HistoryQuery {
  page?: number;
  page_size?: number;
  status?: string;
  group_id?: number;
  event_type_id?: number;
  date_from?: string;
  date_to?: string;
  q?: string;
}
