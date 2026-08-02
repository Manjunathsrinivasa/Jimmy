import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { listApprovals, updateStage } from "../api/projects";
import AppLayout from "../components/AppLayout";

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

// Filter groups for the toolbar. For an approval stage, "approved" and
// "done" are the same settled outcome — an approver saying yes (approved)
// or the stage being completed (done) both close the approval — so they are
// shown under one "Approved" filter.
const FILTERS = [
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

function matchesFilter(status, filter) {
  switch (filter) {
    case "pending":
      return ["pending", "in_progress", "blocked"].includes(status);
    case "approved":
      return status === "approved" || status === "done";
    case "rejected":
      return status === "rejected";
    default:
      return true;
  }
}

// Small read-only renderer for the approval's submitted field values.
function FieldValue({ f }) {
  const v = f.value;
  if (v === null || v === undefined || v === "") return null;
  let text = v;
  if (Array.isArray(v)) text = v.join(", ");
  else if (typeof v === "object") text = v.name || JSON.stringify(v);
  else if (typeof v === "boolean") text = v ? "Yes" : "No";
  return (
    <div className="flex gap-2 text-sm">
      <span className="w-40 shrink-0 truncate text-gray-500">{f.label}</span>
      <span className="min-w-0 flex-1 break-words font-medium text-gray-800">{String(text)}</span>
    </div>
  );
}

export default function Approvals() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";

  const [approvals, setApprovals] = useState(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("pending");
  const [query, setQuery] = useState("");
  const [projectFilter, setProjectFilter] = useState(""); // projectId or "" for all
  const [myTurn, setMyTurn] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = () => {
    let cancelled = false;
    listApprovals()
      .then((d) => {
        if (!cancelled) setApprovals(d.approvals);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(load, []);

  const awaiting = (a) => ["pending", "in_progress", "blocked"].includes(a.status);

  // Only the chosen approver (or an admin) may decide — the sender must wait
  // until the approver approves, per the approval workflow.
  const canDecide = (a) => isAdmin || (a.approver && a.approver.id === user?.id);
  // A rejected approval is re-opened by its sender (who resends it) or an
  // admin; the approver's part is decided.
  const canReopen = (a) => isAdmin || a.assignee?.id === user?.id;

  const filtered = useMemo(() => {
    if (!approvals) return [];
    const q = query.trim().toLowerCase();
    return approvals.filter((a) => {
      if (!matchesFilter(a.status, filter)) return false;
      if (projectFilter && a.projectId !== projectFilter) return false;
      if (myTurn && !(awaiting(a) && canDecide(a))) return false;
      if (!q) return true;
      const hay = [
        a.stageLabel,
        a.projectName,
        a.projectClient,
        a.assignee?.email,
        a.developer?.name,
        a.approver?.email,
        a.manager?.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [approvals, filter, query, projectFilter, myTurn, isAdmin, user]);

  async function decide(id, decision) {
    const approval = (approvals || []).find((a) => a.id === id);
    if (!approval) return;
    setBusyId(id);
    setNotice(null);
    try {
      await updateStage(approval.projectId, id, { status: decision });
      const noticeText =
        decision === "approved"
          ? `"${approval.stageLabel}" approved — the workflow advances.`
          : decision === "rejected"
            ? `"${approval.stageLabel}" rejected — the workflow stays on this step.`
            : `"${approval.stageLabel}" re-opened — it can be decided again.`;
      setNotice({ kind: "ok", text: noticeText });
      await load();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => {
    if (!approvals) return {};
    const out = {};
    for (const f of FILTERS) {
      out[f.key] = approvals.filter((a) => matchesFilter(a.status, f.key)).length;
    }
    return out;
  }, [approvals]);

  // Display label: a "done" approval is the same settled state as "approved".
  const statusLabel = (a) => (a.status === "done" ? "Approved" : STATUS_LABELS[a.status] || a.status);

  // Distinct projects with pending rows, for the project filter dropdown.
  const projectsList = useMemo(() => {
    if (!approvals) return [];
    const byId = new Map();
    for (const a of approvals) {
      if (!byId.has(a.projectId)) byId.set(a.projectId, a.projectName || "Unknown project");
    }
    return [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((x, y) => x.name.localeCompare(y.name));
  }, [approvals]);

  // If the filtered project disappears (e.g. it was deleted), drop the
  // filter instead of silently showing an empty list against a stale value.
  useEffect(() => {
    if (projectFilter && !projectsList.some((p) => p.id === projectFilter)) {
      setProjectFilter("");
    }
  }, [projectFilter, projectsList]);

  return (
    <AppLayout title="Approvals">
      <main className="page-shell max-w-4xl">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && (
          <p
            className={`mb-4 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
          >
            {notice.text}
          </p>
        )}

        {approvals === null && !error ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <>
            {/* Toolbar — search + status filter */}
            <div className="mb-4 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <svg
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search project, stage, assignee, approver…"
                    className="input py-1.5 pl-9 pr-3"
                  />
                </div>
                <select
                  value={projectFilter}
                  onChange={(e) => setProjectFilter(e.target.value)}
                  className="select w-auto py-1.5"
                  title="Filter by project"
                >
                  <option value="">All projects</option>
                  {projectsList.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setMyTurn((v) => !v)}
                  className={`btn rounded-lg ${
                    myTurn
                      ? "bg-indigo-600 text-white"
                      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                  title="Only approvals waiting on your decision"
                >
                  {myTurn ? "✓ " : ""}Awaiting my decision
                </button>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setFilter("")}
                  className={`btn rounded-lg ${
                    filter === ""
                      ? "bg-indigo-600 text-white"
                      : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  All ({approvals?.length ?? 0})
                </button>
                {FILTERS.map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`btn rounded-lg ${
                      filter === f.key
                        ? "bg-indigo-600 text-white"
                        : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    {f.label} ({counts[f.key] ?? 0})
                  </button>
                ))}
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="card-dashed p-10 text-center">
                <p className="text-sm text-gray-500">
                  No approvals match
                  {filter ? ` status "${filter}"` : ""}
                  {projectFilter ? ` project "${projectsList.find((p) => p.id === projectFilter)?.name || ""}"` : ""}
                  {query.trim() ? ` search "${query.trim()}"` : ""}.
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {filtered.map((a) => {
                  const assigned = a.developer ? a.developer.name : a.assignee ? a.assignee.email : "Unassigned";
                  return (
                    <li key={a.id} className="card">
                      <div className="flex items-start justify-between gap-3 px-5 py-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                                STATUS_STYLES[a.status] || "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {statusLabel(a)}
                            </span>
                            <Link
                              to={`/projects/${a.projectId}`}
                              className="truncate text-sm font-semibold text-indigo-600 hover:text-indigo-500"
                            >
                              {a.stageLabel}
                            </Link>
                          </div>
                          <p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-sm">
                            <svg
                              className="h-3.5 w-3.5 shrink-0 text-gray-400"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.5 2a1 1 0 100 2h9a1 1 0 100-2h-9zM5 11.5a1 1 0 011-1h2a1 1 0 010 2H6a1 1 0 01-1-1z" />
                            </svg>
                            <Link
                              to={`/projects/${a.projectId}`}
                              className="truncate font-semibold text-gray-800 hover:text-indigo-600"
                              title={`Open project: ${a.projectName}`}
                            >
                              {a.projectName}
                            </Link>
                            {a.projectClient && (
                              <span className="shrink-0 text-xs text-gray-400">· {a.projectClient}</span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-400">
                            Assignee: {assigned}
                            {a.approver ? ` · Approver: ${a.approver.email}` : " · no approver chosen yet"}
                            {a.manager ? ` · Manager: ${a.manager.email}` : ""}
                            {a.dueDate
                              ? ` · Due ${new Date(a.dueDate).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                              : ""}
                          </p>
                        </div>
                        {awaiting(a) && canDecide(a) && (
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              onClick={() => decide(a.id, "approved")}
                              disabled={busyId === a.id}
                              className="btn btn-success"
                            >
                              Approve
                            </button>
                            <button
                              onClick={() => decide(a.id, "rejected")}
                              disabled={busyId === a.id}
                              className="btn border border-rose-300 bg-rose-50 text-rose-700 hover:bg-rose-100"
                            >
                              Reject
                            </button>
                          </div>
                        )}
                        {awaiting(a) && !canDecide(a) && (
                          <span className="shrink-0 rounded-md bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-400">
                            Waiting on {a.approver ? a.approver.email : "the approver"}
                          </span>
                        )}
                        {a.status === "rejected" && canReopen(a) && (
                          <button
                            onClick={() => decide(a.id, "in_progress")}
                            disabled={busyId === a.id}
                            className="btn btn-secondary shrink-0"
                            title="Put the approval back in progress so it can be decided again"
                          >
                            Re-open
                          </button>
                        )}
                      </div>
                      {a.fields.some((f) => f.value !== null && f.value !== undefined && f.value !== "") ? (
                        <div className="border-t border-gray-100 px-5 py-3">
                          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                            Submitted fields
                          </p>
                          <div className="space-y-1">
                            {a.fields.map((f) => (
                              <FieldValue key={f.id} f={f} />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="border-t border-gray-100 px-5 py-3">
                          <p className="text-xs text-gray-400">No field values submitted for this approval yet.</p>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </main>
    </AppLayout>
  );
}
