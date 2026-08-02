import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listPipelines, getPipeline } from "../api/pipelines";
import { listUsers } from "../api/users";
import { createProject } from "../api/projects";
import FieldControl from "../components/FieldControl";
import AppLayout from "../components/AppLayout";

// Fields marked as "input" in the pipeline builder: these are asked for when
// creating a new project and become the stage's initial field values.
function deriveInputGroups(pipeline) {
  const nodes = pipeline.nodes || [];
  const groups = [];
  for (const n of nodes) {
    const fields = (n.fields || []).filter((f) => f.config && f.config.input);
    if (fields.length > 0) {
      groups.push({ nodeId: n.id, label: n.label || "Stage", fields });
    }
  }
  return groups;
}

// Each parallel_fork node's "branches" are the nodes its outgoing edges point
// to (e.g. the seeded "Developers" fork -> Developer 1 / Developer 2).
function deriveForks(pipeline) {
  const nodes = pipeline.nodes || [];
  const edges = pipeline.edges || [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const forks = [];
  for (const n of nodes) {
    if (n.type !== "parallel_fork") continue;
    const branches = edges
      .filter((e) => e.sourceNodeId === n.id)
      .map((e) => byId.get(e.targetNodeId))
      .filter(Boolean)
      .map((b) => ({ nodeId: b.id, label: b.label || "Branch" }));
    forks.push({
      nodeId: n.id,
      label: n.label || "Parallel Fork",
      kind: "fork",
      branches: branches.length > 0 ? branches : [{ nodeId: null, label: "Branch 1" }],
    });
  }
  return forks;
}

// Approval-type nodes need an approver assigned at project creation — the
// Approvals page lists these stages for the assigned user.
function deriveApprovals(pipeline) {
  return (pipeline.nodes || [])
    .filter((n) => n.type === "approval")
    .map((n) => ({ nodeId: n.id, label: n.label || "Approval", kind: "approval" }));
}

export default function NewProject() {
  const navigate = useNavigate();

  const [pipelines, setPipelines] = useState(null); // published only
  const [users, setUsers] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [pipelineId, setPipelineId] = useState("");
  const [pipelineDetail, setPipelineDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  // nodeId -> array of chosen userIds for fork branches / approval approvers.
  const [inputValues, setInputValues] = useState({});
  const [name, setName] = useState("");
  const [client, setClient] = useState("");
  const [budget, setBudget] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [managerId, setManagerId] = useState("");
  // forkNodeId -> array of chosen userIds (one per branch, in branch order)
  const [forkAssignees, setForkAssignees] = useState({});

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([listPipelines(), listUsers()])
      .then(([pData, uData]) => {
        if (cancelled) return;
        setPipelines(pData.pipelines.filter((p) => p.status === "published"));
        setUsers(uData.users);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the chosen pipeline's graph so we can derive fork branches + versionId.
  useEffect(() => {
    if (!pipelineId) {
      setPipelineDetail(null);
      setForkAssignees({});
      setInputValues({});
      return;
    }
    let cancelled = false;
    // Clear the previous pipeline's detail so a stale submit can never happen.
    setPipelineDetail(null);
    setForkAssignees({});
    setInputValues({});
    setDetailLoading(true);
    getPipeline(pipelineId)
      .then((d) => {
        if (cancelled) return;
        setPipelineDetail(d.pipeline);
        const initial = {};
        deriveForks(d.pipeline).forEach((f) => {
          initial[f.nodeId] = f.branches.map(() => "");
        });
        setForkAssignees(initial);
        // Pre-fill input fields with their configured default value.
        const iv = {};
        for (const g of deriveInputGroups(d.pipeline)) {
          iv[g.nodeId] = {};
          for (const f of g.fields) {
            iv[g.nodeId][f.id] =
              f.config && f.config.defaultValue !== undefined && f.config.defaultValue !== ""
                ? f.config.defaultValue
                : "";
          }
        }
        setInputValues(iv);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineId]);

  const forks = useMemo(() => (pipelineDetail ? deriveForks(pipelineDetail) : []), [pipelineDetail]);
  const approvals = useMemo(
    () => (pipelineDetail ? deriveApprovals(pipelineDetail) : []),
    [pipelineDetail]
  );
  const inputGroups = useMemo(
    () => (pipelineDetail ? deriveInputGroups(pipelineDetail) : []),
    [pipelineDetail]
  );

  // Forks where the same user was picked for more than one branch.
  const duplicateWarnings = useMemo(() => {
    const out = {};
    for (const f of forks) {
      const chosen = (forkAssignees[f.nodeId] || []).filter(Boolean);
      const seen = new Set();
      let dup = null;
      for (const id of chosen) {
        if (seen.has(id)) dup = id;
        seen.add(id);
      }
      if (dup) {
        const u = users?.find((x) => x.id === dup);
        out[f.nodeId] = u?.email || "that person";
      }
    }
    return out;
  }, [forks, forkAssignees, users]);

  function setBranchAssignee(forkNodeId, branchIndex, value) {
    setForkAssignees((prev) => {
      const next = { ...prev };
      const arr = (next[forkNodeId] || []).slice();
      arr[branchIndex] = value;
      next[forkNodeId] = arr;
      return next;
    });
  }

  function setInputValue(nodeId, fieldId, value) {
    setInputValues((prev) => {
      const node = { ...(prev[nodeId] || {}) };
      node[fieldId] = value;
      return { ...prev, [nodeId]: node };
    });
  }

  function pickValidated() {
    if (!name.trim()) {
      setSubmitError("Project name is required");
      return null;
    }
    if (!managerId) {
      setSubmitError("Pick a project manager");
      return null;
    }
    if (!pipelineDetail) {
      setSubmitError("Pick a pipeline");
      return null;
    }
    // Only send forks/approvals that actually have at least one user assigned.
    const assignees = {};
    for (const f of [...forks, ...approvals]) {
      const chosen = (forkAssignees[f.nodeId] || []).filter(Boolean);
      if (chosen.length > 0) assignees[f.nodeId] = chosen;
    }
    // Collect the pipeline's "input" fields into initial stage values.
    const stageValues = {};
    for (const g of inputGroups) {
      const entries = [];
      for (const f of g.fields) {
        const v = (inputValues[g.nodeId] || {})[f.id];
        if (v === "" || v === null || v === undefined || (Array.isArray(v) && v.length === 0)) {
          continue;
        }
        entries.push({ fieldDefinitionId: f.id, value: v });
      }
      if (entries.length > 0) stageValues[g.nodeId] = entries;
    }
    return {
      pipelineVersionId: pipelineDetail.versionId,
      name: name.trim(),
      managerId,
      assignees,
      stageValues,
      client: client.trim() || null,
      budget: budget === "" ? null : Number(budget),
      startDate: startDate || null,
      endDate: endDate || null,
    };
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError("");
    const body = pickValidated();
    if (!body) return;
    setSubmitting(true);
    try {
      const data = await createProject(body);
      navigate(`/projects/${data.project.id}`);
    } catch (err) {
      setSubmitError(err.message);
      setSubmitting(false);
    }
  }

  return (
    <AppLayout title="New Project">
      <main className="page-shell max-w-3xl">
        {loadError && <p className="mb-4 text-sm text-red-600">{loadError}</p>}

        <form
          onSubmit={handleSubmit}
          className="card space-y-6 p-6"
        >
          {/* Pipeline */}
          <div>
            <label htmlFor="pipeline" className="block text-sm font-medium text-gray-700">
              Pipeline
            </label>
            <select
              id="pipeline"
              value={pipelineId}
              onChange={(e) => setPipelineId(e.target.value)}
              className="input mt-1"
            >
              <option value="">Select a published pipeline…</option>
              {pipelines === null ? (
                <option disabled>Loading…</option>
              ) : (
                pipelines.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))
              )}
            </select>
            {pipelines !== null && pipelines.length === 0 && (
              <p className="mt-1 text-xs text-gray-400">
                No published pipelines yet — publish one from the builder first.
              </p>
            )}
          </div>

          {/* Name */}
          <div>
            <label htmlFor="project-name" className="block text-sm font-medium text-gray-700">
              Project name
            </label>
            <input
              id="project-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Launch campaign"
              className="input mt-1"
            />
          </div>

          {/* Client + budget + dates */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="project-client" className="block text-sm font-medium text-gray-700">
                Client
              </label>
              <input
                id="project-client"
                type="text"
                value={client}
                onChange={(e) => setClient(e.target.value)}
                placeholder="e.g. Acme Corp"
                className="input mt-1"
              />
            </div>
            <div>
              <label htmlFor="project-budget" className="block text-sm font-medium text-gray-700">
                Budget
              </label>
              <input
                id="project-budget"
                type="number"
                min="0"
                step="any"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0.00"
                className="input mt-1"
              />
            </div>
            <div>
              <label htmlFor="project-start" className="block text-sm font-medium text-gray-700">
                Start date
              </label>
              <input
                id="project-start"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="input mt-1"
              />
            </div>
            <div>
              <label htmlFor="project-end" className="block text-sm font-medium text-gray-700">
                End date
              </label>
              <input
                id="project-end"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="input mt-1"
              />
            </div>
          </div>

          {/* Manager */}
          <div>
            <label htmlFor="manager" className="block text-sm font-medium text-gray-700">
              Project manager
            </label>
            <select
              id="manager"
              value={managerId}
              onChange={(e) => setManagerId(e.target.value)}
              className="input mt-1"
            >
              <option value="">Select a manager…</option>
              {users === null ? (
                <option disabled>Loading…</option>
              ) : (
                users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.email}
                  </option>
                ))
              )}
            </select>
          </div>

          {/* Fork branches + approval approvers */}
          {pipelineId && (
            <div>
              {detailLoading ? (
                <p className="text-sm text-gray-400">Loading pipeline…</p>
              ) : forks.length === 0 && approvals.length === 0 ? (
                <p className="card-inset px-3 py-2 text-xs text-gray-500">
                  This pipeline has no parallel branches or approvals to assign.
                </p>
              ) : (
                <>
                  {forks.map((f) => (
                    <div
                      key={f.nodeId}
                      className="card-inset border-amber-200 bg-amber-50/50 p-4"
                    >
                      <p className="text-sm font-medium text-gray-800">{f.label}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Assign one person per branch
                      </p>
                      {duplicateWarnings[f.nodeId] && (
                        <p className="mt-1.5 text-xs text-amber-700">
                          {duplicateWarnings[f.nodeId]} is picked for more than one branch.
                        </p>
                      )}
                      <div className="mt-3 space-y-3">
                        {f.branches.map((branch, i) => (
                          <div key={`${f.nodeId}-${i}`}>
                            <label
                              htmlFor={`branch-${f.nodeId}-${i}`}
                              className="block text-xs font-medium text-gray-600"
                            >
                              {branch.label}
                            </label>
                            <select
                              id={`branch-${f.nodeId}-${i}`}
                              value={(forkAssignees[f.nodeId] || [])[i] || ""}
                              onChange={(e) => setBranchAssignee(f.nodeId, i, e.target.value)}
                              className="select mt-1"
                            >
                              <option value="">Unassigned</option>
                              {users === null ? (
                                <option disabled>Loading…</option>
                              ) : users.length === 0 ? (
                                <option disabled>No users in the organization yet</option>
                              ) : (
                                users.map((u) => (
                                  <option key={u.id} value={u.id}>
                                    {u.email}
                                    {u.role ? ` — ${u.role}` : ""}
                                  </option>
                                ))
                              )}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Approval nodes — pick the approver */}
                  {approvals.map((a) => (
                    <div
                      key={a.nodeId}
                      className="card-inset border-teal-200 bg-teal-50/50 p-4"
                    >
                      <p className="text-sm font-medium text-gray-800">{a.label}</p>
                      <p className="mt-0.5 text-xs text-gray-500">
                        Pick the person who reviews and approves this step
                      </p>
                      <div className="mt-3">
                        <label
                          htmlFor={`approval-${a.nodeId}`}
                          className="block text-xs font-medium text-gray-600"
                        >
                          Approver
                        </label>
                        <select
                          id={`approval-${a.nodeId}`}
                          value={(forkAssignees[a.nodeId] || [])[0] || ""}
                          onChange={(e) => setBranchAssignee(a.nodeId, 0, e.target.value)}
                          className="select mt-1"
                        >
                          <option value="">Unassigned</option>
                          {users === null ? (
                            <option disabled>Loading…</option>
                          ) : users.length === 0 ? (
                            <option disabled>No users in the organization yet</option>
                          ) : (
                            users.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.email}
                                {u.role ? ` — ${u.role}` : ""}
                              </option>
                            ))
                          )}
                        </select>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Input fields — fields the pipeline marked as "input" are asked
              for here and become the stage's initial values. */}
          {pipelineId && !detailLoading && inputGroups.length > 0 && (
            <div className="card-inset border-indigo-200 bg-indigo-50/40 p-4">
              <p className="text-sm font-medium text-gray-800">Stage inputs</p>
              <p className="mt-0.5 text-xs text-gray-500">
                Fields the pipeline marked as inputs — these pre-fill the workflow.
              </p>
              <div className="mt-3 space-y-4">
                {inputGroups.map((g) => (
                  <div key={g.nodeId}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      {g.label}
                    </p>
                    <div className="mt-2 space-y-3">
                      {g.fields.map((f) => (
                        <div key={f.id}>
                          <label
                            htmlFor={`input-${g.nodeId}-${f.id}`}
                            className="block text-sm font-medium text-gray-700"
                          >
                            {f.label}
                            {f.required && <span className="ml-1 text-red-500">*</span>}
                          </label>
                          <FieldControl
                            f={f}
                            value={(inputValues[g.nodeId] || {})[f.id]}
                            onChange={(v) => setInputValue(g.nodeId, f.id, v)}
                            users={users || []}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {submitError && <p className="text-sm text-red-600">{submitError}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary w-full py-2.5"
          >
            {submitting ? "Creating…" : "Create Project"}
          </button>
        </form>
      </main>
    </AppLayout>
  );
}
