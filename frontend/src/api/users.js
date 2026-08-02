import { api } from "./client";

export function listUsers() {
  return api.get("/users");
}

export function createUser(email, password, role) {
  return api.post("/users", { email, password, role });
}

export function updateUser(id, body) {
  return api.patch(`/users/${id}`, body);
}
