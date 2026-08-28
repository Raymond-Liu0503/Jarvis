"use client";
import { useState } from "react";
import { ArrowRight, BookOpen, MoreHorizontal, RefreshCw, Sparkles } from "lucide-react";
import type { SpecialistProgressState } from "@/lib/contracts";
import type { DashboardData, HubItem } from "@/lib/data/demo";
import { ChatMarkdown } from "@/components/chat-markdown";
import { MAX_CONSECUTIVE_POLL_FAILURES, POLL_INTERVAL_MS, RESEARCH_RUN_TIMEOUT_MS } from "@/lib/research/limits";
function ItemCard({ item }: { item: HubItem }) { return <article className={`card p-5 min-h-52 flex flex-col ${item.stale ? "border-amber-400/70" : ""}`}><div className="flex justify-between gap-3"><span className="text-[10px] tracking-[.14em] text-[#738078]">{item.eyebrow}</span><button aria-label={`More actions for ${item.title}`}><MoreHorizontal size={17}/></button></div><h3 className="serif text-2xl mt-4">{item.title}</h3><div className="mt-2 flex items-baseline gap-2"><strong className="text-xl">{item.value}</strong>{item.change && <span className={item.change.startsWith("−") ? "text-red-700 text-sm" : "text-emerald-700 text-sm"}>{item.change}</span>}</div><p className="text-xs text-[#778179] mt-1">{item.detail}</p>{item.tag && <p className="text-sm mt-4 text-[#4f5b54]">{item.tag}</p>}<div className="mt-auto pt-5 border-t border-[#e0e2da]"><button className="text-xs bg-[#e8f4d5] px-3 py-2 rounded-lg flex gap-1.5 items-center"><BookOpen size={13}/>Research</button></div></article>; }
type Run = {
  id: string;
  status: string;
  specialists: Array<{ id: string; label: string; state: SpecialistProgressState; detail?: string; error?: string }>;
  pendingInput?: { interruptId: string; questions: string[] } | null;
  activity?: Array<{ id: string; type: string; message: string; createdAt: string }>;
  deadlineAt?: string | null;
  report?: { executiveAnswer?: string; sources?: Array<{ id: string; title: string; canonicalUrl: string }> };
  error?: string;
};
export function HubDashboard({ data }: { data: DashboardData }) {
  const [depth, setDepth] = useState<"quick" | "deep">("quick"); const [threadId, setThreadId] = useState<string>(); const [query, setQuery] = useState(""); const [answer, setAnswer] = useState(""); const [error, setError] = useState(""); const [sending, setSending] = useState(false); const [status, setStatus] = useState(""); const [citations, setCitations] = useState<Array<{ id: string; title: string; url: string }>>([]); const [researchRun, setResearchRun] = useState<Run | null>(null);
  async function monitorRun(runId: string) {
    let deadline = Date.now() + RESEARCH_RUN_TIMEOUT_MS + 15_000;
    let failures = 0;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
      try {
        const response = await fetch(`/api/research/${runId}`, { cache: "no-store", signal: AbortSignal.timeout(10_000) });
        if (!response.ok) {
          failures += 1;
          if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) { setError("Lost contact with the research service. Polling stopped; check the worker and app server before retrying."); return; }
          continue;
        }
        failures = 0;
        const run: Run = await response.json();
        if (run.deadlineAt) deadline = Math.min(deadline, Date.parse(run.deadlineAt) + 15_000);
        setResearchRun(run);
        if (run.status === "needs_input") {
          setAnswer(`I need a little more detail: ${run.pendingInput?.questions.join(" ") ?? "Please clarify your request."}`);
          return;
        }
        if (["completed", "partial"].includes(run.status)) {
          setAnswer(run.report?.executiveAnswer ?? `Deep Research ${run.status}.`);
          setCitations((run.report?.sources ?? []).map(source => ({ id: source.id, title: source.title, url: source.canonicalUrl })));
          return;
        }
        if (["failed", "cancelled"].includes(run.status)) { setError(run.error ?? `Deep Research ${run.status}.`); return; }
      } catch {
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_POLL_FAILURES) { setError("Lost contact with the research service. Polling stopped; check the worker and app server before retrying."); return; }
      }
    }
    setError("Deep Research timed out after 5 minutes. Check provider availability and the activity feed before retrying.");
  }

  async function sendPrompt() {
    const message = query.trim();
    if (!message || sending) return;
    setSending(true); setQuery(""); setAnswer(""); setError(""); setCitations([]); setStatus("Jarvis is thinking…");
    try {
      if (depth === "deep") {
        const awaitingInput = researchRun?.status === "needs_input";
        const url = awaitingInput ? `/api/research/${researchRun.id}/resume` : "/api/research";
        const body = awaitingInput ? { message } : { threadId, query: message };
        const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
        const payload = await response.json();
        if (payload.threadId) setThreadId(payload.threadId);
        if (!response.ok) throw new Error(payload.error ?? "Research request failed");
        const runId = awaitingInput ? researchRun.id : payload.runId;
        setResearchRun(previous => previous && previous.id === runId ? { ...previous, status: "queued", pendingInput: null } : previous);
        setAnswer(awaitingInput ? "Thanks—resuming the research." : `Deep Research queued. Run ID: ${runId}`);
        void monitorRun(runId);
      } else {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ threadId, message }) });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? "Chat request failed"); }
        const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) {
          const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const raw of lines) {
            if (!raw.trim()) continue; const event = JSON.parse(raw);
            if (event.type === "thread") setThreadId(event.threadId);
            else if (event.type === "clarification") { setThreadId(event.threadId); setAnswer(event.text); }
            else if (event.type === "status") setStatus(event.message);
            else if (event.type === "text") setAnswer(previous => previous + event.text);
            else if (event.type === "citations") setCitations(event.sources ?? []);
            else if (event.type === "error") throw new Error(event.message);
          }
          if (done) break;
        }
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Something went wrong"); }
    finally { setSending(false); setStatus(""); }
  }
  return <div className="noise px-5 md:px-9 py-9 md:py-12"><div className="max-w-7xl mx-auto"><div className="flex flex-wrap justify-between items-end gap-5 mb-8"><div><div className="text-[10px] tracking-[.2em] text-[#718078] mb-3">PRIVATE WORKSPACE</div><h1 className="serif text-4xl md:text-6xl tracking-tight">{data.heading}</h1><p className="mt-3 max-w-xl text-[#637068]">{data.intro}</p></div><button className="rounded-xl border border-[#cfd3c9] bg-[#fbfaf6] px-4 py-2.5 text-sm flex gap-2 items-center"><RefreshCw size={15}/>Refresh dashboard</button></div>
  <section className="relative mb-10 overflow-hidden rounded-[18px] bg-[#17211b] p-5 text-white md:p-7"><div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_center,rgba(183,243,75,.2),transparent_65%)]"/><div className="relative"><div className="flex flex-wrap justify-between gap-4"><div><div className="flex gap-2 items-center text-[#b7f34b] text-xs tracking-[.12em]"><Sparkles size={14}/>ASK JARVIS</div><h2 className="serif text-2xl mt-2">What do you want to understand?</h2></div><div aria-label="Research depth" className="flex shrink-0 rounded-lg bg-white/10 p-1 text-xs"><button type="button" aria-pressed={depth === "quick"} onClick={() => setDepth("quick")} className={`min-w-16 rounded-md px-3 py-2 font-medium ${depth === "quick" ? "bg-white text-[#17211b]" : "text-white/85 hover:bg-white/10"}`}>Quick</button><button type="button" aria-pressed={depth === "deep"} onClick={() => setDepth("deep")} className={`min-w-28 whitespace-nowrap rounded-md px-3 py-2 font-medium ${depth === "deep" ? "bg-[#b7f34b] text-[#17211b]" : "text-white/85 hover:bg-white/10"}`}>Deep Research</button></div></div><div className="mt-5 flex gap-2 bg-white rounded-xl p-2"><textarea value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendPrompt(); } }} rows={1} className="flex-1 resize-none px-3 py-2 text-[#17211b] outline-none" placeholder="Ask about a company, trip, product, or anything else…"/><button aria-label="Send" onClick={() => void sendPrompt()} disabled={sending || !query.trim()} className="rounded-lg bg-[#b7f34b] text-[#17211b] px-4 disabled:opacity-50"><ArrowRight size={18}/></button></div>
  {(sending || answer || error) && <div aria-live="polite" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-amber-300 bg-amber-50 text-amber-950" : "border-[#d8ddd0] bg-[#fbfaf6] text-[#17211b]"}`}>{sending && !answer ? status : error || <div><ChatMarkdown content={answer}/>{citations.length > 0 && <div className="mt-4 border-t pt-3 flex flex-wrap gap-2">{citations.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="rounded-md bg-[#e8f4d5] px-2 py-1 text-xs underline">{source.title}</a>)}</div>}</div>}</div>}
  {depth === "deep" && researchRun && <div className="mt-4 grid gap-3 lg:grid-cols-[1.1fr_1.9fr]">
    <div className="rounded-xl border border-white/15 bg-black/10 p-4">
      <div className="flex items-center justify-between"><div className="text-xs font-medium tracking-wide">Live research activity</div><div className="text-[10px] uppercase tracking-widest text-[#b7f34b]">{researchRun.status.replaceAll("_", " ")}</div></div>
      <div aria-live="polite" className="mt-3 space-y-2">
        {(researchRun.activity?.length ? researchRun.activity.slice(-8) : [{ id: "queued", type: "queued", message: "Waiting for a worker to begin research", createdAt: "" }]).map((item, index, items) => <div key={item.id} className="flex gap-2 text-xs text-white/75"><span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${index === items.length - 1 && !["completed", "partial", "failed", "cancelled", "needs_input"].includes(researchRun.status) ? "animate-pulse bg-[#b7f34b]" : "bg-white/35"}`}/><span>{item.message}</span></div>)}
      </div>
      <p className="mt-3 text-[10px] leading-relaxed text-white/40">Activity summaries describe actions and evidence handling; private model reasoning is not displayed.</p>
    </div>
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{researchRun.specialists.map(item => <div key={item.id} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75"><div className="text-white">{item.label}</div><div className="mt-1">{item.detail}</div><div className="mt-1 uppercase tracking-wider text-[10px]">{item.state}</div>{item.error && <div className="mt-1 text-amber-200">{item.error}</div>}</div>)}</div>
  </div>}</div></section>
  <div className="flex justify-between items-center mb-4"><h2 className="serif text-2xl">Tracked across your workspace</h2><button className="text-sm">Add new +</button></div><div className="hub-grid grid grid-cols-3 gap-4">{data.items.map(item => <ItemCard key={item.id} item={item}/>)}</div><section className="mt-12 mb-16"><h2 className="serif text-2xl mb-4">Recent reports</h2><div className="card divide-y divide-[#dcded5]">{data.reports.map(report => <div key={report} className="p-4 flex justify-between items-center"><div className="text-sm">{report}</div><ArrowRight size={16}/></div>)}</div></section></div></div>;
}
