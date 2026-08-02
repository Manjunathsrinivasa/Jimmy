import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAuthStore } from "../store/authStore";
import { getProject, updateStage, deleteProject } from "../api/projects";
import StageForm from "../components/StageForm";
import StageComments from "../components/StageComments";
import ApprovalStagePanel from "../components/ApprovalStagePanel";
import FlowNode from "../components/FlowNode";
import AppLayout from "../components/AppLayout";

const NODE_TYPES = {
  start: FlowNode,
  stage: FlowNode,
  parallel_fork: FlowNode,
  parallel_join: FlowNode,
  decision: FlowNode,
  approval: FlowNode,
  end: FlowNode,
};

const STATUS_STYLES = {
  pending: "bg-gray-100 text-gray-600",
  in_progress: "bg-sky-100 text-sky-700",
  blocked: "bg-red-100 text-red-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  done: "bg-emerald-100 text-emerald-700",
};

const STATUS_LABELS = {
  pending: "Pending",
  in_progress: "In progress",
  blocked: "Blocked",
  approved: "Approved",
  rejected: "Rejected",
  done: "Done",
};

function formatDate(d) {
  if (!d) return "";
  const date = new Date(d);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Nodes that can reach `startNodeId` through the flow's edges (reverse
// reachability) — the connected previous stages whose field values a
// stage's conditional logic may reference.
function connectedAncestors(edges, startNodeId) {
  const reverse = new Map();
  for (const e of edges || []) {
    if (!reverse.has(e.targetNodeId)) reverse.set(e.targetNodeId, []);
    reverse.get(e.targetNodeId).push(e.sourceNodeId);
  }
  const seen = new Set([startNodeId]);
  const stack = [startNodeId];
  const ancestors = new Set();
  while (stack.length > 0) {
    const id = stack.pop();
    for (const src of reverse.get(id) || []) {
      if (!seen.has(src)) {
        seen.add(src);
        ancestors.add(src);
        stack.push(src);
      }
    }
  }
  return ancestors;
}

// Stage assignee label: a developer from a legacy project wins over a user
// email (fork branches were previously assigned developers).
function assigneeLabel(s) {
  if (s.developer) return s.developer.name;
  if (s.assignee) return s.assignee.email;
  return "Unassigned";
}

// Read-only flow canvas with the current stage pulsing. Auto-centers on the
// active node whenever the active stage changes; a horizontal scrollbar
// appears when the graph is wider than the window.
function ReadOnlyFlow({ nodes, edges, activeNodeIds, graphKey }) {
  const { fitView } = useReactFlow();
  const activeKey = useMemo(() => [...activeNodeIds].sort().join(","), [activeNodeIds]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (activeNodeIds.size > 0) {
        fitView({
          nodes: [...activeNodeIds].map((id) => ({ id })),
          padding: 0.35,
          maxZoom: 1.1,
          duration: 600,
        });
      } else {
        fitView({ padding: 0.2 });
      }
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey, graphKey, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      nodesConnectable={false}
      nodesDraggable={false}
      elementsSelectable={false}
      panOnDrag
      zoomOnScroll
      fitView
      minZoom={0.15}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
    </ReactFlow>
  );
}

function ProjectDetailInner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);

  const [project, setProject] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [adminStageId, setAdminStageId] = useState(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    getProject(id)
      .then((d) => {
        if (!cancelled) setProject(d.project);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => load(), [load]);

  // Active stage(s): anything currently "in_progress"; before the workflow has
  // started, the first not-done stage is the active frontier.
  const activeStages = useMemo(() => {
    if (!project) return [];
    const stages = project.stages;
    const inProgress = stages.filter((s) => s.status === "in_progress");
    if (inProgress.length > 0) return inProgress;
    const first = stages.find((s) => s.status !== "done" && s.status !== "approved");
    if (!first) return [];
    return stages.filter(
      (s) => s.status !== "done" && s.status !== "approved" && s.node.id === first.node.id
    );
  }, [project]);

  const activeStageIds = useMemo(() => new Set(activeStages.map((s) => s.id)), [activeStages]);
  const activeNodeIds = useMemo(
    () => new Set(activeStages.map((s) => s.node.id)),
    [activeStages]
  );

  const isAdmin = user?.role === "admin";
  const myStage = activeStages.find((s) => s.assignee?.id === user?.id) || null;
  const adminStage = isAdmin ? activeStages[0] || null : null;
  const workStage = myStage || adminStage;

  // Admins can open ANY stage and edit its fields (defaults to the current
  // one). Everyone else only ever sees their own active stage.
  const editingStage = useMemo(() => {
    if (!project) return workStage;
    if (!isAdmin) return workStage;
    return (
      project.stages.find((s) => s.id === adminStageId) || workStage || project.stages[0] || null
    );
  }, [project, isAdmin, adminStageId, workStage]);

  // Variables for a stage's conditional logic: field values from connected
  // previous stages only (no future stages, no unrelated branches). Computed
  // per form — the center "Current stage" form uses the workStage's ancestors
  // while the admin edit form uses the admin-selected stage's, so cross-stage
  // conditions always evaluate against the right stage.
  const conditionVariablesFor = useCallback(
    (stage) => {
      if (!project || !stage) return {};
      const ancestors = connectedAncestors(project.flow?.edges, stage.node.id);
      const vars = {};
      for (const s of project.stages) {
        if (!ancestors.has(s.node.id)) continue;
        for (const f of s.fields || []) {
          if (f.value !== null && f.value !== undefined && f.value !== "") {
            vars[f.id] = f.value;
          }
        }
      }
      return vars;
    },
    [project]
  );

  const workStageVariables = useMemo(
    () => conditionVariablesFor(workStage),
    [conditionVariablesFor, workStage]
  );
  const adminStageVariables = useMemo(
    () => conditionVariablesFor(editingStage),
    [conditionVariablesFor, editingStage]
  );

  // Read-only flow graph, derived from the pipeline's stored graph. The node
  // currently in progress pulses; done nodes carry their stage status.
  const graphKey = useMemo(() => {
    if (!project) return "";
    return `${project.id}|${project.stages.map((s) => s.status).join(",")}`;
  }, [project]);

  const flowNodes = useMemo(() => {
    if (!project) return [];
    return (project.flow?.nodes || []).map((n) => {
      const stage = project.stages.find((s) => s.node.id === n.id);
      return {
        id: n.id,
        type: n.type,
        position: { x: n.positionX ?? 0, y: n.positionY ?? 0 },
        data: {
          label: n.label || "",
          nodeType: n.type,
          active: activeNodeIds.has(n.id),
          status: stage?.status,
          fields: [],
        },
      };
    });
  }, [project, activeNodeIds]);

  const flowEdges = useMemo(() => {
    if (!project) return [];
    return (project.flow?.edges || []).map((e) => ({
      id: e.id,
      source: e.sourceNodeId,
      target: e.targetNodeId,
      label: e.label || undefined,
    }));
  }, [project]);

  async function handleStageSubmitted(fieldValues) {
    if (!workStage) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateStage(id, workStage.id, { status: "done", fieldValues });
      setNotice({ kind: "ok", text: `"${workStage.node.label}" marked done.` });
      await load();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // Admin: save a stage's field values without forcing a status change, so
  // they can edit any stage's fields (the backend already allows admins).
  async function handleAdminSave(fieldValues) {
    if (!editingStage) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateStage(id, editingStage.id, { fieldValues });
      setNotice({ kind: "ok", text: `"${editingStage.node.label}" fields saved.` });
      await load();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // Approval stages: assign the chosen approver (send / resend). The stage
  // then waits — only the approver (or an admin) may decide. The stage is
  // passed through because the same panel also renders for the admin's
  // selected stage in the left pane. Resending also resets the status back
  // to in_progress, so a stage rejected earlier becomes decidable again.
  async function handleSendApproval(stage, approverId) {
    if (!stage) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateStage(id, stage.id, { approverId, status: "in_progress" });
      setNotice({ kind: "ok", text: `Approval sent — waiting on the approver.` });
      await load();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  // Approval stages: the approver (or admin) decides. Approving unlocks the
  // next stage; rejecting keeps the workflow here so the sender can resend.
  async function handleDecideApproval(stage, status) {
    if (!stage) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateStage(id, stage.id, { status });
      setNotice({
        kind: "ok",
        text:
          status === "approved"
            ? `"${stage.node.label}" approved — the workflow advances.`
            : `"${stage.node.label}" rejected — the sender can resend.`,
      });
      await load();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteProject() {
    if (!window.confirm(`Delete project "${project?.name}"? This cannot be undone.`)) return;
    setBusy(true);
    setNotice(null);
    try {
      await deleteProject(id);
      navigate("/dashboard");
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
      setBusy(false);
    }
  }

  const isDone =
    project &&
    project.stages.length > 0 &&
    project.stages.every((s) => s.status === "done" || s.status === "approved");

  return (
    <AppLayout title={project ? project.name : "Project"}>
      <main className="mx-auto max-w-7xl px-4 py-6">
        {loading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : error ? (
          <div>
            <p className="text-sm text-red-600">{error}</p>
            <Link to="/dashboard" className="mt-2 inline-block text-sm font-medium text-indigo-600 hover:text-indigo-500">
              ← Back to dashboard
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>
                Pipeline: <span className="font-medium text-gray-900">{project.pipelineName}</span>
              </span>
              <span>
                Manager: <span className="font-medium text-gray-900">{project.manager?.email}</span>
              </span>
              {project.client && (
                <span>
                  Client: <span className="font-medium text-gray-900">{project.client}</span>
                </span>
              )}
              <span className="text-gray-400">{project.stages.length} stages</span>
              {(isAdmin || project.managerId === user?.id) && (
                <button
                  onClick={handleDeleteProject}
                  disabled={busy}
                  className="ml-auto rounded-md border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  title="Delete this project (admin or manager)"
                >
                  Delete project
                </button>
              )}
            </div>

            {notice && (
              <p
                className={`mb-4 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
              >
                {notice.text}
              </p>
            )}

            {/* ===== Top: read-only pipeline graph (current stage pulsing) ===== */}
            <div className="card overflow-x-auto">
              <div
                style={{
                  width: Math.max(640, (flowNodes.length + 1) * 200),
                  height: 360,
                }}
              >
                <ReactFlowProvider>
                  <ReadOnlyFlow
                    nodes={flowNodes}
                    edges={flowEdges}
                    activeNodeIds={activeNodeIds}
                    graphKey={graphKey}
                  />
                </ReactFlowProvider>
              </div>
              <div className="border-t border-gray-100 px-4 py-2 text-[11px] text-gray-400">
                Scroll sideways if the workflow runs wider than the window · the pulsing node is the
                current stage
              </div>
            </div>

            {/* ===== Below: admin edit (leftmost for admins) + current stage + stages ===== */}
            <div
              className={`mt-6 grid items-start gap-6 ${
                isAdmin ? "lg:grid-cols-3" : "lg:grid-cols-2"
              }`}
            >
              {/* Admin — edit any stage (own section on the left, admins only) */}
              {isAdmin && (
                <section className="card p-6">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
                        Admin — edit any stage
                      </p>
                      <h3 className="mt-0.5 text-sm font-semibold text-gray-800">
                        {editingStage?.node.label || "Select a stage"}
                      </h3>
                    </div>
                    <select
                      value={editingStage?.id || ""}
                      onChange={(e) => setAdminStageId(e.target.value)}
                      className="input px-2 py-1.5 text-xs"
                    >
                      {project.stages.map((s, i) => (
                        <option key={s.id} value={s.id}>
                          Stage {i + 1} — {s.node.label} ({STATUS_LABELS[s.status] || s.status})
                        </option>
                      ))}
                    </select>
                  </div>
                  {editingStage && editingStage.id !== workStage?.id ? (
                    <>
                      <div className="mt-4">
                        {editingStage.node.type === "approval" ? (
                          <ApprovalStagePanel
                            key={editingStage.id}
                            stage={editingStage}
                            busy={busy}
                            onSend={handleSendApproval}
                            onDecide={handleDecideApproval}
                          />
                        ) : (
                          <StageForm
                            key={editingStage.id}
                            stage={editingStage}
                            onSubmitted={handleAdminSave}
                            busy={busy}
                            variables={adminStageVariables}
                            submitLabel="Save changes"
                          />
                        )}
                      </div>
                      {/* Admin reviewing a different stage — its thread sits below the form */}
                      <div className="mt-5 border-t border-gray-100 pt-4">
                        <StageComments projectId={project.id} stageId={editingStage.id} />
                      </div>
                    </>
                  ) : (
                    <p className="mt-3 text-xs text-gray-400">
                      The current stage is editable in the center column — pick another stage to
                      edit it here.
                    </p>
                  )}
                </section>
              )}

              {/* Current stage window */}
              <section className="card p-6">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Current stage
                </p>
                {workStage ? (
                  <>
                    <h2 className="mt-1 text-lg font-semibold text-gray-900">
                      {workStage.node.label}
                    </h2>
                    <p className="text-xs text-gray-400">
                      Assigned to {assigneeLabel(workStage)}
                    </p>
                    <div className="mt-4">
                      {workStage.node.type === "approval" ? (
                        <ApprovalStagePanel
                          key={workStage.id}
                          stage={workStage}
                          busy={busy}
                          onSend={handleSendApproval}
                          onDecide={handleDecideApproval}
                        />
                      ) : (
                        <StageForm
                          key={workStage.id}
                          stage={workStage}
                          onSubmitted={handleStageSubmitted}
                          busy={busy}
                          variables={workStageVariables}
                        />
                      )}
                    </div>

                    {/* Stage thread — visible to anyone connected to the project */}
                    <div className="mt-6 border-t border-gray-100 pt-5">
                      <StageComments projectId={project.id} stageId={workStage.id} />
                    </div>
                  </>
                ) : activeStages.length > 0 ? (
                  <>
                    <p className="mt-3 text-sm text-gray-500">
                      No action needed from you right now — the active stage is assigned to someone
                      else.
                    </p>
                    {/* Connected viewers can still follow / join the discussion */}
                    <div className="mt-5 border-t border-gray-100 pt-4">
                      <StageComments projectId={project.id} stageId={activeStages[0].id} />
                    </div>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-emerald-700">
                    {isDone ? "All stages are complete. 🎉" : "No active stage right now."}
                  </p>
                )}
              </section>

              {/* Right — stages window */}
              <section className="card">
                <div className="border-b border-gray-100 px-5 py-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Stages
                  </p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    {project.stages.length} total ·{" "}
                    {project.stages.filter((s) => s.status === "done" || s.status === "approved").length}{" "}
                    done
                  </p>
                </div>
                <ul className="max-h-[28rem] divide-y divide-gray-100 overflow-y-auto">
                  {project.stages.map((s, i) => (
                    <li
                      key={s.id}
                      className={`flex items-center justify-between px-5 py-3 ${
                        activeNodeIds.has(s.node.id) ? "bg-indigo-50/60" : ""
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="w-6 text-right text-xs text-gray-300">{i + 1}</span>
                        <div>
                          <p className="text-sm font-medium text-gray-800">{s.node.label}</p>
                          <p className="text-xs text-gray-400">{assigneeLabel(s)}</p>
                        </div>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[s.status] || "bg-gray-100 text-gray-600"
                        }`}
                      >
                        {STATUS_LABELS[s.status] || s.status}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </main>
    </AppLayout>
  );
}

export default function ProjectDetail() {
  return <ProjectDetailInner />;
}
