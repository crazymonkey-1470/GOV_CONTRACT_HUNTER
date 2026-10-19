# ContractHunter

A clean, single-user dashboard for reviewing high-quality U.S. government
contract opportunities surfaced by an AI agent. It reads from a Supabase table,
shows only the strong matches (relevance score ≥ 65), and links each one
straight out to SAM.gov.

Built with **Next.js 15 (App Router) + TypeScript**, **Tailwind CSS + shadcn/ui**,
and **Supabase** (Postgres + Auth).

---

## Features

- 🔐 **Simple, secure login** — email + password via Supabase Auth. No public
  signup; you create the single account by hand.
- 📋 **Scannable list** of opportunities (relevance score ≥ 65), sorted by score.
- 🎯 **Colored relevance badge** — green ≥ 85, orange 75–84, yellow 65–74.
- 💵 Formatted contract **value** (or "Not Specified").
- ⏳ **"X days left"** / "Expired" countdown on every response deadline.
- 🔎 **Search** across title, agency, and summary.
- 🎚️ **Minimum-relevance slider** to tighten the list on the fly.
- 🔗 Each title is a **direct link to SAM.gov** that opens in a new tab.
- 📱 Responsive, with loading skeletons and friendly empty states.

---

## Tech stack

| Layer     | Choice                                        |
| --------- | --------------------------------------------- |
| Framework | Next.js 15 (App Router, Server Components)     |
| Language  | TypeScript                                    |
| Styling   | Tailwind CSS + shadcn/ui                       |
| Data/Auth | Supabase (`@supabase/ssr`)                     |
| Dates     | date-fns                                       |
| Hosting   | Vercel                                         |

---

## 1. Prerequisites

- **Node.js 18.18+** (Node 20+ recommended) and npm.
- A **Supabase project** with the `contract_opportunities` table (see schema
  below). It is normally populated by your upstream AI agent.

---

## 2. Local setup

```bash
# install dependencies
npm install

# create your local env file and fill in the two values
cp env.example .env.local
```

Open `.env.local` and set the values from **Supabase Dashboard → Project
Settings → API**:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

Then start the dev server:

```bash
npm run dev
```

Visit **http://localhost:3000** — you'll be redirected to `/login`.

---

## 3. Database setup (indexes + Row Level Security)

The table already exists, but you should apply the recommended indexes and
security policy. In **Supabase Dashboard → SQL Editor**, paste and run
[`supabase/migrations/001_initial.sql`](supabase/migrations/001_initial.sql).

It is idempotent and safe to run against your existing project. It:

- creates the table only if it's missing (reference schema),
- adds indexes on `relevance_score`, `response_deadline`, and `status`,
- enables **Row Level Security** and adds a policy so only a signed-in user can
  read rows. (Your agent should write rows using the **service-role** key,
  which bypasses RLS.)

### Expected table: `contract_opportunities`

`id`, `notice_id`, `title`, `agency`, `value`, `posted_date`,
`response_deadline`, `sam_link`, `relevance_score`, `summary`, `keywords`,
`naics_codes`, `set_aside`, `customer_fit_notes`, `raw_data`, `status`,
`created_at`.

---

## 4. Create the single user account

There is **no signup screen** — create the one account manually:

1. Go to **Supabase Dashboard → Authentication → Users**.
2. Click **Add user → Create new user**.
3. Enter the email and a strong password.
4. **Check "Auto Confirm User"** (so no confirmation email is required).
5. Click **Create user**.

Sign in at `/login` with those credentials. To change the password later, use
the same Users panel.

> Tip: To prevent anyone else from ever registering, keep email signups
> disabled under **Authentication → Sign In / Providers** (there is no signup
> route in this app regardless).

---

## 5. Deploy to Cloudflare Workers

The dashboard runs on Cloudflare Workers through the OpenNext adapter
(`@opennextjs/cloudflare`). The Worker is `gov-contract-hunter` (see `wrangler.jsonc`)
and is served at quant-agents.org.

- **Automatic:** Cloudflare Workers Builds deploys every push to the production
  branch. The default deploy command (`npx wrangler deploy`) runs the OpenNext build
  first (`build.command` in `wrangler.jsonc`), so no build settings are needed.
- **Manual:** `npm run cf:deploy` (needs `wrangler login`).
- **Local Workers runtime:** `npm run cf:preview`, then open http://localhost:8787.
- **Supabase settings** are public values in `.env.production`, inlined at build time.
  Host environment variables override them. Never put a secret key there.
- No R2 bucket or other bindings are needed: every page renders per request.

## 6. Discovery agents → `agent-ingest` endpoint

Agents never hold a database key. They POST opportunities to the Supabase Edge
Function in `supabase/functions/agent-ingest` with an `x-agent-key` header.
A new `notice_id` is inserted (and flagged if it looks like a duplicate); a known one
only gets its empty fields filled in. The same request can carry a run report,
changes (amendments, cancellations, awards) and ideas for the owner's inbox. It never
deletes. `GET` with a valid key returns the field reference; `?dry_run=1` validates
without writing.

The full bot instructions are in [`docs/agent-guide.md`](docs/agent-guide.md).

To add or revoke an agent, edit `AGENT_KEYS` (SHA-256 hashes of the keys) and redeploy:
`supabase functions deploy agent-ingest --no-verify-jwt`.

---

## Available scripts

| Command         | Description                          |
| --------------- | ------------------------------------ |
| `npm run dev`   | Start the dev server                 |
| `npm run build` | Production build                     |
| `npm run start` | Run the production build locally     |
| `npm run lint`  | Lint the project                     |
| `npm run cf:build`   | Build for Cloudflare Workers (OpenNext) |
| `npm run cf:preview` | Run the Worker locally (workerd)        |
| `npm run cf:deploy`  | Build and deploy to Cloudflare          |

---

## Project structure

```
app/
  layout.tsx              Root layout
  page.tsx                Redirects to /dashboard
  globals.css             Tailwind + design tokens
  error.tsx               Error boundary
  not-found.tsx           404 page
  login/
    page.tsx              Login screen
    actions.ts            signInWithPassword server action
  dashboard/
    page.tsx              Server Component: fetches opportunities
    loading.tsx           Loading skeletons
  auth/
    actions.ts            Sign-out server action
components/
  contract-dashboard.tsx  Client list: search + relevance slider
  contract-card.tsx       Single opportunity card
  relevance-badge.tsx     Colored score badge
  login-form.tsx          Login form (useActionState)
  sign-out-button.tsx     Sign-out button
  ui/                     shadcn/ui primitives
lib/
  supabase/server.ts      Server Supabase client
  supabase/client.ts      Browser Supabase client
  supabase/middleware.ts  Session refresh + route guard
  types.ts                Opportunity type
  format.ts               Currency / date / "days left" helpers
  utils.ts                cn() class helper
middleware.ts             Auth middleware
supabase/migrations/      SQL: indexes + RLS
```

---

## How auth works

- `middleware.ts` runs on every request, refreshes the Supabase session, and
  redirects unauthenticated visitors to `/login`.
- The login form calls a **server action** (`signInWithPassword`) and, on
  success, redirects to `/dashboard`.
- The dashboard is a **Server Component** that fetches data with the session
  cookie, so Row Level Security applies.

## Notes

- Only opportunities with `relevance_score >= 65` are fetched; the slider can
  raise that threshold client-side.
- If you change the table's column types, update [`lib/types.ts`](lib/types.ts).
  The formatting helpers already tolerate `value`/`keywords` arriving as numbers,
  strings, or arrays.
