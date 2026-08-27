"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, Compass, PackageSearch, Plus, Search, Sparkles } from "lucide-react";
import type { ResearchMode } from "@/lib/contracts";

const hubs = [
  { mode: "stocks", label: "Stocks", icon: BarChart3 }, { mode: "travel", label: "Travel", icon: Compass },
  { mode: "shopping", label: "Shopping", icon: PackageSearch },
] as const;

export function AppShell({ mode, children }: { mode: ResearchMode; children: React.ReactNode }) {
  const pathname = usePathname();
  return <div className="min-h-screen grid grid-cols-[244px_1fr] max-[820px]:grid-cols-1">
    <aside className="desktop-sidebar border-r border-[#dcded5] bg-[#e9e8df] p-5 flex flex-col sticky top-0 h-screen">
      <div className="flex items-center gap-3 px-2 mb-9"><div className="h-9 w-9 rounded-full bg-[#17211b] text-[#b7f34b] grid place-items-center"><Sparkles size={18}/></div><div><div className="serif text-xl">Jarvis</div><div className="text-[10px] tracking-[.2em] text-[#69756e]">RESEARCH DESK</div></div></div>
      <button className="rounded-xl bg-[#17211b] text-white px-4 py-3 flex items-center justify-between text-sm">Ask Jarvis <Plus size={16}/></button>
      <nav className="mt-7 space-y-1">{hubs.map(({ mode: itemMode, label, icon: Icon }) => <Link key={itemMode} href={`/hubs/${itemMode}`} className={`flex gap-3 items-center px-3 py-2.5 rounded-xl text-sm ${pathname.includes(itemMode) ? "bg-white shadow-sm" : "text-[#5c6861]"}`}><Icon size={17}/>{label}</Link>)}</nav>
      <div className="mt-8 text-[10px] tracking-[.18em] text-[#7a847e] px-3">RECENT RESEARCH</div>
      <div className="mt-3 space-y-3 px-3 text-sm text-[#515d56]"><p>Apple services outlook</p><p>Lisbon autumn itinerary</p><p>Travel headphones</p></div>
      <div className="mt-auto border-t border-[#d1d3ca] pt-4 flex items-center gap-3"><div className="h-8 w-8 bg-[#d5d9ce] rounded-full grid place-items-center text-xs">AR</div><div className="text-xs"><div>Alex Researcher</div><div className="text-[#78817c]">Private workspace</div></div></div>
    </aside>
    <main className="min-w-0"><header className="h-16 border-b border-[#dcded5] flex items-center justify-between px-5 md:px-9 bg-[#f4f2eb]/90 sticky top-0 z-10 backdrop-blur">
      <nav className="flex gap-1">{hubs.map(({ mode: itemMode, label }) => <Link key={itemMode} href={`/hubs/${itemMode}`} className={`px-3 py-2 rounded-lg text-sm ${mode === itemMode ? "bg-[#17211b] text-white" : "text-[#657068]"}`}>{label}</Link>)}</nav>
      <button aria-label="Search" className="h-9 w-9 rounded-full border border-[#d5d8cf] grid place-items-center"><Search size={16}/></button>
    </header>{children}</main>
  </div>;
}
