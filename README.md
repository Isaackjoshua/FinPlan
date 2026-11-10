# FinPlan

A personal finance platform where you connect your own AI agent to build and keep a financial
plan. The platform stores the data and does the arithmetic; the agent does the thinking.

The design, data model and milestones are in [docs/PLAN.md](docs/PLAN.md).

## Status

| Milestone | State |
|---|---|
| 1. Core platform (accounts, profile, goals, versioned plans, check-ins, dashboard) | Done |
| 2. Calculation engine | Not started |
| 3. Literacy module | Not started |
| 4. MCP server and OAuth | Not started |
| 5. Agent management page | Not started |

## Run it locally

Needs Node 22.19 or newer, pnpm, and Docker.

```sh
cp .env.example .env
# fill in DATA_MASTER_KEY and BETTER_AUTH_SECRET, each with: openssl rand -base64 32

pnpm install
pnpm db:up        # Postgres on port 5433, Mailpit inbox on http://localhost:8025
pnpm db:migrate
pnpm dev          # http://localhost:3000
```

Sign-up sends a confirmation email. In development it lands in Mailpit, not a real inbox.

## Tests

```sh
pnpm test         # unit and database tests (needs `pnpm db:up`)
pnpm typecheck
pnpm build && pnpm --filter @fin/web start   # then, in another terminal:
pnpm smoke        # walks through the real pages end to end
```

## Layout

```
apps/web        Next.js app: sign-up, dashboard, profile, goals, plan, check-ins
packages/core   Domain logic. The only code that reads or writes financial data
packages/db     Database schema and migrations
scripts/        End-to-end smoke test
```

## Handling of financial data

- Labels, amounts, rates and notes are encrypted before they reach the database, with a key per
  user. `DATA_MASTER_KEY` wraps those keys: **if it is lost, the data cannot be recovered**, so
  back it up separately from the database.
- Saved plan versions are never changed. Reverting moves a pointer to an earlier version.
- This platform supports education and planning. It does not give investment advice.
