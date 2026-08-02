import { api } from "./client";

export function createProject(body) {
  return api.post("/projects", body);
}

export function listMyProjects() {
  return api.get("/projects/mine");
}

export function getProject(id) {
  return api.get(`/projects/${id}`);
}

export function updateStage(projectId, stageId, body) {
  return api.patch(`/projects/${projectId}/stages/${stageId}`, body);
}

export function listReport() {
  return api.get("/projects/report");
}

export function deleteProject(id) {
  return api.delete(`/projects/${id}`);
}

export function listApprovals() {
  return api.get("/projects/approvals");
}

export function listComments(projectId, stageId) {
  return api.get(`/projects/${projectId}/stages/${stageId}/comments`);
}

export function addComment(projectId, stageId, text) {
  return api.post(`/projects/${projectId}/stages/${stageId}/comments`, { text });
}
