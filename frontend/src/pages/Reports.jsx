import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { listReport } from "../api/projects";
import {
  listReports,
  listReportPipelines,
  createReport,
  updateReport,
  deleteReport,
} from "../api/reports";
import { listUsers } from "../api/users";
import { useAuthStore } from "../store/authStore";
import AppLayout from "../components/AppLayout";

// Built-in project-level columns (always available, independent of pipelines).
const PROJECT_COLUMNS = [
  { key: "name", label: "Project Name", kind: "project" },
  { key: "client", label: "Client", kind: "project" },
  { key: "currentStage", label: "Current Stage", kind: "project" },
  { key: "status", label: "Status", kind: "project" },
  { key: "manager", label: "Assigned User", kind: "project" },
  { key: "developers", label: "Assigned Developers", kind: "project" },
  { key: "budget", label: "Budget", kind: "project" },
  { key: "startDate", label: "Start Date", kind: "project" },
  { key: "endDate", label: "End Date", kind: "project" },
  { key: "completion", label: "Completion %", kind: "project" },
  { key: "lastModified", label: "Last Modified", kind: "project" },
];

// New reports start with the project columns (fields are picked per pipeline).
const DEFAULT_COLUMNS = PROJECT_COLUMNS.map((c) => ({ ...c }));

const FIELD_TYPE_DOTS = {
  text: "bg-gray-400",
  textarea: "bg-gray-400",
  number: "bg-blue-500",
  currency: "bg-emerald-500",
  date: "bg-indigo-500",
  dropdown: "bg-violet-500",
  multiselect: "bg-violet-500",
  file: "bg-amber-500",
  user_picker: "bg-teal-500",
  checkbox: "bg-pink-500",
};

const STATUS_BADGE = {
  active: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

function displayValue(row, col) {
  const key = col.key;
  if (col.kind === "field") {
    const v = row.fieldValues ? row.fieldValues[key] : undefined;
    if (Array.isArray(v)) return v.join(", ");
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return v.name || JSON.stringify(v);
    return String(v);
  }
  if (key === "developers") return (row.developers || []).join(", ");
  if (key === "budget") return row.budget != null ? `$${Number(row.budget).toFixed(2)}` : "";
  if (key === "completion") return row.completion != null ? `${row.completion}%` : "";
  if (key === "startDate" || key === "endDate" || key === "lastModified") {
    return row[key] ? new Date(row[key]).toLocaleDateString() : "";
  }
  return row[key] ?? "";
}

function downloadCSV(filename, rows, cols) {
  const escape = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = cols.map((c) => escape(c.label)).join(",");
  const body = rows
    .map((r) => cols.map((c) => escape(displayValue(r, c))).join(","))
    .join("\n");
  const csv = `\uFEFF${header}\n${body}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Pipeline-scoped field picker: fields of ONE pipeline, grouped by stage.
// Draft + published versions of the same pipeline duplicate fields, so dedupe
// by label within a stage.
function fieldGroupsForPipeline(fields, pipelineId) {
  const map = new Map(); // nodeLabel -> fields[]
  for (const f of fields) {
    if (f.pipelineId !== pipelineId) continue;
    const n = f.nodeLabel || "Stage";
    if (!map.has(n)) map.set(n, []);
    const list = map.get(n);
    if (!list.some((x) => x.label === f.label)) list.push(f);
  }
  return map;
}

export default function Reports() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === "admin";
  const isManager = isAdmin || user?.role === "manager";

  const [reports, setReports] = useState(null); // null = loading
  const [pipelines, setPipelines] = useState([]); // { id, name, status, reportCount }
  const [selectedId, setSelectedId] = useState(null);
  const [selectedPipelineId, setSelectedPipelineId] = useState(null); // expanded pipeline
  const [projects, setProjects] = useState(null);
  const [allFields, setAllFields] = useState([]);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState("");

  // Table state for the currently selected report
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [sortKey, setSortKey] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [groupBy, setGroupBy] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Switching reports clears the previous report's table state so filters /
  // sort from report A never leak into report B.
  useEffect(() => {
    setSearch("");
    setFilters({});
    setSortKey("name");
    setSortDir("asc");
    setGroupBy("");
    setPage(1);
  }, [selectedId]);

  // Create / edit modal state
  const [modal, setModal] = useState(null); // null | { report?: Report }
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formPipelineId, setFormPipelineId] = useState("");
  const [draftCols, setDraftCols] = useState([]);
  const [viewerIds, setViewerIds] = useState([]);
  const [saving, setSaving] = useState(false);
  const [modalErr, setModalErr] = useState("");
  const [notice, setNotice] = useState(null);

  async function refreshPipelines() {
    try {
      const d = await listReportPipelines();
      setPipelines(d.pipelines || []);
    } catch {
      /* non-fatal: counts refresh on next load */
    }
  }

  useEffect(() => {
    let cancelled = false;
    Promise.all([listReports(), listReport(), listUsers(), listReportPipelines()])
      .then(([r, d, u, p]) => {
        if (cancelled) return;
        setReports(r.reports);
        setProjects(d.projects);
        setAllFields(d.fields || []);
        setUsers(u.users || []);
        setPipelines(p.pipelines || []);
        if (r.reports.length > 0) {
          const first = r.reports[0];
          setSelectedId(first.id);
          setSelectedPipelineId(first.pipelineId || "__unassigned");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selected = useMemo(
    () => (reports || []).find((r) => r.id === selectedId) || null,
    [reports, selectedId]
  );

  const columns = selected?.columns && selected.columns.length > 0 ? selected.columns : DEFAULT_COLUMNS;

  const canEditReport = (r) => isAdmin || (r && r.createdById === user?.id);

  // Reports nested under a pipeline for the sidebar tree.
  const reportsOf = (pipelineId) => (reports || []).filter((r) => r.pipelineId === pipelineId);

  // Legacy reports (created before pipelines were required) have no pipeline
  // and would be unreachable in the tree — they get an "Unassigned" bucket.
  const unassignedReports = (reports || []).filter((r) => !r.pipelineId);

  function renderReportRow(r, pipelineId) {
    return (
      <div
        key={r.id}
        role="button"
        tabIndex={0}
        onClick={() => {
          setSelectedId(r.id);
          setSelectedPipelineId(pipelineId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            setSelectedId(r.id);
            setSelectedPipelineId(pipelineId);
          }
        }}
        className={`group flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
          r.id === selectedId ? "bg-indigo-100/80" : "hover:bg-gray-50"
        }`}
      >
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            r.id === selectedId ? "font-medium text-indigo-700" : "text-gray-700"
          }`}
        >
          {r.name}
        </span>
        {canEditReport(r) && (
          <span className="hidden shrink-0 gap-0.5 group-hover:flex">
            <button
              onClick={(e) => {
                e.stopPropagation();
                openEdit(r);
              }}
              className="rounded px-1 py-0.5 text-[10px] font-medium text-gray-400 hover:bg-white hover:text-indigo-600"
              title="Edit report"
            >
              Edit
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(r);
              }}
              className="rounded px-1 py-0.5 text-[10px] font-medium text-gray-400 hover:bg-white hover:text-red-600"
              title="Delete report"
            >
              Del
            </button>
          </span>
        )}
      </div>
    );
  }

  // ---------- Report actions ----------

  function openCreate(pipelineId) {
    // When a pipeline is already in context (expanded in the tree, or the
    // create button lives inside a pipeline's own section), pre-fill it so
    // the user doesn't have to select the pipeline again.
    const ctx =
      pipelineId ||
      (selectedPipelineId && selectedPipelineId !== "__unassigned" ? selectedPipelineId : "");
    setFormName("");
    setFormDesc("");
    setFormPipelineId(ctx);
    setDraftCols(DEFAULT_COLUMNS.map((c) => ({ ...c })));
    setViewerIds([]);
    setModalErr("");
    setModal({ report: null });
  }

  function openEdit(r) {
    setFormName(r.name);
    setFormDesc(r.description || "");
    setFormPipelineId(r.pipelineId || "");
    setDraftCols((r.columns && r.columns.length > 0 ? r.columns : DEFAULT_COLUMNS).map((c) => ({ ...c })));
    setViewerIds(r.viewers.map((v) => v.id));
    setModalErr("");
    setModal({ report: r });
  }

  // Choosing a different pipeline resets the picked columns — the fields of
  // one pipeline must not leak into a report of another.
  function changePipeline(pipelineId) {
    setFormPipelineId(pipelineId);
    setDraftCols(DEFAULT_COLUMNS.map((c) => ({ ...c })));
    setModalErr("");
  }

  async function handleSave(e) {
    e.preventDefault();
    if (!formName.trim()) {
      setModalErr("Report name is required.");
      return;
    }
    if (!formPipelineId) {
      setModalErr("Select the pipeline this report is based on.");
      return;
    }
    const cols = draftCols.filter(Boolean);
    if (cols.length === 0) {
      setModalErr("Pick at least one field to display in the report.");
      return;
    }
    setSaving(true);
    setModalErr("");
    try {
      const body = {
        name: formName.trim(),
        description: formDesc.trim(),
        pipelineId: formPipelineId,
        columns: cols,
        viewerIds,
      };
      if (modal.report) {
        const d = await updateReport(modal.report.id, body);
        setReports((prev) => prev.map((r) => (r.id === d.report.id ? d.report : r)));
        setNotice({ kind: "ok", text: `"${d.report.name}" updated.` });
      } else {
        const d = await createReport(body);
        setReports((prev) => [d.report, ...(prev || [])]);
        setSelectedId(d.report.id);
        setSelectedPipelineId(d.report.pipelineId);
        setNotice({ kind: "ok", text: `"${d.report.name}" created.` });
      }
      setModal(null);
      await refreshPipelines();
    } catch (err) {
      setModalErr(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r) {
    if (!window.confirm(`Delete report "${r.name}"? This cannot be undone.`)) return;
    try {
      await deleteReport(r.id);
      const rest = (reports || []).filter((x) => x.id !== r.id);
      setReports(rest);
      if (rest.length > 0) {
        setSelectedId(rest[0].id);
        setSelectedPipelineId(rest[0].pipelineId || "__unassigned");
      } else {
        setSelectedId(null);
        setSelectedPipelineId(null);
      }
      setNotice({ kind: "ok", text: `"${r.name}" deleted.` });
      await refreshPipelines();
    } catch (err) {
      setNotice({ kind: "err", text: err.message });
    }
  }

  // ---------- Column picker helpers (modal) ----------

  function toggleCol(key, kind) {
    setDraftCols((prev) => {
      if (prev.some((c) => c.key === key && c.kind === kind)) {
        return prev.filter((c) => !(c.key === key && c.kind === kind));
      }
      const col = allColumnOptions.find((c) => c.key === key && c.kind === kind);
      return col ? [...prev, { ...col }] : prev;
    });
  }

  function isSelected(key, kind) {
    return draftCols.some((c) => c.key === key && c.kind === kind);
  }

  function moveDraft(index, dir) {
    setDraftCols((prev) => {
      const next = prev.slice();
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      const [moved] = next.splice(index, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }

  // Field options are only those of the currently chosen pipeline.
  const allColumnOptions = useMemo(() => {
    const fields = allFields
      .filter((f) => f.pipelineId === formPipelineId)
      .map((f) => ({
        key: f.id,
        label: f.label,
        kind: "field",
        fieldType: f.fieldType,
        pipelineName: f.pipelineName,
        nodeLabel: f.nodeLabel,
      }));
    return [...PROJECT_COLUMNS, ...fields];
  }, [allFields, formPipelineId]);

  const modalFieldGroups = useMemo(
    () => (formPipelineId ? fieldGroupsForPipeline(allFields, formPipelineId) : new Map()),
    [allFields, formPipelineId]
  );

  // ---------- Table state (scoped to the selected report's pipeline) ----------

  const filtered = useMemo(() => {
    if (!projects || !selected) return [];
    let rows = projects.filter((r) => r.pipelineId === selected.pipelineId);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((r) => columns.some((c) => displayValue(r, c).toLowerCase().includes(q)));
    }
    for (const [key, val] of Object.entries(filters)) {
      if (val) {
        const col = columns.find((c) => c.key === key);
        if (col) {
          rows = rows.filter((r) => displayValue(r, col).toLowerCase().includes(val.toLowerCase()));
        }
      }
    }
    const dir = sortDir === "asc" ? 1 : -1;
    const isDate = ["startDate", "endDate", "lastModified"].includes(sortKey);
    rows = [...rows].sort((a, b) => {
      if (isDate) {
        const an = a[sortKey] ? new Date(a[sortKey]).getTime() : 0;
        const bn = b[sortKey] ? new Date(b[sortKey]).getTime() : 0;
        return (an - bn) * dir;
      }
      const av = displayValue(a, columns.find((c) => c.key === sortKey) || { key: sortKey });
      const bv = displayValue(b, columns.find((c) => c.key === sortKey) || { key: sortKey });
      const isNum =
        sortKey === "budget" ||
        sortKey === "completion" ||
        (!isNaN(Number(av)) && !isNaN(Number(bv)) && av !== "" && bv !== "");
      if (isNum) {
        const an = Number(av.replace(/[^0-9.-]/g, "") || 0);
        const bn = Number(bv.replace(/[^0-9.-]/g, "") || 0);
        return (an - bn) * dir;
      }
      return av.localeCompare(bv) * dir;
    });
    return rows;
  }, [projects, selected, search, filters, sortKey, sortDir, columns]);

  const grouped = useMemo(() => {
    if (!groupBy) return null;
    const map = new Map();
    for (const r of filtered) {
      const key = r[groupBy] || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    }
    return [...map.entries()];
  }, [filtered, groupBy]);

  const pagedRows = useMemo(() => {
    if (grouped) return null;
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, grouped]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));

  function toggleSort(key) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function setFilter(key, value) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function renderHeaderCell(col) {
    return (
      <th
        key={col.key}
        onClick={() => toggleSort(col.key)}
        className={`cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-gray-500 hover:text-gray-800 ${
          sortKey === col.key ? "text-indigo-600" : ""
        }`}
      >
        {col.label}
        {sortKey === col.key && <span className="ml-1">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </th>
    );
  }

  function renderRow(r) {
    return (
      <tr
        key={r.id}
        onClick={() => navigate(`/projects/${r.id}`)}
        className="cursor-pointer border-t border-gray-100 hover:bg-indigo-50/40"
      >
        {columns.map((col) => (
          <td
            key={col.key}
            className={`whitespace-nowrap px-3 py-2 ${
              col.key === "name" ? "font-medium text-gray-900" : "text-gray-600"
            } ${col.key === "developers" ? "max-w-[10rem] truncate" : ""}`}
          >
            {col.key === "status" ? (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  STATUS_BADGE[r.status] || "bg-gray-100 text-gray-600"
                }`}
              >
                {r.status}
              </span>
            ) : col.key === "completion" ? (
              <div className="flex items-center gap-2">
                <div className="h-1.5 w-12 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className={`h-full rounded-full ${r.completion === 100 ? "bg-emerald-500" : "bg-indigo-500"}`}
                    style={{ width: `${r.completion || 0}%` }}
                  />
                </div>
                <span className="text-xs text-gray-600">{r.completion ?? 0}%</span>
              </div>
            ) : (
              displayValue(r, col) || "—"
            )}
          </td>
        ))}
      </tr>
    );
  }

  return (
    <AppLayout title="Reports">
      <main className="no-print page-shell max-w-[90rem] py-6">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {notice && (
          <p
            className={`mb-4 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
          >
            {notice.text}
          </p>
        )}

        {reports === null || projects === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[18rem_1fr]">
            {/* ===== Left: pipeline tree with its reports ===== */}
            <aside className="card">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="section-title">Pipelines &amp; reports</p>
                  {isManager && (
                    <button
                      onClick={() => openCreate()}
                      className="btn btn-primary px-2.5 py-1 text-xs"
                    >
                      + New report
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-gray-400">
                  Reports are built from a single pipeline
                </p>
              </div>

              <div className="max-h-[calc(100vh-16rem)] overflow-y-auto p-2">
                {pipelines.length === 0 && (
                  <div className="px-2 py-6 text-center">
                    <p className="text-sm text-gray-500">No pipelines yet.</p>
                    {isManager && (
                      <button
                        onClick={() => openCreate()}
                        className="mt-3 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
                      >
                        Create your first report
                      </button>
                    )}
                  </div>
                )}

                {pipelines.map((p) => {
                  const pipelineReports = reportsOf(p.id);
                  const open = selectedPipelineId === p.id;
                  return (
                    <div key={p.id} className="mb-0.5">
                      <button
                        onClick={() => setSelectedPipelineId(open ? null : p.id)}
                        className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                          open ? "bg-indigo-50/70 text-indigo-800" : "text-gray-800 hover:bg-gray-50"
                        }`}
                        title={open ? "Collapse pipeline" : "Show this pipeline's reports"}
                      >
                        <svg
                          className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`}
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            p.reportCount > 0
                              ? "bg-indigo-100 text-indigo-700"
                              : "bg-gray-100 text-gray-400"
                          }`}
                          title={`${p.reportCount} report${p.reportCount === 1 ? "" : "s"}`}
                        >
                          {p.reportCount}
                        </span>
                      </button>

                      {open && (
                        <div className="ml-4 border-l border-gray-100 pl-2">
                          {pipelineReports.length === 0 ? (
                            <p className="px-2.5 py-1.5 text-xs text-gray-400">
                              No reports yet.
                              {isManager && (
                                <button
                                  onClick={() => openCreate(p.id)}
                                  className="ml-1 font-medium text-indigo-600 hover:underline"
                                >
                                  Create one
                                </button>
                              )}
                            </p>
                          ) : (
                            pipelineReports.map((r) => renderReportRow(r, p.id))
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {unassignedReports.length > 0 && (
                  <div className="mb-0.5 border-t border-gray-100 pt-1">
                    <button
                      onClick={() =>
                        setSelectedPipelineId(selectedPipelineId === "__unassigned" ? null : "__unassigned")
                      }
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                        selectedPipelineId === "__unassigned"
                          ? "bg-amber-50/70 text-amber-800"
                          : "text-gray-800 hover:bg-gray-50"
                      }`}
                      title="Reports created before a pipeline was assigned"
                    >
                      <svg
                        className={`h-3 w-3 shrink-0 text-gray-400 transition-transform ${
                          selectedPipelineId === "__unassigned" ? "rotate-90" : ""
                        }`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="min-w-0 flex-1 truncate font-medium">Unassigned reports</span>
                      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                        {unassignedReports.length}
                      </span>
                    </button>

                    {selectedPipelineId === "__unassigned" && (
                      <div className="ml-4 border-l border-gray-100 pl-2">
                        {unassignedReports.map((r) => renderReportRow(r, "__unassigned"))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>

            {/* ===== Right: selected report ===== */}
            {!selected ? (
              <div className="card-dashed p-10 text-center">
                <p className="text-sm text-gray-500">
                  {isManager
                    ? "Create a report to get started — pick a pipeline, choose which of its fields to display, and share it with teammates."
                    : "No report selected — open a pipeline on the left."}
                </p>
              </div>
            ) : (
              <section className="card">
                {/* Report header */}
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900">{selected.name}</h2>
                    <p className="mt-0.5 text-sm text-gray-500">
                      Pipeline:{" "}
                      <span className="font-medium text-gray-700">
                        {selected.pipeline?.name || "—"}
                      </span>
                      {!selected.pipelineId && isManager && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          No pipeline assigned — Edit to pick one
                        </span>
                      )}
                    </p>
                    {selected.description && (
                      <p className="mt-0.5 text-sm text-gray-500">{selected.description}</p>
                    )}
                    <p className="mt-1 text-[11px] text-gray-400">
                      Created by {selected.createdBy?.email || "—"} · {columns.length} columns
                    </p>
                    {selected.viewers.length > 0 && (
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          Shared with
                        </span>
                        {selected.viewers.map((v) => (
                          <span
                            key={v.id}
                            className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600"
                            title={`${v.email} (${v.role})`}
                          >
                            {v.email}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {canEditReport(selected) && (
                    <button
                      onClick={() => openEdit(selected)}
                      className="btn border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 shrink-0"
                    >
                      Edit report
                    </button>
                  )}
                </div>

                {/* Toolbar */}
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 px-5 py-3">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Search this report…"
                    className="input w-56 py-1.5"
                  />
                  <select
                    value={groupBy}
                    onChange={(e) => {
                      setGroupBy(e.target.value);
                      setPage(1);
                    }}
                    className="select w-auto py-1.5"
                  >
                    <option value="">No grouping</option>
                    <option value="status">Group by Status</option>
                    <option value="client">Group by Client</option>
                  </select>
                  <button
                    onClick={() => downloadCSV(`${selected.name || "report"}.csv`, filtered, columns)}
                    className="btn btn-success"
                    title="Export the current view to Excel-compatible CSV"
                  >
                    Export to Excel
                  </button>
                  <button
                    onClick={() => window.print()}
                    className="btn btn-secondary"
                  >
                    Print
                  </button>
                  <span className="ml-auto text-xs text-gray-400">
                    {filtered.length} project{filtered.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Column filters */}
                {columns.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 border-b border-gray-100 px-5 py-3 md:grid-cols-4 lg:grid-cols-6">
                    {columns.slice(0, 12).map((col) => (
                      <input
                        key={col.key}
                        type="text"
                        value={filters[col.key] || ""}
                        onChange={(e) => setFilter(col.key, e.target.value)}
                        placeholder={`Filter ${col.label.toLowerCase()}…`}
                        className="input border-gray-200 px-2.5 py-1.5 text-xs"
                      />
                    ))}
                  </div>
                )}

                {filtered.length === 0 ? (
                  <div className="p-8 text-center">
                    <p className="text-sm text-gray-500">
                      No projects match this report's pipeline.
                    </p>
                  </div>
                ) : grouped ? (
                  <div className="space-y-6 p-5">
                    {grouped.map(([key, rows]) => (
                      <div key={key} className="overflow-hidden rounded-lg border border-gray-200">
                        <div className="border-b border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700">
                          {groupBy}: {key} <span className="font-normal text-gray-400">({rows.length})</span>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr>{columns.map(renderHeaderCell)}</tr>
                            </thead>
                            <tbody>{rows.map(renderRow)}</tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="print-area overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-gray-200 bg-gray-50">
                            {columns.map(renderHeaderCell)}
                          </tr>
                        </thead>
                        <tbody>{pagedRows.map(renderRow)}</tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
                      <p className="text-xs text-gray-400">
                        Page {page} of {totalPages}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                          disabled={page <= 1}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Previous
                        </button>
                        <button
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                          disabled={page >= totalPages}
                          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                        >
                          Next
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}
          </div>
        )}

        {/* ===== Create / edit modal ===== */}
        {modal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden">
            <form
              onSubmit={handleSave}
              className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-white shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    {modal.report ? "Edit report" : "New report"}
                  </h2>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Name it, pick its pipeline, choose the fields to display, then share it.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="rounded-md px-2 py-1 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto p-5">
                {/* Step 1 + 2: name + pipeline */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label htmlFor="report-name" className="block text-xs font-medium text-gray-600">
                      1 · Report name{" "}
                      <span className="font-normal text-gray-400">(must be unique)</span>
                    </label>
                    <input
                      id="report-name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Q3 launch tracking"
                      className="input mt-1"
                    />
                  </div>
                  <div>
                    <label htmlFor="report-pipeline" className="block text-xs font-medium text-gray-600">
                      2 · Pipeline{" "}
                      <span className="font-normal text-gray-400">(its fields become the report's columns)</span>
                    </label>
                    <select
                      id="report-pipeline"
                      value={formPipelineId}
                      onChange={(e) => changePipeline(e.target.value)}
                      className="select mt-1"
                    >
                      <option value="">Select a pipeline…</option>
                      {pipelines.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Step 3: fields to display — ONE section (picker + order) */}
                <div>
                  <p className="text-xs font-medium text-gray-600">
                    3 · Fields to display{" "}
                    <span className="font-normal text-gray-400">
                      {formPipelineId
                        ? `(${draftCols.length} selected — all stages of the pipeline are available)`
                        : "(select a pipeline first)"}
                    </span>
                  </p>
                  {!formPipelineId ? (
                    <div className="mt-2 rounded-md border border-dashed border-gray-200 bg-gray-50 p-4 text-center text-xs text-gray-400">
                      Pick a pipeline above to load its stages and fields.
                    </div>
                  ) : (
                    <div className="mt-2 rounded-md border border-gray-200">
                      <div className="max-h-64 overflow-y-auto p-2">
                        <p className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
                          Project info
                        </p>
                        {PROJECT_COLUMNS.map((c) => (
                          <label
                            key={`p-${c.key}`}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={isSelected(c.key, "project")}
                              onChange={() => toggleCol(c.key, "project")}
                              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="truncate">{c.label}</span>
                          </label>
                        ))}

                        {[...modalFieldGroups.entries()].map(([nodeLabel, fields]) => (
                          <div key={nodeLabel}>
                            <p className="px-2 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-500">
                              {nodeLabel}
                            </p>
                            {fields.map((f) => (
                              <label
                                key={`f-${f.id}`}
                                className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected(f.id, "field")}
                                  onChange={() => toggleCol(f.id, "field")}
                                  className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                />
                                <span
                                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                    FIELD_TYPE_DOTS[f.fieldType] || "bg-gray-400"
                                  }`}
                                />
                                <span className="truncate">{f.label}</span>
                              </label>
                            ))}
                          </div>
                        ))}
                      </div>
                      {/* Selected columns order — same section, not a duplicate */}
                      <div className="border-t border-gray-200 bg-gray-50/60 px-3 py-2.5">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                          Selected columns{" "}
                          <span className="font-normal text-gray-400">({draftCols.length})</span>
                        </p>
                        <div className="mt-1.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                          {draftCols.length === 0 ? (
                            <p className="text-xs text-gray-400">No columns picked yet.</p>
                          ) : (
                            draftCols.map((col, i) => (
                              <span
                                key={`${col.kind}-${col.key}`}
                                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[11px] text-gray-700"
                              >
                                <span className="text-gray-300">{i + 1}.</span>
                                <span className="max-w-[12rem] truncate">{col.label}</span>
                                <button
                                  type="button"
                                  onClick={() => moveDraft(i, -1)}
                                  disabled={i === 0}
                                  className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
                                  title="Move up"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveDraft(i, 1)}
                                  disabled={i === draftCols.length - 1}
                                  className="text-gray-400 hover:text-gray-600 disabled:opacity-40"
                                  title="Move down"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleCol(col.key, col.kind)}
                                  className="text-gray-400 hover:text-red-500"
                                  title="Remove"
                                >
                                  ✕
                                </button>
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Step 4: viewers */}
                <div>
                  <p className="text-xs font-medium text-gray-600">
                    4 · Who can view{" "}
                    <span className="font-normal text-gray-400">
                      ({viewerIds.length} selected · you can always see your own)
                    </span>
                  </p>
                  <div className="mt-1 max-h-40 space-y-1 overflow-y-auto rounded-md border border-gray-200 p-2">
                    {users.length === 0 ? (
                      <p className="px-2 py-2 text-xs text-gray-400">No team members yet.</p>
                    ) : (
                      users.map((u) => {
                        const checked = viewerIds.includes(u.id);
                        return (
                          <label
                            key={u.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                setViewerIds((prev) =>
                                  checked ? prev.filter((id) => id !== u.id) : [...prev, u.id]
                                )
                              }
                              className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="min-w-0 flex-1 truncate">{u.email}</span>
                            <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-500">
                              {u.role}
                            </span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {modalErr && <p className="text-xs text-red-600">{modalErr}</p>}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setModal(null)}
                  className="btn btn-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="btn btn-primary"
                >
                  {saving ? "Saving…" : modal.report ? "Save changes" : "Create report"}
                </button>
              </div>
            </form>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
