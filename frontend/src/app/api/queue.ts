import { apiRequest } from "./client";
import type { QueueStatusResponse } from "../types";

export function getQueueStatus(): Promise<QueueStatusResponse> {
  return apiRequest<QueueStatusResponse>("/queue/status");
}
