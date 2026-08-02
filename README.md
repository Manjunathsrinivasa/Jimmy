# YoJan

A workflow & project management tool. Teams model repeatable processes as
**pipelines** (visual workflows with stages, parallel forks/joins, and approvals),
then spin up **projects** — live instances where each stage is assigned to a
person who fills in its fields and marks it done. The workflow auto-advances:
a `parallel_join` only unlocks once *every* branch feeding it is complete.

## Stack

- **Backend** — Node.js + Express 5, Prisma 7 ORM, PostgreSQL
- **Frontend** — React 19 + Vite + Tailwind CSS v4, `@xyflow/react` canvas,
  Zustand (auth state), React Hook Form (stage forms)

---

## 1. Start the database (and cache)

PostgreSQL runs in Docker. From the project root:

```bash
docker compose up -d
```

> The repo expects a `docker-compose.yml` at the root. If it isn't there yet,
> a minimal version that matches `DATABASE_URL` in `.env` looks like the
> following (use whatever password your `.env` actually has):
>
> ```yaml
> services:
>   db:
>     image: postgres:16
>     environment:
>       POSTGRES_USER: postgres
>       POSTGRES_PASSWORD: postgres
>       POSTGRES_DB: jimmy
>     ports:
>       - "5432:5432"
> ```

`DATABASE_URL` in `.env` should point at this instance
(e.g. `postgresql://postgres:postgres@localhost:5432/jimmy?schema=public`).
The app itself doesn't yet use a cache; if you add one (e.g. Redis), run it as
another service in the same compose file.

## 2. Run the migration and seed

Load `.env` first so Prisma picks up `DATABASE_URL`:

```bash
set -a && source .env && set +a
```

Apply the existing migration(s):

```bash
npx prisma migrate deploy        # apply pending migrations (fresh clone)
npx prisma migrate dev           # during development: create + apply new ones
```

Seed the demo workspace:

```bash
npx prisma db seed
# or directly:
node backend/prisma/seed.js
```

The seed creates **Demo Org**, an admin user, and the published **Leapfrog**
pipeline. It is **idempotent but destructive** — re-running it wipes all Demo
Org data (including any projects you've created) and recreates it.

## 3. Start the backend and frontend dev servers

**Terminal 1 — backend** (port 3000):

```bash
set -a && source .env && set +a
PORT=3000 npm start
# (equivalent: node backend/src/index.js)
```

**Terminal 2 — frontend** (port 5173):

```bash
cd frontend
npm install
npm run dev
```

- App: http://localhost:5173
- Backend health check: http://localhost:3000/ping
- The frontend proxies `/api/*` to the backend (Vite config), so API calls
  from the browser go through `/api` — no CORS setup needed.

## 4. Demo login

| Role  | Email                 | Password |
| ----- | --------------------- | -------- |
| Admin | `admin@flowpm.dev`    | `demo1234` |

The current local database also has test users created during development
(`dev1@demo.flowpm`, `dev2@demo.flowpm`, `mgr@demo.flowpm`, all `demo1234`) —
they are not part of the seed script, so they disappear if you re-seed.

## 5. What's built so far — and what isn't

**Built:**

- **Auth** — register/login (bcrypt + JWT), organizations, roles
  (admin / manager / contributor / approver / viewer), tiers
  (free / individual / enterprise)
- **Pipelines** — create, list, get, update (draft only), publish (snapshots a
  version), clone; admin/manager only; free tier capped at 5 pipelines
- **Pipeline builder** — drag-and-drop canvas (`@xyflow/react`), 7 node types
  (Start, Stage, Parallel Fork/Join, Decision, Approval, End), per-node field
  definitions (Text, Number, Date, Dropdown, File Upload, User Picker,
  Checkbox, Currency — the schema also has `textarea` and `multiselect`)
  with required/order editing, snap-to-grid, duplicate label auto-suffix,
  auto-layout
- **Projects** — create from a published pipeline (each fork branch → one
  stage per assignee), my-projects list, detail view with ordered stages +
  saved field values, stage PATCH (status / field values / assignee / due
  date) with flow control (parallel joins stay blocked until all branches
  are done), delete, and a comments API
- **Project detail UI** — read-only flow canvas with active-stage highlight,
  per-stage form built from field definitions with saved defaults
  (React Hook Form), "no action needed" state for unassigned users, and a
  per-stage comment thread (post, relative timestamps, viewer avatars)
- **New Project wizard** — published-pipeline picker, manager picker,
  per-branch assignee pickers with duplicate-assignee warning
- **Overview dashboard** — my tasks (sorted by due date), my projects with
  progress bars, pending-my-approval list
- **Saved reports** — project-level report definitions that admins/managers
  create from any combination of project columns and pipeline stage fields
  (all stages of all pipelines are offered), share with multiple viewers, and
  export/print; viewers see only the reports granted to them
- **Demo seed** — Demo Org + admin + published Leapfrog pipeline

**Not built (yet):**

- **Notifications** — no email/in-app notification system
- **Conditional logic UI** — Decision nodes exist in the schema and canvas,
  but there's no branching runtime behind them yet
- **Billing** — tiers exist in the data model (and gate pipeline limits),
  but there's no billing/checkout
- **SSO** — no SSO/OIDC/enterprise sign-in

