import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AppLayout from "../components/AppLayout";
import {
  listPipelines,
  createPipeline,
  publishPipeline,
  unpublishPipeline,
  archivePipeline,
  unarchivePipeline,
  clonePipeline,
  deletePipeline,
} from "../api/pipelines";

const STATUS_BADGE = {
  draft: "bg-amber-100 text-amber-700",
  published: "bg-emerald-100 text-emerald-700",
  archived: "bg-gray-200 text-gray-600",
};

const PROJECT_STATUS_BADGE = {
  active: "bg-sky-100 text-sky-700",
  completed: "bg-emerald-100 text-emerald-700",
  cancelled: "bg-rose-100 text-rose-700",
};

export default function Dashboard() {
  const navigate = useNavigate();

  const [pipelines, setPipelines] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState({});
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null); // { kind, text }

  useEffect(() => {
    let cancelled = false;
    listPipelines()
      .then((d) => {
        if (!cancelled) setPipelines(d.pipelines);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Filter the pipeline list by name, status, or the projects using it.
  const filteredPipelines = useMemo(() => {
    if (!pipelines) return null;
    const q = query.trim().toLowerCase();
    if (!q) return pipelines;
    return pipelines.filter((p) => {
      const projectNames = (p.projects || []).map((x) => x.name).join(" ");
      const hay = `${p.name} ${p.status} ${projectNames}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pipelines, query]);

  async function refresh() {
    const d = await listPipelines();
    setPipelines(d.pipelines);
  }

  async function handleCreate() {
    setCreating(true);
    setError("");
    setNotice(null);
    try {
      const data = await createPipeline({ name: "Untitled pipeline" });
      navigate(`/pipelines/${data.pipeline.id}`);
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
      setCreating(false);
    }
  }

  async function runAction(p, fn, okText) {
    setBusyId(p.id);
    setNotice(null);
    try {
      await fn(p);
      setNotice({ kind: "ok", text: okText });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDuplicate(p) {
    setBusyId(p.id);
    setNotice(null);
    try {
      const data = await clonePipeline(p.id);
      setNotice({ kind: "ok", text: `Duplicated as "${data.pipeline.name}".` });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(p) {
    if (!window.confirm(`Delete pipeline "${p.name}"? This cannot be undone.`)) return;
    setBusyId(p.id);
    setNotice(null);
    try {
      await deletePipeline(p.id);
      setNotice({ kind: "ok", text: "Pipeline deleted." });
      await refresh();
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <AppLayout title="Pipelines">
      <main className="page-shell max-w-5xl">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="section-title">Pipeline Master</h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-56">
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
                placeholder="Search pipelines…"
                className="input py-1.5 pl-9 pr-3"
              />
            </div>
            <Link
              to="/projects/new"
              className="btn btn-secondary"
            >
              New Project
            </Link>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="btn btn-primary"
            >
              {creating ? "Creating…" : "New Pipeline"}
            </button>
          </div>
        </div>

        {notice && (
          <p
            className={`mb-3 text-sm ${notice.kind === "ok" ? "text-emerald-600" : "text-red-600"}`}
          >
            {notice.text}
          </p>
        )}
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

        {pipelines === null ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : pipelines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">No pipelines yet. Create your first one!</p>
          </div>
        ) : filteredPipelines.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white p-8 text-center">
            <p className="text-sm text-gray-500">No pipelines match “{query.trim()}”.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {filteredPipelines.map((p) => {
              const open = !!expanded[p.id];
              return (
                <li
                  key={p.id}
                  className={`card overflow-hidden transition-colors ${
                    p.status === "archived" ? "border-gray-200 opacity-80" : "border-gray-200"
                  }`}
                >
                  {/* Card header */}
                  <div className="flex items-center gap-3 px-4 py-3">
                    <button
                      onClick={() => toggleExpand(p.id)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-transform hover:bg-gray-100 hover:text-gray-600"
                      title={open ? "Collapse" : "Expand"}
                    >
                      <svg
                        className={`h-4 w-4 transition-transform ${open ? "rotate-90" : ""}`}
                        viewBox="0 0 20 20"
                        fill="currentColor"
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>

                    <button
                      onClick={() => navigate(`/pipelines/${p.id}`)}
                      className="min-w-0 flex-1 text-left"
                      title="Open workflow editor"
                    >
                      <span className="block truncate text-sm font-medium text-gray-800">
                        {p.name}
                      </span>
                      <span className="block text-xs text-gray-400">
                        v{p.versionNumber ?? 1} · {p.stats.total} project
                        {p.stats.total === 1 ? "" : "s"}
                      </span>
                    </button>

                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                        STATUS_BADGE[p.status] || "bg-gray-100 text-gray-600"
                      }`}
                    >
                      {p.status}
                    </span>

                    {/* Action menu */}
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        onClick={() => navigate(`/pipelines/${p.id}`)}
                        disabled={busyId === p.id || p.status === "archived"}
                        className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        title="Edit workflow"
                      >
                        Edit
                      </button>
                      {p.status === "draft" && (
                        <button
                          onClick={() =>
                            runAction(p, () => publishPipeline(p.id), "Pipeline published.")
                          }
                          disabled={busyId === p.id}
                          className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          Publish
                        </button>
                      )}
                      {p.status === "published" && (
                        <button
                          onClick={() =>
                            runAction(p, () => unpublishPipeline(p.id), "Pipeline unpublished.")
                          }
                          disabled={busyId === p.id}
                          className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          Unpublish
                        </button>
                      )}
                      <button
                        onClick={() => handleDuplicate(p)}
                        disabled={busyId === p.id}
                        className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        title="Duplicate pipeline"
                      >
                        Duplicate
                      </button>
                      {p.status === "archived" ? (
                        <button
                          onClick={() =>
                            runAction(p, () => unarchivePipeline(p.id), "Pipeline unarchived.")
                          }
                          disabled={busyId === p.id}
                          className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          Unarchive
                        </button>
                      ) : (
                        <button
                          onClick={() =>
                            runAction(p, () => archivePipeline(p.id), "Pipeline archived.")
                          }
                          disabled={busyId === p.id}
                          className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 disabled:opacity-50"
                        >
                          Archive
                        </button>
                      )}
                      <button
                        onClick={() => handleDelete(p)}
                        disabled={busyId === p.id}
                        className="rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                        title="Delete pipeline"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {/* Expandable stats panel */}
                  {open && (
                    <div className="border-t border-gray-100 bg-gray-50/60 px-4 py-4">
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {[
                          { label: "Total tagged", value: p.stats.total, cls: "text-gray-800" },
                          { label: "Active", value: p.stats.active, cls: "text-sky-600" },
                          { label: "Completed", value: p.stats.completed, cls: "text-emerald-600" },
                          { label: "Cancelled", value: p.stats.cancelled, cls: "text-rose-600" },
                        ].map((s) => (
                          <div
                            key={s.label}
                            className="card-inset px-3 py-2 text-center"
                          >
                            <p className={`text-lg font-semibold ${s.cls}`}>{s.value}</p>
                            <p className="text-[11px] uppercase tracking-wide text-gray-400">
                              {s.label}
                            </p>
                          </div>
                        ))}
                      </div>

                      {/* Complete project list */}
                      <div className="mt-4">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Projects
                        </p>
                        {p.projects.length === 0 ? (
                          <p className="mt-2 text-sm text-gray-400">
                            No projects use this pipeline yet.
                          </p>
                        ) : (
                          <div className="mt-2 max-h-64 space-y-1 overflow-y-auto pr-1">
                            {p.projects.map((proj) => (
                              <Link
                                key={proj.id}
                                to={`/projects/${proj.id}`}
                                className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 text-sm transition-colors hover:border-indigo-300 hover:bg-indigo-50/50"
                              >
                                <span className="truncate font-medium text-gray-800">
                                  {proj.name}
                                </span>
                                <span className="flex shrink-0 items-center gap-2">
                                  {proj.client && (
                                    <span className="text-xs text-gray-400">{proj.client}</span>
                                  )}
                                  <span
                                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                      PROJECT_STATUS_BADGE[proj.status] || "bg-gray-100 text-gray-600"
                                    }`}
                                  >
                                    {proj.status}
                                  </span>
                                </span>
                              </Link>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </AppLayout>
  );
}
