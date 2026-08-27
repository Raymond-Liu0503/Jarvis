# Jarvis Research Workspace

Jarvis is a hosted, text-first research workspace with mode-aware hubs for Stocks, Travel, and Shopping. Quick mode answers bounded questions; Deep Research uses an Inngest workflow with three fixed specialists and a cited, private report.

The repository works without credentials: dashboards render cached demo snapshots. Live chat and provider refreshes activate only when their environment variables are configured.

## Run locally

Use Node 22 LTS.

```bash
cp .env.example .env.local
npm install
npm run dev
```

Then open `http://localhost:3000`. Run `npm test`, `npm run typecheck`, and `npm run build` before deployment.

## Architecture

- Next.js App Router, strict TypeScript, React, Tailwind CSS
- Vercel AI SDK with OpenRouter and environment-selected model roles
- Inngest at `/api/inngest` for durable research and refresh jobs
- Supabase Auth/Postgres; the initial migration enables RLS on every user-owned table
- Vendor-neutral provider contracts in `lib/providers/contracts.ts`
- Typed mode registry in `lib/research/modes.ts`; shared routing and orchestration do not branch on hub internals

Production adapters must validate and normalize vendor responses. URL-based shopping intake may extract first-party JSON-LD in a constrained provider; arbitrary server-side URL fetching is not allowed. Tool access is read-only and scoped to each mode.

## MVP boundaries

Jarvis recommends and links outward. It cannot trade, book, purchase, or prepare a transaction. Refresh is hub-open or manual only—there are no scheduled monitors or alerts. Financial output is informational. Travel and commerce observations retain currency, retrieval time, expiry, and a verification notice. Duffel stays off unless `ENABLE_DUFFEL=true` and production access is configured.

The in-memory run store is a development fallback. Production deployments must persist runs through Supabase and authenticate every route; service-role workflow mutations must re-check the stored `user_id` before writing.
