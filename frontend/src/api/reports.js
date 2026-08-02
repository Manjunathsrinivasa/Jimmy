import { api } from "./client";

export function listReports() {
  return api.get("/reports");
}

export function listReportPipelines() {
  return api.get("/reports/pipelines");
}

export function createReport(body) {
  return api.post("/reports", body);
}

export function updateReport(id, body) {
  return api.patch(`/reports/${id}`, body);
}

export function deleteReport(id) {
  return api.delete(`/reports/${id}`);
}
