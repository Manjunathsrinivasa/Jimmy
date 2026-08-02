import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { login } from "../api/auth";
import { useAuthStore } from "../store/authStore";

const FEATURES = [
  {
    title: "Pipeline-driven workflows",
    desc: "Design stages, approvals and decision branches that mirror how your team actually works.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M13 4.5a2.5 2.5 0 11.702 1.737L6.97 9.604a2.518 2.518 0 010 .792l6.732 3.367a2.5 2.5 0 11-.671 1.341l-6.731-3.367a2.5 2.5 0 110-3.475l6.731-3.366A2.52 2.52 0 0113 4.5z" />
      </svg>
    ),
  },
  {
    title: "Approvals that actually gate",
    desc: "Blocks wait for the right approver — rejected steps are resent, never lost.",
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
    title: "Reports from real pipeline data",
    desc: "Build shareable, filterable reports scoped to each pipeline — export to Excel in one click.",
    icon: (
      <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
        <path d="M1 2.75A.75.75 0 011.75 2h16.5a.75.75 0 010 1.5H18v8.5A2.75 2.75 0 0115.25 15H9.75v2.25h3.5a.75.75 0 010 1.5h-6.5a.75.75 0 010-1.5h3.5V15H4.75A2.75 2.75 0 012 12.25V3.5h-.25A.75.75 0 011 2.75zM6.5 6a1 1 0 100 2h7a1 1 0 100-2h-7zM5.5 10.5a1 1 0 011-1h4a1 1 0 010 2h-4a1 1 0 01-1-1z" />
      </svg>
    ),
  },
];

function BrandLogo({ className = "h-10 w-10" }) {
  return (
    <div
      className={`flex ${className} shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-600/30`}
    >
      <svg className="h-1/2 w-1/2" viewBox="0 0 20 20" fill="currentColor">
        <path
          fillRule="evenodd"
          d="M10 1a9 9 0 00-6.364 15.364L3 18.5l2.636-1.636A9 9 0 1010 1zm3.62 10.42c-.31.27-.71.41-1.12.44-.27.02-.51.13-.69.35-.37.46-.83 1-1.58 1-.75 0-1.21-.54-1.58-1-.18-.22-.42-.33-.69-.35-.41-.03-.81-.17-1.12-.44-.26-.23-.11-.61.23-.61.34 0 .66.1.94.27.11.06.23.1.35.12.29.04.57-.07.78-.29l.13-.13a1.6 1.6 0 00-.3-.62c-.32-.5-.77-1.03-1.38-1.18-.3-.07-.44-.42-.27-.67.15-.23.43-.3.68-.19.38.17.79.45 1.1.8.15.17.26.36.37.55.1-.2.22-.38.37-.55.31-.35.72-.63 1.1-.8.25-.11.53-.04.68.19.17.25.03.6-.27.67-.61.15-1.06.68-1.38 1.18a1.6 1.6 0 00-.3.62l.13.13c.21.22.49.33.78.29.12-.02.24-.06.35-.12.28-.17.6-.27.94-.27.34 0 .49.38.23.61z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

export default function Login() {
  const token = useAuthStore((s) => s.token);
  const setAuth = useAuthStore((s) => s.setAuth);
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Already signed in? Go straight to the dashboard.
  if (token) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    setSubmitting(true);
    try {
      const data = await login(email.trim(), password);
      setAuth(data.token, data.user);
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ===== Brand panel ===== */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-indigo-700 via-indigo-600 to-violet-600 p-12 text-white lg:flex">
        {/* Decorative shapes */}
        <div className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-white/10 blur-2xl" />
        <div className="pointer-events-none absolute -bottom-32 -left-20 h-80 w-80 rounded-full bg-violet-400/20 blur-2xl" />
        <div className="pointer-events-none absolute right-10 top-1/3 h-40 w-40 rounded-3xl border border-white/15" />
        <div className="pointer-events-none absolute bottom-24 right-24 h-24 w-24 rounded-full border border-white/10" />

        <div className="relative flex items-center gap-3">
          <BrandLogo />
          <div>
            <p className="text-xl font-bold tracking-tight">YoJan</p>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-indigo-200">
              Project Management
            </p>
          </div>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl font-bold leading-tight tracking-tight">
            Every project, stage and approval — orchestrated.
          </h2>
          <p className="mt-4 text-indigo-100/90">
            Design the pipeline once, then run every engagement through it with clarity,
            accountability and clean reporting.
          </p>

          <ul className="mt-10 space-y-5">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex items-start gap-4">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
                  {f.icon}
                </span>
                <div>
                  <p className="font-semibold">{f.title}</p>
                  <p className="mt-0.5 text-sm text-indigo-100/80">{f.desc}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center gap-6 text-sm">
          <p className="text-indigo-100/80">
            Trusted by delivery teams who need{" "}
            <span className="font-semibold text-white">auditable workflows</span>.
          </p>
        </div>
      </div>

      {/* ===== Form panel ===== */}
      <div className="flex w-full items-center justify-center bg-slate-50 px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandLogo className="h-11 w-11" />
            <div>
              <p className="text-lg font-bold tracking-tight text-gray-900">YoJan</p>
              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                Project Management
              </p>
            </div>
          </div>

          <h1 className="text-2xl font-bold tracking-tight text-gray-900">Welcome back</h1>
          <p className="mt-1.5 text-sm text-gray-500">Sign in to your workspace to continue.</p>

          <form onSubmit={handleSubmit} className="mt-8 space-y-5">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-gray-700">
                Email
              </label>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                  <path d="M19 8.808l-7.621 3.81a2.75 2.75 0 01-2.758 0L1 8.808V14a2 2 0 002 2h14a2 2 0 002-2V8.808z" />
                </svg>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="input pl-9"
                />
              </div>
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="text-sm font-semibold text-gray-700">
                  Password
                </label>
                <span className="text-xs text-gray-400">8+ characters</span>
              </div>
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z"
                    clipRule="evenodd"
                  />
                </svg>
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input pl-9 pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
                  title={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fillRule="evenodd"
                        d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 003.374 3.374l1.091 1.092a4 4 0 01-5.557-5.557z"
                        clipRule="evenodd"
                      />
                      <path d="M10.748 13.93l2.523 2.523a9.987 9.987 0 01-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 010-1.186A10.007 10.007 0 012.839 6.02L4.18 7.36a8.51 8.51 0 00-.962 2.64A8.51 8.51 0 005.918 12.9a8.51 8.51 0 003.208 1.223l1.622-1.193zM16.752 13.6l1.513 1.513a10.05 10.05 0 001.276-3.102 1.651 1.651 0 000-1.186C18.014 6.66 14.38 4 10.116 4c-1.142 0-2.244.186-3.27.547l1.334 1.334a8.51 8.51 0 014.822 1.913 8.5 8.5 0 011.91 1.91l1.84-1.104z" />
                    </svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
                      <path
                        fillRule="evenodd"
                        d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
                {error}
              </p>
            )}

            <button type="submit" disabled={submitting} className="btn btn-primary w-full py-2.5">
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            No account?{" "}
            <Link to="/signup" className="font-semibold text-indigo-600 hover:text-indigo-500">
              Create your workspace
            </Link>
          </p>

          <p className="mt-10 text-center text-[11px] text-gray-400">
            © {new Date().getFullYear()} YoJan · Enterprise project operations
          </p>
        </div>
      </div>
    </div>
  );
}
