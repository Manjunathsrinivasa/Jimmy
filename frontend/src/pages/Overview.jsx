import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { listMyProjects } from "../api/projects";
import AppLayout from "../components/AppLayout";
import { getOverviewOrder, setOverviewOrder } from "../api/settings";

function EmptyState({ children }) {
  return (
    <div className="card-dashed px-6 py-10 text-center">
      <p className="text-sm text-gray-500">{children}</p>
    </div>
  );
}

const STATS = [
  {
    key: "tasks",
    label: "My Tasks",
    to: "/dashboard",
    accent: "text-indigo-600",
    bg: "bg-indigo-50",
    sub: "stages assigned to you",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    key: "approvals",
    label: "Pending My Approval",
    to: "/approvals",
    accent: "text-amber-600",
    bg: "bg-amber-50",
    sub: "waiting on your decision",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    key: "projects",
    label: "My Projects",
    to: "/dashboard",
    accent: "text-emerald-600",
    bg: "bg-emerald-50",
    sub: "projects you're connected to",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.5 2a1 1 0 100 2h9a1 1 0 100-2h-9zM5 11.5a1 1 0 011-1h2a1 1 0 010 2H6a1 1 0 01-1-1z" />
      </svg>
    ),
  },
  {
    key: "done",
    label: "Stages Completed",
    to: "/dashboard",
    accent: "text-violet-600",
    bg: "bg-violet-50",
    sub: "across all your projects",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
];

export default function Overview() {
  const user = useAuthStore((s) => s.user);

  const [projects, setProjects] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  // Org-wide Overview card order (admin-defined, same for every user).
  const isAdmin = user?.role === "admin";
  const [overviewOrder, setOverviewOrderState] = useState(null);
  const [overviewReorderMode, setOverviewReorderMode] = useState(false);
  const [overviewSaving, setOverviewSaving] = useState(false);
  const [overviewNotice, setOverviewNotice] = useState(null); // "Saved" / error

  useEffect(() => {
    let cancelled = false;
    listMyProjects()
      .then((d) => {
        if (!cancelled) setProjects(d.projects);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the org-wide Overview card order once (applies to every user).
  useEffect(() => {
    let cancelled = false;
    getOverviewOrder()
      .then((d) => {
        if (!cancelled) setOverviewOrderState(Array.isArray(d.order) ? d.order : null);
      })
      .catch(() => {
        if (!cancelled) setOverviewOrderState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the configured order; stat keys the admin left out keep their
  // default position at the end.
  const stats = useMemo(() => {
    const base = Array.isArray(overviewOrder) ? overviewOrder : [];
    if (base.length === 0) return STATS;
    const byKey = new Map(STATS.map((s) => [s.key, s]));
    const ordered = [];
    for (const key of base) {
      const item = byKey.get(key);
      if (item && !ordered.includes(item)) ordered.push(item);
    }
    for (const item of STATS) {
      if (!ordered.includes(item)) ordered.push(item);
    }
    return ordered;
  }, [overviewOrder]);

  async function persistOverviewOrder(keys) {
    setOverviewSaving(true);
    try {
      await setOverviewOrder(keys);
      setOverviewNotice("Saved");
      window.setTimeout(() => setOverviewNotice(null), 1500);
    } catch {
      setOverviewNotice("Save failed");
    } finally {
      setOverviewSaving(false);
    }
  }

  // Move a card and persist the new order for the whole organization.
  function moveStat(index, dir) {
    const next = stats.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    const keys = next.map((s) => s.key);
    const seen = new Set(keys);
    for (const s of STATS) if (!seen.has(s.key)) keys.push(s.key);
    setOverviewOrderState(keys);
    persistOverviewOrder(keys);
  }

  // Stages assigned to me that still need work, across all my projects,
  // sorted by due date (undated last).
  const myTasks = useMemo(() => {
    if (!projects || !user) return [];
    const list = [];
    for (const p of projects) {
      for (const s of p.stages) {
        if (s.assigneeId === user.id && s.status !== "done" && s.status !== "approved") {
          list.push({ ...s, projectId: p.id, projectName: p.name });
        }
      }
    }
    return list.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0;
      if (!a.dueDate) return 1;
      if (!b.dueDate) return -1;
      return new Date(a.dueDate) - new Date(b.dueDate);
    });
  }, [projects, user]);

  // Approval stages assigned to me whose decision hasn't been made yet
  // (still pending, or unlocked into in_progress but not yet decided).
  const pendingApprovals = useMemo(() => {
    if (!projects || !user) return [];
    const list = [];
    for (const p of projects) {
      for (const s of p.stages) {
        const awaiting =
          s.node.type === "approval" &&
          s.assigneeId === user.id &&
          s.status !== "approved" &&
          s.status !== "rejected" &&
          s.status !== "done";
        if (awaiting) list.push({ ...s, projectId: p.id, projectName: p.name });
      }
    }
    return list;
  }, [projects, user]);

  const pendingApprovalCount = pendingApprovals.length;
  const completedCount = useMemo(() => {
    if (!projects) return 0;
    let n = 0;
    for (const p of projects) {
      n += (p.statusCounts?.done || 0) + (p.statusCounts?.approved || 0);
    }
    return n;
  }, [projects]);

  // Filter the project grid by name, pipeline, or manager.
  const filteredProjects = useMemo(() => {
    if (!projects) return [];
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter((p) => {
      const hay = [p.name, p.pipelineName, p.manager?.email].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(q);
    });
  }, [projects, query]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = (user?.email || "there").split("@")[0];

  const statValues = {
    tasks: myTasks.length,
    approvals: pendingApprovalCount,
    projects: projects?.length ?? 0,
    done: completedCount,
  };

  return (
    <AppLayout title="Overview">
      <main className="page-shell">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {projects === null && !error ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : (
          <div className="space-y-8">
            {/* ===== Hero banner ===== */}
            <section className="animate-fade-up relative overflow-hidden rounded-2xl bg-gradient-to-br from-indigo-600 via-indigo-600 to-violet-600 p-7 text-white shadow-lg shadow-indigo-600/20 sm:p-9">
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-white/10 blur-2xl" />
              <div className="pointer-events-none absolute -bottom-20 right-24 h-44 w-44 rounded-full bg-violet-400/20 blur-2xl" />
              <div className="pointer-events-none absolute right-8 top-8 hidden h-24 w-24 rounded-3xl border border-white/15 sm:block" />

              <div className="relative">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-200">
                  {new Date().toLocaleDateString(undefined, {
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                </p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
                  {greeting}, {name} 👋
                </h2>
                <p className="mt-2 max-w-xl text-sm text-indigo-100/90">
                  Here's your workspace at a glance — {myTasks.length} tasks assigned to you and{" "}
                  {pendingApprovalCount} approval{pendingApprovalCount === 1 ? "" : "s"} waiting for
                  your decision.
                </p>
                <div className="mt-6 flex flex-wrap gap-3">
                  <Link to="/projects/new" className="btn bg-white px-4 text-indigo-700 shadow-md hover:bg-indigo-50">
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    New Project
                  </Link>
                  <Link
                    to="/pipelines"
                    className="btn border border-white/25 bg-white/10 text-white backdrop-blur hover:bg-white/20"
                  >
                    View pipelines
                  </Link>
                </div>
              </div>
            </section>

            {/* ===== Summary counts ===== */}
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <h2 className="section-title">At a glance</h2>
                  {overviewNotice && (
                    <span className="text-xs font-medium text-indigo-600">{overviewNotice}</span>
                  )}
                </div>
                {isAdmin && !overviewReorderMode && (
                  <button
                    onClick={() => setOverviewReorderMode(true)}
                    className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600"
                    title="Reorder these cards for the whole team"
                  >
                    <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M2.24 6.8a.75.75 0 001.06-.04l1.95-2.1v8.59a.75.75 0 001.5 0V4.66l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0L2.2 5.74a.75.75 0 00.04 1.06zm8 6.4a.75.75 0 001.06.04l1.95-2.1v8.59a.75.75 0 001.5 0V11.14l1.95 2.1a.75.75 0 101.1-1.02l-3.25-3.5a.75.75 0 00-1.1 0l-3.25 3.5a.75.75 0 00.04 1.06z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </button>
                )}
                {overviewReorderMode && (
                  <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 ring-1 ring-indigo-100">
                    <p className="text-[11px] font-semibold text-indigo-700">Reorder cards</p>
                    {overviewSaving && <span className="text-[10px] text-indigo-400">Saving…</span>}
                    <button
                      onClick={() => {
                        setOverviewReorderMode(false);
                        setOverviewNotice(null);
                      }}
                      className="btn btn-primary px-2 py-0.5 text-[11px]"
                    >
                      Done
                    </button>
                  </div>
                )}
              </div>
              <div className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((s, i) => {
                  const body = (
                    <>
                      <div className="flex items-start justify-between">
                        <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${s.bg} ${s.accent}`}>
                          {s.icon}
                        </span>
                        {overviewReorderMode ? (
                          <div className="flex shrink-0 flex-col">
                            <button
                              onClick={() => moveStat(i, -1)}
                              disabled={i === 0 || overviewSaving}
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-40"
                              title="Move up"
                            >
                              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M14.77 12.79a.75.75 0 01-1.06-.02L10 8.832 6.29 12.77a.75.75 0 11-1.08-1.04l4.25-4.5a.75.75 0 011.08 0l4.25 4.5a.75.75 0 01-.02 1.06z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                            <button
                              onClick={() => moveStat(i, 1)}
                              disabled={i === stats.length - 1 || overviewSaving}
                              className="rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 disabled:opacity-40"
                              title="Move down"
                            >
                              <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path
                                  fillRule="evenodd"
                                  d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <svg
                            className="h-4 w-4 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-indigo-400"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                          >
                            <path
                              fillRule="evenodd"
                              d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                      <p className={`mt-4 text-3xl font-bold tracking-tight ${s.accent}`}>
                        {statValues[s.key]}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-gray-800">{s.label}</p>
                      <p className="text-xs text-gray-400">{s.sub}</p>
                    </>
                  );
                  return overviewReorderMode ? (
                    <div key={s.key} className="card p-5">
                      {body}
                    </div>
                  ) : (
                    <Link key={s.key} to={s.to} className="card card-hover group p-5">
                      {body}
                    </Link>
                  );
                })}
              </div>
            </section>

            {/* ===== My Projects ===== */}
            <section>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-baseline gap-3">
                  <h2 className="section-title">My Projects</h2>
                  <span className="text-xs text-gray-400">
                    {filteredProjects.length}
                    {query.trim() ? ` of ${projects.length}` : ""} project
                    {filteredProjects.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="relative w-full sm:w-72">
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
                    placeholder="Search projects…"
                    className="input py-1.5 pl-9 pr-3"
                  />
                </div>
              </div>
              {projects.length === 0 ? (
                <EmptyState>
                  You're not part of any projects yet.{" "}
                  <Link to="/projects/new" className="font-semibold text-indigo-600 hover:text-indigo-500">
                    Create one
                  </Link>
                  .
                </EmptyState>
              ) : filteredProjects.length === 0 ? (
                <EmptyState>
                  No projects match “{query.trim()}”.
                </EmptyState>
              ) : (
                <ul className="stagger grid gap-4 sm:grid-cols-2">
                  {filteredProjects.map((p) => {
                    const done =
                      (p.statusCounts?.done || 0) + (p.statusCounts?.approved || 0);
                    const pct = p.stageCount > 0 ? Math.round((done / p.stageCount) * 100) : 0;
                    return (
                      <li key={p.id}>
                        <Link to={`/projects/${p.id}`} className="card card-hover block p-5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{p.name}</p>
                              <p className="mt-0.5 truncate text-xs text-gray-400">
                                {p.pipelineName || "Pipeline"}
                                {p.manager ? ` · ${p.manager.email}` : ""}
                              </p>
                            </div>
                            <span className={`shrink-0 text-lg font-bold ${pct === 100 ? "text-emerald-600" : "text-indigo-600"}`}>
                              {pct}%
                            </span>
                          </div>
                          <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${
                                pct === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-indigo-500 to-violet-500"
                              }`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="mt-2.5 flex items-center justify-between text-xs text-gray-400">
                            <span>
                              {done} of {p.stageCount} stages complete
                            </span>
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                              pct === 100 ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"
                            }`}>
                              {pct === 100 ? "Completed" : "In progress"}
                            </span>
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        )}
      </main>
    </AppLayout>
  );
}
