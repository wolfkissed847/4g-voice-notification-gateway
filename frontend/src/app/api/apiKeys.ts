import { apiRequest } from "./client";
import type { ApiKey, ApiKeyCreateResponse, ApiKeyUpdate } from "../types";

export function listApiKeys(): Promise<ApiKey[]> {
  return apiRequest<ApiKey[]>("/api-keys");
}

/**
 * สร้าง key ประจำอุปกรณ์ 1 ตัว
 * `name` = ชื่ออุปกรณ์ (backend เอาไปเติม {device} ในข้อความเสียงให้เอง)
 * `eventTypeIds` = การแจ้งเตือนที่อุปกรณ์นี้ยิงได้ — ถ้าว่างไว้ อุปกรณ์จะยิงอะไรไม่ได้เลย (ได้ 403)
 * plaintext_key ใน response แสดงให้ผู้ใช้เห็นได้ครั้งเดียว หลังจากนี้ backend เหลือแต่ sha256 hash
 */
export function createApiKey(name: string, eventTypeIds: number[] = []): Promise<ApiKeyCreateResponse> {
  return apiRequest<ApiKeyCreateResponse>("/api-keys", {
    method: "POST",
    body: { name, event_type_ids: eventTypeIds },
  });
}

/** แก้ชื่ออุปกรณ์ / สิทธิ์การแจ้งเตือน โดย key เดิมยังใช้ได้ต่อ — ไม่ต้องแฟลช firmware ใหม่ */
export function updateApiKey(id: number, patch: ApiKeyUpdate): Promise<ApiKey> {
  return apiRequest<ApiKey>(`/api-keys/${id}`, { method: "PUT", body: patch });
}

/** ลบอุปกรณ์ออกจากฐานข้อมูลจริง เอากลับไม่ได้ — ประวัติการโทรเดิมยังอยู่ครบ */
export function deleteApiKey(id: number): Promise<void> {
  return apiRequest<void>(`/api-keys/${id}`, { method: "DELETE" });
}
