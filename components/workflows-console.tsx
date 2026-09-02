"use client";
import { useCallback, useEffect, useState } from "react";
import { RefreshCw, RotateCcw, XCircle } from "lucide-react";

type Job = { id: string; runId: string | null; kind: string; status: string; attempts: number; maxAttempts: number; leaseOwner: string | null; errorCode: string | null; errorMessage: string | null; createdAt: string };
type Detail = { job: Record<string, unknown>; attempts: Array<Record<string, unknown>>; run: Record<string, unknown> | null; events: Array<Record<string, unknown>> };
type Listing = { jobs: Job[]; nextCursor: string | null; health: Record<string, number | null> };

export function WorkflowsConsole() {
  const [listing, setListing] = useState<Listing>();
  const [selected, setSelected] = useState<string>();
  const [detail, setDetail] = useState<Detail>();
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [runId, setRunId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const params = new URLSearchParams(); if (status) params.set("status", status); if (kind) params.set("kind", kind); if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(runId)) params.set("runId", runId); if (from) params.set("from", new Date(from).toISOString()); if (to) params.set("to", new Date(to).toISOString());
    const response = await fetch(`/api/ops/jobs?${params}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Could not load workflow operations");
    setListing(await response.json());
  }, [from, kind, runId, status, to]);
  useEffect(() => { void load().catch(e => setError(e.message)); const timer = setInterval(() => { if (document.visibilityState === "visible") void load(); }, 5_000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { if (!selected) { setDetail(undefined); return; } void fetch(`/api/ops/jobs/${selected}`, { cache: "no-store" }).then(r => r.json()).then(setDetail); }, [selected, listing]);
  async function mutate(url: string, prompt: string) { if (!confirm(prompt)) return; const response = await fetch(url, { method: "POST" }); const body = await response.json(); if (!response.ok) setError(body.error ?? "Operation failed"); else { setError(""); await load(); } }
  const health = listing?.health ?? {};
  return <main className="noise min-h-screen px-5 py-9 md:px-9"><div className="mx-auto max-w-7xl">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><div className="text-[10px] tracking-[.2em] text-[#718078]">OPERATOR CONSOLE</div><h1 className="serif mt-2 text-4xl">Workflow operations</h1></div><button className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" onClick={() => void load()}><RefreshCw size={14}/>Refresh</button></div>
    {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">{[
      ["Queued", health.queued ?? 0], ["Retrying", health.retry_scheduled ?? 0], ["Running", health.running ?? 0],
      ["Oldest queued", health.oldest_queued_seconds == null ? "—" : `${health.oldest_queued_seconds}s`],
      ["Workers / leases", `${health.active_workers ?? 0} / ${health.active_leases ?? 0}`], ["24h failure", `${health.failure_rate_24h ?? 0}%`],
    ].map(([label,value]) => <div className="card p-4" key={label}><div className="text-xs text-[#69756e]">{label}</div><div className="mt-2 text-2xl">{value}</div></div>)}</section>
    <div className="mt-6 flex flex-wrap gap-3"><select className="rounded-lg border bg-white px-3 py-2 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{["queued","running","retry_scheduled","completed","cancelled","dead_lettered"].map(v => <option key={v}>{v}</option>)}</select><select className="rounded-lg border bg-white px-3 py-2 text-sm" value={kind} onChange={e => setKind(e.target.value)}><option value="">All kinds</option><option>research.start</option><option>research.resume</option></select><input className="min-w-64 rounded-lg border bg-white px-3 py-2 text-sm" value={runId} onChange={e => setRunId(e.target.value.trim())} placeholder="Run ID"/><label className="text-xs text-[#69756e]">From<input type="datetime-local" className="ml-2 rounded-lg border bg-white px-2 py-1.5 text-sm" value={from} onChange={e => setFrom(e.target.value)}/></label><label className="text-xs text-[#69756e]">To<input type="datetime-local" className="ml-2 rounded-lg border bg-white px-2 py-1.5 text-sm" value={to} onChange={e => setTo(e.target.value)}/></label></div>
    <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]"><div className="card overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-[#69756e]"><th className="p-3">Created</th><th>Kind</th><th>Status</th><th>Attempts</th><th>Worker</th></tr></thead><tbody>{listing?.jobs.map(job => <tr key={job.id} onClick={() => setSelected(job.id)} className={`cursor-pointer border-b last:border-0 hover:bg-[#f4f2eb] ${selected === job.id ? "bg-[#e8f4d5]" : ""}`}><td className="p-3 whitespace-nowrap">{new Date(job.createdAt).toLocaleString()}</td><td>{job.kind}</td><td>{job.status.replaceAll("_"," ")}</td><td>{job.attempts}/{job.maxAttempts}</td><td className="max-w-40 truncate">{job.leaseOwner ?? "—"}</td></tr>)}</tbody></table></div>
      <aside className="card min-h-80 p-4">{detail ? <><div className="flex items-center justify-between"><h2 className="serif text-xl">Job detail</h2><span className="text-xs">{String(detail.job.status)}</span></div><p className="mt-2 break-all text-xs text-[#69756e]">{String(detail.job.id)}</p>{detail.job.error_code ? <div className="mt-4 rounded-lg bg-red-50 p-3 text-sm"><b>{String(detail.job.error_code)}</b><p>{String(detail.job.last_error ?? "")}</p></div> : null}<h3 className="mt-5 text-sm font-semibold">Attempt timeline</h3><div className="mt-2 space-y-2">{detail.attempts.map(a => <div key={String(a.id)} className="border-l-2 pl-3 text-xs"><b>Attempt {String(a.attempt_number)}</b> · {String(a.outcome ?? "running")}<div className="text-[#69756e]">{String(a.worker_id)}</div>{a.error_message ? <p>{String(a.error_message)}</p> : null}</div>)}</div><h3 className="mt-5 text-sm font-semibold">Execution events</h3><div className="mt-2 max-h-40 space-y-1 overflow-auto">{detail.events.map(event => <div key={String(event.id)} className="text-xs"><span>{String(event.event_type).replaceAll(".", " ")}</span><time className="ml-2 text-[#69756e]">{new Date(String(event.created_at)).toLocaleString()}</time></div>)}</div><div className="mt-5 flex gap-2">{detail.job.status === "dead_lettered" && <button onClick={() => void mutate(`/api/ops/jobs/${selected}/replay`, "Replay this dead-lettered job from its saved checkpoint?")} className="flex items-center gap-1 rounded-lg bg-[#b7f34b] px-3 py-2 text-xs"><RotateCcw size={13}/>Replay</button>}{detail.run && !["completed","partial","failed","cancelled"].includes(String(detail.run.status)) && <button onClick={() => void mutate(`/api/ops/runs/${String(detail.run?.id)}/cancel`, "Cancel this run across all workers?")} className="flex items-center gap-1 rounded-lg bg-red-100 px-3 py-2 text-xs"><XCircle size={13}/>Cancel run</button>}</div></> : <p className="text-sm text-[#69756e]">Select a job to inspect its attempts and sanitized errors.</p>}</aside>
    </div>
  </div></main>;
}
