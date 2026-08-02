import { api } from "./client";

// Org-wide sidebar navigation order (array of page keys, or null = default).
export function getNavOrder() {
  return api.get("/settings/nav");
}

export function setNavOrder(order) {
  return api.put("/settings/nav", { order });
}

// Org-wide Overview card order (array of stat keys, or null = default).
export function getOverviewOrder() {
  return api.get("/settings/overview");
}

export function setOverviewOrder(order) {
  return api.put("/settings/overview", { order });
}
