# Automate Job Application

Enterprise-grade automated job application system (Bun + TypeScript, Express, Prisma, Redis Streams + Pub/Sub, Next.js).

## Stack

- Runtime: `bun`
- API: `express` + `ws`
- Queue: `redis streams` (jobs) + `redis pub/sub` (events)
- Database: `postgres` + `prisma`
- Frontend: `next.js` (App Router)

## Repo layout

- `apps/api` API server
- `apps/worker` Queue worker
- `apps/web` Dashboard UI
- `packages/shared` Shared types
- `prisma` Prisma schema and migrations

## Prerequisites

1. `bun` installed
2. `docker` running

## Quick start

1. Start dependencies
```bash
docker compose up -d
```

2. Install deps
```bash
bun install
```

3. Configure environment
```bash
cp .env.example .env
```

4. Generate Prisma client and migrate
```bash
bun run db:generate
bun run db:migrate
```

5. Install Playwright browsers (first time only)
```bash
bunx playwright install chromium
```

6. Run the stack
```bash
bun run dev
```

## Docker (all services)

Build and run everything (API + worker + web + Postgres + Redis):

```bash
docker compose up --build
```

The API container will automatically run `prisma migrate deploy` on startup.

Stop all services:

```bash
docker compose down
```

## Scripts

- `bun run dev` start API + worker + web
- `bun run dev:api` start API only
- `bun run dev:worker` start worker only
- `bun run dev:web` start web only
- `bun run db:generate` generate Prisma client
- `bun run db:migrate` run Prisma migrations

## Environment

Single env file at repo root: `.env`

## Notes

- WebSocket endpoint: `ws://localhost:3001/ws?token=dev-token`
- API endpoint: `http://localhost:3001`
- `HEADLESS=false` opens a visible browser for automation.
- `BROWSER_CHANNEL=chrome` uses your installed Chrome (optional).
- `AUTO_SUBMIT=false` stops at final review so you can submit manually.
- First run requires login in the opened browser (LinkedIn/Indeed).
- `MANUAL_HOLD_MS` controls how long the review window stays open.
- `AI_SCORING=true` enables Gemini scoring (limit with `AI_SCORE_LIMIT`).
- `AI_ANSWER_ENABLED=true` enables AI answers for application questions.
- `AI_ANSWER_LIMIT=3` caps AI answers per form step.
- `COVER_LETTER_ENABLED=true` generates a cover letter per application.
- `RESUME_TAILOR_ENABLED=true` saves a tailored resume snapshot per application.
- `AI_PROVIDER=auto` chooses the LLM provider (`openai`, `gemini`, `auto`).
- `OPENAI_API_KEY` enables OpenAI usage (server-side only).
- `OPENAI_MODEL` sets the OpenAI model (default: `gpt-4o-mini`).

## Discovery

- Discovery runs every 24h by default (`DISCOVERY_INTERVAL_MS`).
- Scheduled sources: Remotive + Arbeitnow (public APIs).
- Automation sources: LinkedIn + Indeed (via Playwright, requires login).
- Configure preferences in the dashboard: `/dashboard/settings`.
- API endpoints: `POST /users`, `GET /users?email=...`, `POST /preferences`, `GET /preferences/:userId`, `POST /automation/start`.

## Automation

- `Start applying` triggers browser automation for LinkedIn + Indeed.
- `AUTO_SUBMIT=false` stops at final review so you can submit manually.
- First run requires login in the opened browser; session is reused.

## Resume parsing

1. Add `GEMINI_API_KEY` to `.env`.
2. (Optional) Add `OPENAI_API_KEY` and set `AI_PROVIDER=openai` or choose OpenAI in the dashboard.
3. Open `/dashboard/settings`, upload a resume PDF, click **Upload & parse**.

## AI scoring & cover letters

- The worker derives keywords/roles from your parsed resume if preferences are empty.
- AI scoring uses Gemini (if enabled) for up to `AI_SCORE_LIMIT` jobs per run.
- Cover letters are generated per application and saved in the database.
- Tailored resumes are saved per application in `artifacts/resumes/`.
- AI answers autofill short text, dropdown, and radio/checkbox questions.

## Documents

- Download tailored resumes and cover letters as PDF from `/dashboard/resume-viewer`.
- Generate interview prep per application and view it in the same panel.

Quick setup (example):

```bash
curl -X POST http://localhost:3001/users -H 'Content-Type: application/json' \\
  -d '{"email":"you@example.com","fullName":"Your Name"}'

curl -X POST http://localhost:3001/preferences -H 'Content-Type: application/json' \\
  -d '{"userId":"<USER_ID>","roles":["software engineer"],"keywords":["react","typescript"],"locations":["remote"],"remote":true}'
```

## Progress

- Monorepo scaffold with Bun workspaces
- Express API with WebSocket event streaming
- Redis Streams job queue + Redis Pub/Sub for events
- Prisma schema (core + resume/cover letter/import/notifications)
- Worker consumer loop for stream jobs
- Discovery scheduler (daily) with Remotive + Arbeitnow sources
- Next.js dashboard shell (Overview, Jobs, Queue, Logs, Settings)
- Discovery UI (create user + preferences)
- Discovery results UI (matches + jobs + runs)
- Start applying button (automation trigger)
- Playwright automation (LinkedIn + Indeed, stops at final review)
- Resume upload + Gemini parsing (profile extraction)
- AI scoring + cover letter generation
- Resume & cover letter viewer UI
- PDF export for tailored resume and cover letter
- Interview prep generation (AI)
- Auto-fill common form fields from resume profile
- Tailored resume snapshots per application
- AI answers for text + dropdown/radio/checkbox questions
- Live overview metrics + WebSocket log stream
- Queue status view backed by live application data
- Bulk job import endpoint + UI (paste multiple URLs)
- Email notifications on status updates (SMTP)
- Analytics dashboard (conversion + platform breakdown)
- Chrome extension (one-click save/apply)

## Roadmap

- More platform adapters (Lever, Greenhouse, Wellfound)
- Resume PDF rendering (LaTeX or HTML/PDF)

## Chrome extension

Location: `apps/extension`

Load it in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/extension`

Configure the API URL + User ID (Options page), then click **Save & apply** to queue a job.

## Analytics

Dashboard: `/dashboard/analytics`

API: `GET /analytics/summary?userId=...`
