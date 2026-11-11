# FinPlan

A personal finance platform where you connect your own AI agent to build and keep a financial
plan. The platform stores the data and does the arithmetic; the agent does the thinking.

The design, data model and milestones are in [docs/PLAN.md](docs/PLAN.md).

## Status

| Milestone | State |
|---|---|
| 1. Core platform (accounts, profile, goals, versioned plans, check-ins, dashboard) | Done |
| 2. Calculation engine (budget, debt payoff, emergency fund, savings projection) | Done |
| 3. Literacy module (lessons, quizzes, progress, suggestions) | Done |
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
pnpm test         # unit, property and database tests (needs `pnpm db:up`)
pnpm test:coverage  # same, and fails unless the calculation engine is 100% covered
pnpm typecheck
pnpm build && pnpm --filter @fin/web start   # then, in another terminal:
pnpm smoke        # walks through the real pages end to end
```

## Deploying

See [docs/DEPLOY.md](docs/DEPLOY.md) for running it on a single server with HTTPS.

## Layout

```
apps/web        Next.js app: sign-up, dashboard, profile, goals, plan, check-ins, lessons
packages/calc   Calculation engine: pure functions, no I/O, no dependencies
packages/core   Domain logic. The only code that reads or writes financial data
                Lesson content is in packages/core/src/content
packages/db     Database schema and migrations
scripts/        End-to-end smoke test
deploy/         Production Docker Compose stack and Caddy config
```

## Handling of financial data

- Labels, amounts, rates and notes are encrypted before they reach the database, with a key per
  user. `DATA_MASTER_KEY` wraps those keys: **if it is lost, the data cannot be recovered**, so
  back it up separately from the database.
- Saved plan versions are never changed. Reverting moves a pointer to an earlier version.
- This platform supports education and planning. It does not give investment advice.
