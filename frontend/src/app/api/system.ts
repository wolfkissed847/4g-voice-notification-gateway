import { apiRequest } from "./client";
import type { GsmDetail, GsmRestartResponse, PiDetail, SystemInfo } from "../types";

export function getSystemInfo(): Promise<SystemInfo> {
  return apiRequest<SystemInfo>("/system/info");
}

export function getGsmDetail(): Promise<GsmDetail> {
  return apiRequest<GsmDetail>("/system/gsm");
}

export function getPiDetail(): Promise<PiDetail> {
  return apiRequest<PiDetail>("/system/pi");
}

/** สั่งรีสตาร์ทโมดูล 4G — ตอบกลับทันทีโดยไม่รอให้เสร็จ (ใช้เวลาถึง 30 วิ)
 *  ให้ poll /system/gsm ดู restarting/restart_result เอาแทน */
export function restartGsm(): Promise<GsmRestartResponse> {
  return apiRequest<GsmRestartResponse>("/system/gsm/restart", { method: "POST" });
}
