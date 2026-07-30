import { apiRequest } from "./client";
import type { GsmDetail, PiDetail, SystemInfo } from "../types";

export function getSystemInfo(): Promise<SystemInfo> {
  return apiRequest<SystemInfo>("/system/info");
}

export function getGsmDetail(): Promise<GsmDetail> {
  return apiRequest<GsmDetail>("/system/gsm");
}

export function getPiDetail(): Promise<PiDetail> {
  return apiRequest<PiDetail>("/system/pi");
}
