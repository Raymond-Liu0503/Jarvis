# Jarvis Research Workspace

Jarvis is a private, unified research workspace. Users ask from one hub; Jarvis automatically routes each turn to one or more installed skills and uses either a bounded Quick workflow or durable Deep Research with cited evidence.

## Run locally

Use Node 22 LTS, copy `.env.example` to `.env.local`, then run `npm install` and `npm run dev`. Open `http://localhost:3000`.

Quick mode requires `OPENROUTER_API_KEY` and `MODEL_FAST`. Deep Research additionally requires `MODEL_REASONING`, `MODEL_SYNTHESIS`, Exa, and Inngest. For local durable workflows set `INNGEST_DEV=1`, start the app, then run:

```bash
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
```

The Inngest serve endpoint is `/api/inngest` and exposes GET, POST, and PUT handlers.

## Skill architecture

Skills are trusted packages under `skills/` and are discovered automatically. Every package contains:

- `SKILL.md` with concise routing metadata and domain instructions.
- `agents/jarvis.yaml` with validated intake fields, tools, limits, and specialist lenses.
- `references/` with prompts loaded only after the skill is selected.

`general-research` is the required fallback. The shared research core—not individual skills—owns security, evidence, citation, execution, and transaction boundaries. Adding a deployed skill folder requires no registry edit.

The router can compose up to three skills. Deep Research plans three or four specialists total, shares a 20-source evidence budget, and records structured routing and execution events without storing hidden chain-of-thought.

Deep Research has bounded failure behavior: model/provider calls receive one SDK retry, Inngest does not rerun failed research steps, each run has a five-minute absolute deadline, and the browser stops polling after five consecutive API failures. Handled provider failures are recorded as terminal and are not re-run.

## Checks

Run `npm test`, `npm run typecheck`, and `npm run build`. Skill packages can also be checked with the skill validator:

```bash
for skill in skills/*; do python3 /home/raliu/.codex/skills/.system/skill-creator/scripts/quick_validate.py "$skill"; done
```

The current in-memory stores are development fallbacks. Migration `0002_skill_architecture.sql` adds skill-aware persistence and trace tables with RLS for Supabase deployments.

## Safety boundaries

Jarvis uses read-only research tools and recommends or links outward. It cannot trade, book, purchase, or prepare a transaction. Financial output is informational; travel and commerce prices and availability require provider verification.
