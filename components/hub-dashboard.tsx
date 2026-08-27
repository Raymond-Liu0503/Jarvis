"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, MoreHorizontal, RefreshCw, Sparkles } from "lucide-react";
import type { ResearchMode, SpecialistProgressState } from "@/lib/contracts";
import type { HubData, HubItem } from "@/lib/data/demo";
import { MODE_DEFINITIONS } from "@/lib/research/modes";
import { ChatMarkdown } from "@/components/chat-markdown";

function ItemCard({ item }: { item: HubItem }) {
  const [refreshing, setRefreshing] = useState(false);
  return <article className={`card p-5 min-h-52 flex flex-col ${item.stale ? "border-amber-400/70" : ""}`}>
    <div className="flex justify-between gap-3"><span className="text-[10px] tracking-[.14em] text-[#738078]">{item.eyebrow}</span><button aria-label={`More actions for ${item.title}`}><MoreHorizontal size={17}/></button></div>
    <h3 className="serif text-2xl mt-4">{item.title}</h3><div className="mt-2 flex items-baseline gap-2"><strong className="text-xl">{item.value}</strong>{item.change && <span className={item.change.startsWith("−") ? "text-red-700 text-sm" : "text-emerald-700 text-sm"}>{item.change}</span>}</div>
    <p className="text-xs text-[#778179] mt-1">{item.detail}</p>{item.tag && <p className="text-sm mt-4 text-[#4f5b54]">{item.tag}</p>}
    <div className="mt-auto pt-5 border-t border-[#e0e2da] flex gap-2"><button className="text-xs bg-[#e8f4d5] px-3 py-2 rounded-lg flex gap-1.5 items-center"><BookOpen size={13}/> Research</button><button onClick={() => { setRefreshing(true); setTimeout(() => setRefreshing(false), 800); }} className="text-xs px-2 py-2 flex gap-1.5 items-center text-[#647068]"><RefreshCw size={13} className={refreshing ? "animate-spin" : ""}/> {refreshing ? "Refreshing" : "Refresh"}</button></div>
  </article>;
}


export function HubDashboard({ mode, data }: { mode: ResearchMode; data: HubData }) {
  const definition = MODE_DEFINITIONS[mode]; const [depth, setDepth] = useState<"quick" | "deep">("quick"); const [query, setQuery] = useState(""); const [answer, setAnswer] = useState(""); const [error, setError] = useState(""); const [sending, setSending] = useState(false); const [status, setStatus] = useState(""); const [citations, setCitations] = useState<Array<{ id: string; title: string; url: string; publisher: string }>>([]); const [researchRun, setResearchRun] = useState<{ id: string; status: string; specialists: Array<{ id: string; state: SpecialistProgressState; detail?: string; error?: string }> } | null>(null);
  async function monitorRun(runId: string) {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`/api/research/${runId}`, { cache: "no-store" }); if (!response.ok) continue;
      const run = await response.json(); setResearchRun(run);
      if (["completed", "partial"].includes(run.status)) { setAnswer(run.report?.executiveAnswer ?? `Deep Research ${run.status}.`); setCitations((run.report?.sources ?? []).map((source: { id: string; title: string; canonicalUrl: string; publisher: string }) => ({ id: source.id, title: source.title, url: source.canonicalUrl, publisher: source.publisher }))); return; }
      if (["failed", "cancelled"].includes(run.status)) { setError(run.error ?? `Deep Research ${run.status}.`); return; }
    }
    setError("Deep Research is still running. Reopen the run later to see its result.");
  }
  async function cancelResearch() {
    if (!researchRun) return;
    const response = await fetch(`/api/research/${researchRun.id}/cancel`, { method: "POST" });
    if (!response.ok) { setError("Could not cancel the research run."); return; }
    const run = await response.json(); setResearchRun(previous => previous ? { ...previous, status: run.status } : previous); setAnswer("Deep Research cancelled.");
  }
  async function sendPrompt() {
    const message = query.trim(); if (!message || sending) return;
    setSending(true); setQuery(""); setAnswer(""); setError(""); setCitations([]); setStatus("Jarvis is thinking…");
    try {
      if (depth === "deep") {
        const response = await fetch("/api/research", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, depth, query: message }) });
        const payload = await response.json(); if (!response.ok && response.status !== 422) throw new Error(payload.error ?? "Research request failed");
        setAnswer(payload.status === "needs_input" ? `I need a little more detail: ${payload.questions?.join(" ") ?? "Please clarify your request."}` : `Deep Research queued. Run ID: ${payload.runId}`);
        if (payload.runId) { setResearchRun({ id: payload.runId, status: payload.status, specialists: definition.specialists.map(item => ({ id: item.id, state: "queued" as const })) }); void monitorRun(payload.runId); }
      } else {
        const response = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, message }) });
        if (!response.ok) { const payload = await response.json().catch(() => ({})); throw new Error(payload.error ?? "Chat request failed"); }
        if (!response.body) throw new Error("Chat response did not include a stream");
        const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
        while (true) {
          const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
          for (const item of lines) {
            if (!item.trim()) continue; const event = JSON.parse(item);
            if (event.type === "status") setStatus(event.message);
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
  return <div className="noise px-5 md:px-9 py-9 md:py-12"><div className="max-w-7xl mx-auto">
    <div className="flex flex-wrap justify-between items-end gap-5 mb-8"><div><div className="text-[10px] tracking-[.2em] text-[#718078] mb-3">{definition.label.toUpperCase()} WORKSPACE</div><h1 className="serif text-4xl md:text-6xl tracking-tight">{data.heading}</h1><p className="mt-3 max-w-xl text-[#637068]">{data.intro}</p></div><button className="rounded-xl border border-[#cfd3c9] bg-[#fbfaf6] px-4 py-2.5 text-sm flex gap-2 items-center"><RefreshCw size={15}/> Refresh hub</button></div>
    <section className="card p-5 md:p-7 mb-10 bg-[#17211b] text-white border-0 overflow-hidden relative"><div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_center,rgba(183,243,75,.2),transparent_65%)]"/><div className="relative">
      <div className="flex flex-wrap justify-between gap-4"><div><div className="flex gap-2 items-center text-[#b7f34b] text-xs tracking-[.12em]"><Sparkles size={14}/> ASK {definition.label.toUpperCase()}</div><h2 className="serif text-2xl mt-2">What do you want to understand?</h2></div><div className="bg-white/10 p-1 rounded-lg flex text-xs"><button onClick={() => setDepth("quick")} className={`px-3 py-2 rounded-md ${depth === "quick" ? "bg-white text-[#17211b]" : ""}`}>Quick</button><button onClick={() => setDepth("deep")} className={`px-3 py-2 rounded-md ${depth === "deep" ? "bg-[#b7f34b] text-[#17211b]" : ""}`}>Deep Research</button></div></div>
      <div className="mt-5 flex gap-2 bg-white rounded-xl p-2"><textarea value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendPrompt(); } }} rows={1} className="flex-1 resize-none px-3 py-2 text-[#17211b] outline-none" placeholder={mode === "stocks" ? "Research a ticker, company, or market question…" : mode === "travel" ? "Plan a destination, dates, or travel question…" : "Paste a public product URL or describe what you need…"}/><button aria-label="Send" onClick={() => void sendPrompt()} disabled={sending || !query.trim()} className="rounded-lg bg-[#b7f34b] text-[#17211b] px-4 disabled:opacity-50"><ArrowRight size={18}/></button></div>
      {(sending || answer || error) && <div aria-live="polite" className={`mt-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-amber-300 bg-amber-50 text-amber-950" : "border-[#d8ddd0] bg-[#fbfaf6] text-[#17211b]"}`}>
        {sending && !answer ? <span className="flex items-center gap-2"><span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#b7f34b] border-t-[#17211b]" /> {status || "Jarvis is thinking…"}</span> : error ? error : <div><ChatMarkdown content={answer} />{sending && <div className="mt-3 flex items-center gap-2 text-xs text-[#657068]"><span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[#b7f34b] border-t-[#17211b]" />{status}</div>}{citations.length > 0 && <div className="mt-4 border-t border-[#d8ddd0] pt-3"><div className="text-[10px] tracking-[.14em] text-[#758078] mb-2">SOURCES</div><div className="flex flex-wrap gap-2">{citations.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" className="rounded-md bg-[#e8f4d5] px-2 py-1 text-xs underline decoration-[#829b58]">{source.title}</a>)}</div></div>}</div>}
      </div>}
      {depth === "deep" && <div className="mt-4 grid md:grid-cols-3 gap-2">{definition.specialists.map(s => { const progress = researchRun?.specialists.find(item => item.id === s.id); const active = progress && ["planning", "searching", "analyzing"].includes(progress.state); return <div key={s.id} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75"><div className="flex items-center justify-between gap-2"><span className="text-white">{s.label}</span>{progress && <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider">{active && <span className="h-2 w-2 animate-pulse rounded-full bg-[#b7f34b]"/>}{progress.state}</span>}</div><div className="mt-1">{progress?.detail ?? s.focus}</div>{progress?.error && <div className="mt-1 text-amber-200">{progress.error}</div>}</div>; })}</div>}
      {depth === "deep" && researchRun && ["queued", "running"].includes(researchRun.status) && <div className="mt-3 flex justify-end"><button onClick={() => void cancelResearch()} className="rounded-md border border-white/20 px-3 py-1.5 text-xs text-white/75 hover:bg-white/10">Cancel research</button></div>}
    </div></section>
    <div className="flex justify-between items-center mb-4"><h2 className="serif text-2xl">Tracked</h2><button className="text-sm flex items-center gap-1">Add new <span className="text-lg">+</span></button></div><div className="hub-grid grid grid-cols-3 gap-4">{data.items.map(item => <ItemCard key={item.id} item={item}/>)}</div>
    <section className="mt-12"><h2 className="serif text-2xl mb-4">{data.secondaryTitle}</h2><div className="hub-grid grid grid-cols-3 gap-4">{data.secondary.map(item => <ItemCard key={item.id} item={item}/>)}</div></section>
    <section className="mt-12 mb-16"><h2 className="serif text-2xl mb-4">Recent reports</h2><div className="card divide-y divide-[#dcded5]">{data.reports.map((report, i) => <div key={report} className="p-4 flex justify-between items-center"><div><div className="text-sm">{report}</div><div className="text-xs text-[#79837d] mt-1">{definition.label} · {i + 2} sources · updated recently</div></div><ArrowRight size={16}/></div>)}</div></section>
    <p className="text-xs text-[#7a847e] pb-6">{definition.disclaimer}</p>
  </div></div>;
}
