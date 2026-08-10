import { apiRequest } from "./client";
import type { EventType, NotifyResponse } from "../types";

export function listEventTypes(): Promise<EventType[]> {
  return apiRequest<EventType[]>("/event-types");
}

export function createEventType(data: {
  code: string;
  display_name: string;
  message_template: string;
  /** null = ไม่ระบุกลุ่มเริ่มต้น (กลุ่มจริงตั้งรายอุปกรณ์ที่หน้าอุปกรณ์ & key) */
  group_id?: number | null;
}): Promise<EventType> {
  return apiRequest<EventType>("/event-types", { method: "POST", body: data });
}

export function updateEventType(
  id: number,
  data: {
    display_name?: string;
    message_template?: string;
    group_id?: number | null;
    is_active?: boolean;
  }
): Promise<EventType> {
  return apiRequest<EventType>(`/event-types/${id}`, { method: "PUT", body: data });
}

export function deleteEventType(id: number): Promise<void> {
  return apiRequest<void>(`/event-types/${id}`, { method: "DELETE" });
}

export function sendTestNotify(data: {
  event_type_code: string;
  message?: string;
  variables?: Record<string, string>;
}): Promise<NotifyResponse> {
  return apiRequest<NotifyResponse>("/test/notify", { method: "POST", body: data });
}
