import { apiRequest } from "./client";
import type { HistoryQuery, HistoryResponse } from "../types";

export function getHistory(query: HistoryQuery): Promise<HistoryResponse> {
  return apiRequest<HistoryResponse>("/history", { query: query as Record<string, string | number> });
}
