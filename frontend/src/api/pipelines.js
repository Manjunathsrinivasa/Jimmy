import { api } from "./client";

export function listPipelines() {
  return api.get("/pipelines");
}

export function getPipeline(id) {
  return api.get(`/pipelines/${id}`);
}

export function renamePipeline(id, name) {
  return api.patch(`/pipelines/${id}`, { name });
}

export function createPipeline(body) {
  return api.post("/pipelines", body);
}

export function saveDraft(id, graph) {
  return api.put(`/pipelines/${id}`, graph);
}

export function publishPipeline(id) {
  return api.post(`/pipelines/${id}/publish`, {});
}

export function unpublishPipeline(id) {
  return api.post(`/pipelines/${id}/unpublish`, {});
}

export function archivePipeline(id) {
  return api.post(`/pipelines/${id}/archive`, {});
}

export function unarchivePipeline(id) {
  return api.post(`/pipelines/${id}/unarchive`, {});
}

export function clonePipeline(id, name) {
  return api.post(`/pipelines/${id}/clone`, { name });
}

export function deletePipeline(id) {
  return api.delete(`/pipelines/${id}`);
}

export function listVersions(id) {
  return api.get(`/pipelines/${id}/versions`);
}

export function restoreVersion(id, versionId) {
  return api.post(`/pipelines/${id}/restore-version`, { versionId });
}
