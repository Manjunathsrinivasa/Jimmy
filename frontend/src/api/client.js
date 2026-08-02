import { useAuthStore } from "../store/authStore";

// Requests go through the Vite dev proxy at /api, which forwards to the
// Express backend (stripping the /api prefix). In production, VITE_API_URL
// points at the deployed backend (e.g. https://your-app.onrender.com) and is
// used as-is.
const BASE = import.meta.env.VITE_API_URL || "/api";

async function request(path, { method = "GET", body } = {}) {
  const { token } = useAuthStore.getState();
  const headers = { "Content-Type": "application/json" };
  if (token) {
    // Every future API call automatically carries the saved token.
    headers.Authorization = `Bearer ${token}`;
  }

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Could not reach the server. Is it running?");
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    // no response body
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }
  return data;
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  put: (path, body) => request(path, { method: "PUT", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
};
