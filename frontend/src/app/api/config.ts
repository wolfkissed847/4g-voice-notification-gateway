import { apiRequest } from "./client";
import type { AppConfig, AppConfigUpdate } from "../types";

export function getConfig(): Promise<AppConfig> {
  return apiRequest<AppConfig>("/config");
}

export function updateConfig(patch: AppConfigUpdate): Promise<AppConfig> {
  return apiRequest<AppConfig>("/config", { method: "PUT", body: patch });
}
