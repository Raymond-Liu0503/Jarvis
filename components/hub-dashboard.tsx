"use client";

import { useState } from "react";
import { ArrowRight, BookOpen, MoreHorizontal, RefreshCw, Sparkles } from "lucide-react";
import type { ResearchMode } from "@/lib/contracts";
import type { HubData, HubItem } from "@/lib/data/demo";
import { MODE_DEFINITIONS } from "@/lib/research/modes";

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
  const definition = MODE_DEFINITIONS[mode]; const [depth, setDepth] = useState<"quick" | "deep">("quick"); const [query, setQuery] = useState("");
  return <div className="noise px-5 md:px-9 py-9 md:py-12"><div className="max-w-7xl mx-auto">
    <div className="flex flex-wrap justify-between items-end gap-5 mb-8"><div><div className="text-[10px] tracking-[.2em] text-[#718078] mb-3">{definition.label.toUpperCase()} WORKSPACE</div><h1 className="serif text-4xl md:text-6xl tracking-tight">{data.heading}</h1><p className="mt-3 max-w-xl text-[#637068]">{data.intro}</p></div><button className="rounded-xl border border-[#cfd3c9] bg-[#fbfaf6] px-4 py-2.5 text-sm flex gap-2 items-center"><RefreshCw size={15}/> Refresh hub</button></div>
    <section className="card p-5 md:p-7 mb-10 bg-[#17211b] text-white border-0 overflow-hidden relative"><div className="absolute right-0 top-0 h-full w-1/3 bg-[radial-gradient(circle_at_center,rgba(183,243,75,.2),transparent_65%)]"/><div className="relative">
      <div className="flex flex-wrap justify-between gap-4"><div><div className="flex gap-2 items-center text-[#b7f34b] text-xs tracking-[.12em]"><Sparkles size={14}/> ASK {definition.label.toUpperCase()}</div><h2 className="serif text-2xl mt-2">What do you want to understand?</h2></div><div className="bg-white/10 p-1 rounded-lg flex text-xs"><button onClick={() => setDepth("quick")} className={`px-3 py-2 rounded-md ${depth === "quick" ? "bg-white text-[#17211b]" : ""}`}>Quick</button><button onClick={() => setDepth("deep")} className={`px-3 py-2 rounded-md ${depth === "deep" ? "bg-[#b7f34b] text-[#17211b]" : ""}`}>Deep Research</button></div></div>
      <div className="mt-5 flex gap-2 bg-white rounded-xl p-2"><textarea value={query} onChange={e => setQuery(e.target.value)} rows={1} className="flex-1 resize-none px-3 py-2 text-[#17211b] outline-none" placeholder={mode === "stocks" ? "Research a ticker, company, or market question…" : mode === "travel" ? "Plan a destination, dates, or travel question…" : "Paste a public product URL or describe what you need…"}/><button aria-label="Send" className="rounded-lg bg-[#b7f34b] text-[#17211b] px-4"><ArrowRight size={18}/></button></div>
      {depth === "deep" && <div className="mt-4 grid md:grid-cols-3 gap-2">{definition.specialists.map(s => <div key={s.id} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-white/75"><span className="text-white">{s.label}</span><br/>{s.focus}</div>)}</div>}
    </div></section>
    <div className="flex justify-between items-center mb-4"><h2 className="serif text-2xl">Tracked</h2><button className="text-sm flex items-center gap-1">Add new <span className="text-lg">+</span></button></div><div className="hub-grid grid grid-cols-3 gap-4">{data.items.map(item => <ItemCard key={item.id} item={item}/>)}</div>
    <section className="mt-12"><h2 className="serif text-2xl mb-4">{data.secondaryTitle}</h2><div className="hub-grid grid grid-cols-3 gap-4">{data.secondary.map(item => <ItemCard key={item.id} item={item}/>)}</div></section>
    <section className="mt-12 mb-16"><h2 className="serif text-2xl mb-4">Recent reports</h2><div className="card divide-y divide-[#dcded5]">{data.reports.map((report, i) => <div key={report} className="p-4 flex justify-between items-center"><div><div className="text-sm">{report}</div><div className="text-xs text-[#79837d] mt-1">{definition.label} · {i + 2} sources · updated recently</div></div><ArrowRight size={16}/></div>)}</div></section>
    <p className="text-xs text-[#7a847e] pb-6">{definition.disclaimer}</p>
  </div></div>;
}
