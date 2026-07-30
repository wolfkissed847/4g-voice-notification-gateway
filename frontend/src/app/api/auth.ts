import { apiRequest } from "./client";
import type { LoginResponse } from "../types";

export function login(username: string, password: string): Promise<LoginResponse> {
  return apiRequest<LoginResponse>("/auth/login", {
    method: "POST",
    body: { username, password },
    auth: false,
  });
}
