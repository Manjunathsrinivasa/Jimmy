import { api } from "./client";

export function login(email, password) {
  return api.post("/auth/login", { email, password });
}

export function register(email, password) {
  return api.post("/auth/register", { email, password });
}

export function changePassword(currentPassword, newPassword) {
  return api.post("/auth/change-password", { currentPassword, newPassword });
}
