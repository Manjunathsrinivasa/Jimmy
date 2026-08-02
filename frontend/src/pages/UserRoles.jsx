import { useEffect, useMemo, useState } from "react";
import { useAuthStore } from "../store/authStore";
import { listUsers, createUser, updateUser } from "../api/users";
import AppLayout from "../components/AppLayout";

const ROLES = ["admin", "manager", "contributor", "approver", "viewer"];

const ROLE_BADGES = {
  admin: "bg-indigo-100 text-indigo-700",
  manager: "bg-sky-100 text-sky-700",
  contributor: "bg-emerald-100 text-emerald-700",
  approver: "bg-amber-100 text-amber-700",
  viewer: "bg-gray-100 text-gray-600",
};

const ROLE_HINTS = {
  admin: "Full access — manage pipelines, users, projects.",
  manager: "Create and manage pipelines and projects.",
  contributor: "Works assigned stages in projects.",
  approver: "Reviews and approves pending stages.",
  viewer: "Read-only access.",
};

// The pages an admin can grant. Default: all selected.
const PAGES = [
  { key: "overview", label: "Overview" },
  { key: "pipelines", label: "Pipelines" },
  { key: "approvals", label: "Approvals" },
  { key: "reports", label: "Reports" },
  { key: "users", label: "Users & Roles" },
  { key: "new_project", label: "New Project" },
];

// null / undefined means "all pages allowed" (the default). An explicit
// empty array means the admin unchecked every page — the user gets nothing.
function pageSet(u) {
  const arr = u.pageAccess;
  if (arr === null || arr === undefined) return new Set(PAGES.map((p) => p.key));
  return new Set(Array.isArray(arr) ? arr : []);
}

export default function UserRoles() {
  const user = useAuthStore((s) => s.user);

  const [users, setUsers] = useState(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [savingId, setSavingId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [newUser, setNewUser] = useState({ email: "", password: "", role: "viewer" });
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");
  const [createdCreds, setCreatedCreds] = useState(null); // { email, password }
  const [expandedPages, setExpandedPages] = useState(() => new Set()); // user ids with page access open

  const isAdmin = user?.role === "admin";

  function togglePages(id) {
    setExpandedPages((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Filter the user list by email, role, or page access.
  const filteredUsers = useMemo(() => {
    if (!users) return null;
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => {
      const pages = pageSet(u);
      const pageLabels = PAGES.filter((p) => pages.has(p.key))
        .map((p) => p.label)
        .join(" ");
      const hay = `${u.email} ${u.role} ${pageLabels}`.toLowerCase();
      return hay.includes(q);
    });
  }, [users, query]);

  const load = () => {
    let cancelled = false;
    listUsers()
      .then((d) => {
        if (!cancelled) setUsers(d.users);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  };

  useEffect(load, []);

  async function handleRoleChange(id, role) {
    setSavingId(id);
    setNotice(null);
    setError("");
    try {
      const d = await updateUser(id, { role });
      setNotice({ kind: "ok", text: "Role updated." });
      setUsers((prev) => (prev || []).map((u) => (u.id === id ? d.user : u)));
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setSavingId(null);
    }
  }

  async function handlePageToggle(id, key, checked) {
    const u = (users || []).find((x) => x.id === id);
    if (!u) return;
    const next = pageSet(u);
    if (checked) next.add(key);
    else next.delete(key);
    const body = { pageAccess: [...next] };
    setSavingId(id);
    setNotice(null);
    try {
      const d = await updateUser(id, body);
      setNotice({ kind: "ok", text: "Page access updated." });
      setUsers((prev) => (prev || []).map((x) => (x.id === id ? d.user : x)));
    } catch (e) {
      setNotice({ kind: "err", text: e.message });
    } finally {
      setSavingId(null);
    }
  }

  async function handleAddUser(e) {
    e.preventDefault();
    const email = newUser.email.trim();
    if (!email || !newUser.password) {
      setAddError("Email and password are required.");
      return;
    }
    setAdding(true);
    setAddError("");
    setNotice(null);
    setCreatedCreds(null);
    try {
      const d = await createUser(email, newUser.password, newUser.role);
      setNotice({ kind: "ok", text: `"${email}" added.` });
      // Show the temporary password once so the admin can share it.
      setCreatedCreds({ email, password: d.temporaryPassword || newUser.password });
      setNewUser({ email: "", password: "", role: "viewer" });
      setShowAdd(false);
      setUsers(null);
      load();
    } catch (err2) {
      setAddError(err2.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <AppLayout title="Users & Roles">
      <main className="page-shell">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

        {!isAdmin ? (
          <div className="card p-6 text-sm text-gray-600">
            Only organization admins can manage user roles and page access.
          </div>
        ) : (
          <div className="card">
            <div className="border-b border-gray-100 px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                    Users & Roles
                  </h2>
                  <p className="mt-1 text-xs text-gray-400">
                    Assign each team member a role and choose which pages they can open. All pages
                    are granted by default.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative w-64">
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
                      placeholder="Search users…"
                      className="input py-1.5 pl-9 pr-3"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setShowAdd((v) => !v);
                      setAddError("");
                      setCreatedCreds(null);
                    }}
                    className="btn btn-primary shrink-0"
                  >
                    {showAdd ? "Cancel" : "+ Add user"}
                  </button>
                </div>
              </div>

              {showAdd && (
                <form onSubmit={handleAddUser} className="card-inset mt-4 p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <label htmlFor="new-user-email" className="block text-xs font-medium text-gray-600">
                        Email
                      </label>
                      <input
                        id="new-user-email"
                        type="email"
                        value={newUser.email}
                        onChange={(e) => setNewUser((v) => ({ ...v, email: e.target.value }))}
                        placeholder="teammate@company.com"
                        className="input mt-1"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-user-password" className="block text-xs font-medium text-gray-600">
                        Temporary password
                      </label>
                      <input
                        id="new-user-password"
                        type="password"
                        value={newUser.password}
                        onChange={(e) => setNewUser((v) => ({ ...v, password: e.target.value }))}
                        placeholder="min 8 chars"
                        className="input mt-1"
                      />
                    </div>
                    <div>
                      <label htmlFor="new-user-role" className="block text-xs font-medium text-gray-600">
                        Role
                      </label>
                      <select
                        id="new-user-role"
                        value={newUser.role}
                        onChange={(e) => setNewUser((v) => ({ ...v, role: e.target.value }))}
                        className="input mt-1"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  {addError && <p className="mt-2 text-xs text-red-600">{addError}</p>}
                  <div className="mt-3 flex items-center gap-3">
                    <button
                      type="submit"
                      disabled={adding}
                      className="btn btn-primary"
                    >
                      {adding ? "Adding…" : "Add user"}
                    </button>
                    <p className="text-[11px] text-gray-400">
                      The user can sign in immediately; all pages are granted by default.
                    </p>
                  </div>
                </form>
              )}

              {/* Temporary credentials — shown once right after adding a user */}
              {createdCreds && (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
                  <p className="text-xs font-semibold text-emerald-700">User created — share these credentials</p>
                  <p className="mt-1 text-sm text-gray-800">
                    {createdCreds.email} / <span className="font-mono font-semibold">{createdCreds.password}</span>
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-600">
                    The password is only shown once. Ask them to change it on first login (Change
                    password in the sidebar).
                  </p>
                </div>
              )}
            </div>

            {users === null ? (
              <p className="px-5 py-8 text-sm text-gray-400">Loading…</p>
            ) : users.length === 0 ? (
              <p className="px-5 py-8 text-sm text-gray-400">No users in this organization yet.</p>
            ) : filteredUsers.length === 0 ? (
              <p className="px-5 py-8 text-sm text-gray-400">No users match “{query.trim()}”.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {filteredUsers.map((u) => {
                  const isSelf = u.id === user?.id;
                  const isAdminRow = u.role === "admin";
                  const access = pageSet(u);
                  const lockedRow = isSelf; // can't change own role/access
                  return (
                    <li key={u.id} className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-medium text-gray-800">{u.email}</p>
                            {isSelf && (
                              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">
                                you
                              </span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                ROLE_BADGES[u.role] || "bg-gray-100 text-gray-600"
                              }`}
                            >
                              {u.role}
                            </span>
                            <span className="text-[11px] text-gray-400">{ROLE_HINTS[u.role] || ""}</span>
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <select
                            value={u.role}
                            disabled={savingId === u.id || lockedRow}
                            title={lockedRow ? "You can't change your own role" : undefined}
                            onChange={(e) => handleRoleChange(u.id, e.target.value)}
                            className="select w-auto py-1.5 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                          {lockedRow ? (
                            <span className="text-xs text-gray-400">Locked</span>
                          ) : savingId === u.id ? (
                            <span className="text-xs text-gray-400">Saving…</span>
                          ) : null}
                        </div>
                      </div>

                      {/* Page access — collapsed behind an arrow by default; the
                          admin expands it only when they need to fine-tune. */}
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => togglePages(u.id)}
                          className="flex cursor-pointer items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 hover:text-gray-600"
                          title={
                            expandedPages.has(u.id)
                              ? "Hide page access"
                              : "Show page access (all pages are granted by default)"
                          }
                        >
                          <svg
                            className={`h-3 w-3 transition-transform ${
                              expandedPages.has(u.id) ? "rotate-90" : ""
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
                          Pages
                          {access.size !== PAGES.length && !isAdminRow && (
                            <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700">
                              {access.size}/{PAGES.length} on
                            </span>
                          )}
                        </button>

                        {expandedPages.has(u.id) && (
                          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5">
                            {PAGES.map((p) => {
                              const disabled = lockedRow || isAdminRow;
                              return (
                                <label
                                  key={p.key}
                                  className={`flex items-center gap-1.5 text-xs text-gray-600 ${
                                    disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={access.has(p.key)}
                                    disabled={disabled}
                                    onChange={(e) => handlePageToggle(u.id, p.key, e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 disabled:cursor-not-allowed"
                                  />
                                  {p.label}
                                </label>
                              );
                            })}
                            {isAdminRow && (
                              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600">
                                Admins always see everything
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {notice && (
          <p
            className={`mt-4 text-sm ${
              notice.kind === "ok" ? "text-emerald-600" : "text-red-600"
            }`}
          >
            {notice.text}
          </p>
        )}
      </main>
    </AppLayout>
  );
}
