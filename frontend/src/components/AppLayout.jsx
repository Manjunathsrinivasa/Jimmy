import { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { changePassword } from "../api/auth";
import { getNavOrder, setNavOrder } from "../api/settings";

// Left sidebar navigation — everything lives under a "Workspace" heading.
// Active route gets an indigo pill plus a gradient indicator bar.
const NAV = [
  {
    to: "/dashboard",
    label: "Overview",
    end: true,
    key: "overview",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3.75 3A1.75 1.75 0 002 4.75v3.5C2 9.216 2.784 10 3.75 10h3.5C8.216 10 9 9.216 9 8.25v-3.5A1.75 1.75 0 007.25 3h-3.5zm0 10A1.75 1.75 0 002 14.75v.5c0 .966.784 1.75 1.75 1.75h3.5A1.75 1.75 0 009 15.25v-.5A1.75 1.75 0 007.25 13h-3.5zM11 4.75A1.75 1.75 0 0112.75 3h3.5c.966 0 1.75.784 1.75 1.75v.5A1.75 1.75 0 0116.25 7h-3.5A1.75 1.75 0 0111 5.25v-.5zM11 14.75c0-.966.784-1.75 1.75-1.75h3.5c.966 0 1.75.784 1.75 1.75v.5A1.75 1.75 0 0116.25 17h-3.5A1.75 1.75 0 0111 15.25v-.5z" />
      </svg>
    ),
  },
  {
    to: "/pipelines",
    label: "Pipelines",
    key: "pipelines",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path d="M6.28 5.22a.75.75 0 010 1.06L5.06 7.5l1.22 1.22a.75.75 0 01-1.06 1.06l-1.75-1.75a.75.75 0 010-1.06l1.75-1.75a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l1.75 1.75a.75.75 0 010 1.06l-1.75 1.75a.75.75 0 01-1.06-1.06L14.94 7.5l-1.22-1.22a.75.75 0 010-1.06zM7 13.25a.75.75 0 01.75-.75h4.5a.75.75 0 010 1.5h-4.5a.75.75 0 01-.75-.75zM7.5 3a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5A.75.75 0 017.5 3zm5 0a.75.75 0 01.75.75v2.5a.75.75 0 01-1.5 0v-2.5A.75.75 0 0112.5 3z" />
      </svg>
    ),
  },
  {
    to: "/approvals",
    label: "Approvals",
    key: "approvals",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.883l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  {
    to: "/reports",
    label: "Reports",
    key: "reports",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path d="M1 2.75A.75.75 0 011.75 2h16.5a.75.75 0 010 1.5H18v8.5A2.75 2.75 0 0115.25 15H9.75v2.25h3.5a.75.75 0 010 1.5h-6.5a.75.75 0 010-1.5h3.5V15H4.75A2.75 2.75 0 012 12.25V3.5h-.25A.75.75 0 011 2.75zM6.5 6a1 1 0 100 2h7a1 1 0 100-2h-7zM5.5 10.5a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
      </svg>
    ),
  },
  {
    to: "/users",
    label: "Users & Roles",
    key: "users",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path d="M7 8a3 3 0 100-6 3 3 0 000 6zM14.5 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM1.615 16.428a1.224 1.224 0 01-.569-1.175 6.002 6.002 0 0111.908 0c.058.467-.172.92-.57 1.174A9.953 9.953 0 017 18a9.953 9.953 0 01-5.385-1.572zM14.5 16h-.106c.07-.297.088-.611.048-.933a7.47 7.47 0 00-1.588-3.755 4.502 4.502 0 015.874 2.636.818.818 0 01-.36.98A7.465 7.465 0 0114.5 16z" />
      </svg>
    ),
  },
  {
    to: "/projects/new",
    label: "New Project",
    key: "new_project",
    icon: (
      <svg className="h-[18px] w-[18px]" viewBox="0 0 20 20" fill="currentColor">
        <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
        <path
          fillRule="evenodd"
          d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
];

// A user's granted pages. null / undefined means every page is allowed
// (the default); an empty array means NO pages are allowed (admin unchecked
// everything). Admins are never restricted.
export function hasPageAccess(user, key) {
  if (!user) return true;
  if (user.role === "admin") return true;
  const arr = user.pageAccess;
  if (arr === null || arr === undefined) return true;
  return Array.isArray(arr) && arr.includes(key);
}

function NavItem({ item }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => `nav-item ${isActive ? "nav-item-active" : ""}`}>
      {({ isActive }) => (
        <>
          {isActive && <span className="nav-indicator" />}
          <span className={`shrink-0 ${isActive ? "text-indigo-600" : "text-gray-400"}`}>{item.icon}</span>
          <span className="truncate">{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

export default function AppLayout({ children, title }) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  // Org-wide sidebar order (admin-defined, same for every user). null = default.
  const [navOrder, setNavOrderState] = useState(null);
  const [reorderMode, setReorderMode] = useState(false);
  const [navSaving, setNavSaving] = useState(false);
  const [navNotice, setNavNotice] = useState(null); // "Saved" / error feedback

  const [showPassword, setShowPassword] = useState(false);
  const [pwForm, setPwForm] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMsg, setPwMsg] = useState(null); // { kind, text }

  // Load the org-wide navigation order once (applies to every user).
  useEffect(() => {
    let cancelled = false;
    getNavOrder()
      .then((d) => {
        if (!cancelled) setNavOrderState(Array.isArray(d.order) ? d.order : null);
      })
      .catch(() => {
        if (!cancelled) setNavOrderState(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Apply the configured order; keys the admin left out keep their default
  // position at the end.
  const orderedNav = useMemo(() => {
    const base = Array.isArray(navOrder) ? navOrder : [];
    if (base.length === 0) return NAV;
    const byKey = new Map(NAV.map((item) => [item.key, item]));
    const ordered = [];
    for (const key of base) {
      const item = byKey.get(key);
      if (item && !ordered.includes(item)) ordered.push(item);
    }
    for (const item of NAV) {
      if (!ordered.includes(item)) ordered.push(item);
    }
    return ordered;
  }, [navOrder]);

  // Visible items = configured order, filtered by the user's page access.
  const nav = orderedNav.filter((item) => hasPageAccess(user, item.key));

  async function persistNavOrder(keys) {
    setNavSaving(true);
    try {
      await setNavOrder(keys);
      setNavNotice("Saved");
      window.setTimeout(() => setNavNotice(null), 1500);
    } catch {
      setNavNotice("Save failed");
    } finally {
      setNavSaving(false);
    }
  }

  // Move a nav item and persist the new order for the whole organization.
  function moveNav(index, dir) {
    const next = nav.slice();
    const target = index + dir;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    const keys = next.map((i) => i.key);
    // Any configured key not visible to this admin keeps a stable tail spot.
    const seen = new Set(keys);
    for (const n of NAV) if (!seen.has(n.key)) keys.push(n.key);
    setNavOrderState(keys);
    persistNavOrder(keys);
  }

  const initials = (user?.email || "?")
    .split("@")[0]
    .split(/[._-]/)
    .map((s) => s[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function openPassword() {
    setPwForm({ current: "", next: "", confirm: "" });
    setPwMsg(null);
    setShowPassword(true);
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPwMsg(null);
    if (pwForm.next.length < 8) {
      setPwMsg({ kind: "err", text: "New password must be at least 8 characters." });
      return;
    }
    if (pwForm.next !== pwForm.confirm) {
      setPwMsg({ kind: "err", text: "New passwords do not match." });
      return;
    }
    setPwBusy(true);
    try {
      await changePassword(pwForm.current, pwForm.next);
      setPwMsg({ kind: "ok", text: "Password changed. Use it on your next login." });
      setPwForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setPwMsg({ kind: "err", text: err.message });
    } finally {
      setPwBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ===== Sidebar ===== */}
      <aside className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-gray-200/80 bg-white print:hidden">
        {/* Brand */}
        <div className="flex items-center gap-3 px-5 pb-5 pt-6">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-600/25">
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M10 1a9 9 0 00-6.364 15.364L3 18.5l2.636-1.636A9 9 0 1010 1zm3.62 10.42c-.31.27-.71.41-1.12.44-.27.02-.51.13-.69.35-.37.46-.83 1-1.58 1-.75 0-1.21-.54-1.58-1-.18-.22-.42-.33-.69-.35-.41-.03-.81-.17-1.12-.44-.26-.23-.11-.61.23-.61.34 0 .66.1.94.27.11.06.23.1.35.12.29.04.57-.07.78-.29l.13-.13a1.6 1.6 0 00-.3-.62c-.32-.5-.77-1.03-1.38-1.18-.3-.07-.44-.42-.27-.67.15-.23.43-.3.68-.19.38.17.79.45 1.1.8.15.17.26.36.37.55.1-.2.22-.38.37-.55.31-.35.72-.63 1.1-.8.25-.11.53-.04.68.19.17.25.03.6-.27.67-.61.15-1.06.68-1.38 1.18a1.6 1.6 0 00-.3.62l.13.13c.21.22.49.33.78.29.12-.02.24-.06.35-.12.28-.17.6-.27.94-.27.34 0 .49.38.23.61z"
                clipRule="evenodd"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight tracking-tight text-gray-900">YoJan</p>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              Project Management
            </p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          <div className="flex items-center justify-between pr-1">
            <p className="px-3 pb-2 text-[10px] font-bold uppercase tracking-wider text-gray-400">
              Workspace
            </p>
            {isAdmin && !reorderMode && (
              <button
                onClick={() => setReorderMode(true)}
                className="mb-1 rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-indigo-600"
                title="Reorder the sidebar for the whole team"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM10 8.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM11.5 15.5a1.5 1.5 0 10-3 0 1.5 1.5 0 003 0z" />
                </svg>
              </button>
            )}
          </div>

          {reorderMode && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-indigo-50 px-3 py-2 ring-1 ring-indigo-100">
              <p className="text-[11px] font-semibold text-indigo-700">Reorder sidebar</p>
              <div className="flex items-center gap-2">
                {navSaving && <span className="text-[10px] text-indigo-400">Saving…</span>}
                {navNotice && (
                  <span className="text-[10px] font-medium text-indigo-600">{navNotice}</span>
                )}
                <button
                  onClick={() => {
                    setReorderMode(false);
                    setNavNotice(null);
                  }}
                  className="btn btn-primary px-2 py-0.5 text-[11px]"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            {nav.map((item, i) => (
              <div key={item.to} className="group flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <NavItem item={item} />
                </div>
                {reorderMode && (
                  <div className="flex shrink-0 flex-col">
                    <button
                      onClick={() => moveNav(i, -1)}
                      disabled={i === 0 || navSaving}
                      className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-indigo-600 disabled:opacity-40"
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
                      onClick={() => moveNav(i, 1)}
                      disabled={i === nav.length - 1 || navSaving}
                      className="rounded p-0.5 text-gray-400 hover:bg-white hover:text-indigo-600 disabled:opacity-40"
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
                )}
              </div>
            ))}
          </div>
        </nav>

        {/* User footer */}
        <div className="border-t border-gray-100 p-3">
          <div className="flex items-center gap-3 rounded-xl bg-gray-50/80 p-3 ring-1 ring-gray-100">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-500 text-xs font-bold text-white">
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold text-gray-800">{user?.email}</p>
              <p className="text-[11px] capitalize text-gray-400">{user?.role || "member"}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-0.5">
              <button
                onClick={openPassword}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white hover:text-indigo-600"
                title="Change password"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={handleLogout}
                className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white hover:text-rose-600"
                title="Sign out"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path
                    fillRule="evenodd"
                    d="M3 4.25A2.25 2.25 0 015.25 2h5.5A2.25 2.25 0 0113 4.25v2a.75.75 0 01-1.5 0v-2a.75.75 0 00-.75-.75h-5.5a.75.75 0 00-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 00.75-.75v-2a.75.75 0 011.5 0v2A2.25 2.25 0 0110.75 18h-5.5A2.25 2.25 0 013 15.75V4.25z"
                    clipRule="evenodd"
                  />
                  <path
                    fillRule="evenodd"
                    d="M19 10a.75.75 0 00-.75-.75H8.704l1.048-.943a.75.75 0 10-1.004-1.114l-2.5 2.25a.75.75 0 000 1.114l2.5 2.25a.75.75 0 101.004-1.114l-1.048-.943h9.546A.75.75 0 0019 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* ===== Main content (offset by the fixed sidebar) ===== */}
      <main className="ml-64 min-w-0 flex-1">
        {title && (
          <header className="sticky top-0 z-20 border-b border-gray-200/70 bg-white/85 backdrop-blur print:hidden">
            <div className="flex items-center justify-between gap-4 px-6 py-3.5 sm:px-8">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                  YoJan
                </p>
                <h1 className="truncate text-lg font-bold tracking-tight text-gray-900">{title}</h1>
              </div>
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-xs font-medium text-gray-500">
                  {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
                </p>
              </div>
            </div>
          </header>
        )}
        {children}
      </main>

      {/* ===== Change password modal ===== */}
      {showPassword && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-sm print:hidden">
          <div className="animate-fade-up w-full max-w-md rounded-2xl bg-white shadow-pop">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-gray-900">Change password</h2>
              <p className="mt-0.5 text-xs text-gray-400">
                New passwords must be at least 8 characters.
              </p>
            </div>
            <form onSubmit={handleChangePassword} className="space-y-4 px-6 py-5">
              {pwMsg && (
                <p
                  className={`rounded-lg px-3 py-2 text-sm ${
                    pwMsg.kind === "ok"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {pwMsg.text}
                </p>
              )}
              <div>
                <label htmlFor="pw-current" className="mb-1 block text-xs font-semibold text-gray-600">
                  Current password
                </label>
                <input id="pw-current" type="password" value={pwForm.current} onChange={(e) => setPwForm((v) => ({ ...v, current: e.target.value }))} className="input" />
              </div>
              <div>
                <label htmlFor="pw-next" className="mb-1 block text-xs font-semibold text-gray-600">
                  New password
                </label>
                <input id="pw-next" type="password" value={pwForm.next} onChange={(e) => setPwForm((v) => ({ ...v, next: e.target.value }))} className="input" />
              </div>
              <div>
                <label htmlFor="pw-confirm" className="mb-1 block text-xs font-semibold text-gray-600">
                  Confirm new password
                </label>
                <input id="pw-confirm" type="password" value={pwForm.confirm} onChange={(e) => setPwForm((v) => ({ ...v, confirm: e.target.value }))} className="input" />
              </div>
              <div className="flex items-center justify-end gap-2 pt-1">
                <button type="button" onClick={() => setShowPassword(false)} className="btn btn-secondary">
                  Close
                </button>
                <button type="submit" disabled={pwBusy} className="btn btn-primary">
                  {pwBusy ? "Saving…" : "Change password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
