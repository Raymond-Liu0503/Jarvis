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

Quick mode requires `OPENROUTER_API_KEY` and `MODEL_FAST`. Postgres-backed Deep Research additionally requires `MODEL_REASONING`, `MODEL_SYNTHESIS`, and the providers used by the selected skills. The default local backend is `RESEARCH_EXECUTION_BACKEND=postgres`; the worker owns queue delivery and LangGraph execution.

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

Deep Research has bounded failure behavior: model/provider calls receive one SDK retry, queue jobs use leases and fenced retries, each run has a five-minute absolute deadline, and the browser stops polling after five consecutive API failures. Handled provider failures are recorded as terminal and are not re-run.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build`. Skill packages can also be checked with the skill validator:

```bash
for skill in skills/*; do python3 /home/raliu/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"; done
```

The legacy Inngest path remains available behind `RESEARCH_EXECUTION_BACKEND=inngest` during migration. The Postgres path stores ownership-protected run state in Supabase and uses a dedicated worker; APIs do not execute research inline.

## Safety boundaries

Jarvis uses read-only research tools and recommends or links outward. It cannot trade, book, purchase, or prepare a transaction. Financial output is informational; travel and commerce prices and availability require provider verification.
