# Jarvis Research Workspace

Jarvis is a private, unified research workspace. Users ask from one hub; Jarvis automatically routes each turn to one or more installed skills and uses either a bounded Quick workflow or durable Deep Research with cited evidence.

## Run locally

Use Node 22 LTS and Docker. Copy `.env.example` to `.env.local`, install dependencies, and start the local Supabase stack:

```bash
cp .env.example .env.local
npm install
npm run supabase:start
npx supabase status
```

Set `NEXT_PUBLIC_SUPABASE_URL` to the local API URL (normally `http://127.0.0.1:54321`) and set `NEXT_PUBLIC_SUPABASE_ANON_KEY` to the local anon key shown by `supabase status`. Keep the local `DATABASE_URL` from `.env.example` unless your Supabase CLI reports a different database connection.

Initialize LangGraph's checkpoint tables, then run Next.js and the worker in separate terminals:

```bash
npm run checkpointer:setup
npm run dev
npm run dev:worker
```

Alternatively, after Supabase is running and the checkpoint tables are initialized, use `npm run dev:all`. Open `http://localhost:3000`, register a local account, and sign in.

## Shut down locally

Press `Ctrl+C` in the terminal running `npm run dev` or `npm run dev:all`. If the worker is running in a separate terminal, press `Ctrl+C` there as well. Stop the local Supabase services with:

```bash
npx supabase stop
```

This stops the containers while preserving the local database volume. Start them again with `npm run supabase:start`.

Quick mode requires `OPENROUTER_API_KEY` and `MODEL_FAST`. Postgres-backed Deep Research additionally requires `MODEL_REASONING`, `MODEL_SYNTHESIS`, and the providers used by the selected skills. `MODEL_WEB_RESEARCH` optionally selects a compact source-reranking model and otherwise uses `MODEL_FAST`; retrieval still works with deterministic ranking when that model is unavailable. The worker owns queue delivery and LangGraph execution.

Web research makes one bounded Exa request per Quick turn or specialist, returns at most ten ranked sources, and caches normalized results per user for six hours by default. `WEB_RESEARCH_CONCURRENCY` defaults to `2`. Model input is capped at 16K estimated tokens. Normal logs include section sizes and provider usage but not prompt text; set `RESEARCH_DEBUG_PAYLOADS=redacted` only in local development for capped, redacted prompt previews.

To apply migrations from a clean local database:

```bash
npm run supabase:reset
npm run checkpointer:setup
```

## Skill architecture

Skills are trusted packages under `skills/` and are discovered automatically. Every package contains:

- `SKILL.md` with concise routing metadata and domain instructions.
- `agents/jarvis.yaml` with validated intake fields, tools, limits, and specialist lenses.
- `references/` with prompts loaded only after the skill is selected.

`general-research` is the required fallback. The shared research core—not individual skills—owns security, evidence, citation, execution, and transaction boundaries. Adding a deployed skill folder requires no registry edit.

The router can compose up to three skills. Deep Research plans three or four specialists total, shares a 20-source evidence budget, and records structured routing and execution events without storing hidden chain-of-thought.

Deep Research has bounded failure behavior: model/provider calls receive one SDK retry, queue jobs use leases and fenced retries, and each active execution has a five-minute deadline. The deadline pauses while waiting for human input and restarts on resume. The browser stops polling after five consecutive API failures.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build`. Skill packages can also be checked with the skill validator:

```bash
for skill in skills/*; do python3 /home/raliu/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"; done
```

The PostgreSQL path stores ownership-protected run state, job attempts, leases, and checkpoints in Supabase and uses a dedicated worker; APIs do not execute research inline. Set `WORKER_CONCURRENCY` and `DATABASE_POOL_MAX` together; the pool must have at least one more connection than worker concurrency.

## Safety boundaries

Jarvis uses read-only research tools and recommends or links outward. It cannot trade, book, purchase, or prepare a transaction. Financial output is informational; travel and commerce prices and availability require provider verification.
