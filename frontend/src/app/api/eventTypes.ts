import { apiRequest } from "./client";
import type { EventType, NotifyResponse } from "../types";

export function listEventTypes(): Promise<EventType[]> {
  return apiRequest<EventType[]>("/event-types");
}

export function createEventType(data: {
  code: string;
  display_name: string;
  message_template: string;
}): Promise<EventType> {
  return apiRequest<EventType>("/event-types", { method: "POST", body: data });
}

export function updateEventType(
  id: number,
  data: {
    display_name?: string;
    message_template?: string;
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
  /** จำลองเป็นอุปกรณ์ตัวนี้ — บังคับ เพราะผู้รับสายถูกตัดสินที่คู่ (อุปกรณ์ + เหตุการณ์)
   *  ไม่มีอุปกรณ์ = ไม่มีทางรู้ว่าต้องโทรหาใคร และไม่มีค่าเริ่มต้นให้ถอยไปใช้แล้ว */
  device_id: number;
}): Promise<NotifyResponse> {
  return apiRequest<NotifyResponse>("/test/notify", { method: "POST", body: data });
}
