import { apiRequest } from "./client";
import type { QueueStatusItem, QueueStatusResponse } from "../types";

export function getQueueStatus(): Promise<QueueStatusResponse> {
  return apiRequest<QueueStatusResponse>("/queue/status");
}

/**
 * ยกเลิกงานในคิวทีละใบ
 *
 * POST ไม่ใช่ DELETE เพราะงานไม่ได้ถูกลบ — เปลี่ยนสถานะเป็น cancelled แล้วยังอยู่ใน
 * ประวัติการโทร ให้ตรวจย้อนหลังได้ว่าเคยมีเหตุนี้เข้ามาแล้วคนสั่งไม่ให้โทร
 *
 * 409 = worker หยิบไปโทรแล้ว หยุดสายที่กำลังดังไม่ได้ (ข้อความจาก backend อธิบายเอง)
 */
export function cancelQueueJob(jobId: number): Promise<QueueStatusItem> {
  return apiRequest<QueueStatusItem>(`/queue/${jobId}/cancel`, { method: "POST" });
}
