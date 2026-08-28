import type { Source } from "@/lib/contracts";
import { canonicalizeUrl } from "@/lib/research/sources";

export class EvidenceStore {
  private readonly sources = new Map<string, Source>();
  private reserved = 0;
  constructor(readonly maximum: number) {}

  reserve(requested: number) {
    const available = Math.max(0, this.maximum - this.reserved);
    const granted = Math.min(Math.max(requested, 0), available);
    this.reserved += granted;
    return granted;
  }
  release(count: number) { this.reserved = Math.max(this.sources.size, this.reserved - Math.max(count, 0)); }
  add(input: Source[]) {
    const accepted: Source[] = [];
    for (const source of input) {
      let key: string;
      try { key = canonicalizeUrl(source.canonicalUrl); } catch { continue; }
      if (this.sources.has(key)) continue;
      if (this.sources.size >= this.maximum) break;
      const normalized = { ...source, canonicalUrl: key };
      this.sources.set(key, normalized); accepted.push(normalized);
    }
    return accepted;
  }
  all() { return [...this.sources.values()]; }
  ids() { return new Set(this.all().map(source => source.id)); }
}

export class ToolCallBudget {
  private used = 0;
  constructor(readonly maximum: number) {}
  take() { if (this.used >= this.maximum) throw new Error(`Tool-call budget of ${this.maximum} exhausted`); this.used += 1; }
  count() { return this.used; }
}
