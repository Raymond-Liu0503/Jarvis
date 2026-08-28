import { inngest } from "@/lib/inngest";
import type { RunStatus, SpecialistResult } from "@/lib/contracts";
import { EvidenceStore } from "@/lib/research/evidence";
import { runSpecialist, synthesizeReport } from "@/lib/research/agents";
import { getSkill } from "@/lib/skills/loader";
import { conversationStore, runStore, traceStore } from "@/lib/research/store";

export const deepResearch = inngest.createFunction(
  { id: "deep-research", retries: 0, timeouts: { start: "2m", finish: "5m" }, cancelOn: [{ event: "research/cancelled", match: "data.runId" }] },
  { event: "research/requested" },
  async ({ event, step }) => {
    const runId = event.data.runId as string; const snapshot = event.data.run as Parameters<typeof runStore.restore>[0] | undefined; const run = runStore.get(runId) ?? (snapshot ? runStore.restore(snapshot) : undefined); if (!run) return { runId, status: "failed", error: "Research run metadata was not included in the event" }; conversationStore.restore(run.threadId, run.query); if (["completed", "partial", "failed", "cancelled"].includes(run.status)) return { runId, status: run.status as RunStatus };
    try {
      for (const [id, version] of Object.entries(run.plan.skillVersions)) if (getSkill(id).version !== version) throw new Error(`Skill version changed before execution: ${id}`);
      runStore.setStatus(runId, "running"); traceStore.add(run.threadId, "run.started", { skillIds: run.skillIds, plan: run.plan, deadlineAt: run.deadlineAt }, runId);
      const settled = await Promise.allSettled(run.plan.specialists.map(planned => step.run(`specialist-${planned.id.replace("/", "-")}`, async () => {
        const definition = getSkill(planned.skillId).specialists.find(item => item.id === planned.id); if (!definition) throw new Error(`Specialist not found: ${planned.id}`);
        const specialistEvidence = new EvidenceStore(5);
        try { const result = await runSpecialist({ definition, query: run.query, evidence: specialistEvidence, onProgress: (state, detail) => { runStore.progress(runId, planned.id, state, detail); traceStore.add(run.threadId, `specialist.${state}`, { specialistId: planned.id, detail }, runId); } }); runStore.progress(runId, planned.id, "completed", `${result.findings.length} verified findings`); return { result, sources: specialistEvidence.all() }; }
        catch (error) { const message = error instanceof Error ? error.message : "Specialist failed"; runStore.progress(runId, planned.id, "failed", undefined, message); traceStore.add(run.threadId, "specialist.failed", { specialistId: planned.id, error: message }, runId); throw error; }
      })));
      const successful = settled.flatMap(result => result.status === "fulfilled" ? [result.value] : []); const evidence = new EvidenceStore(20); const sourceAliases = new Map<string, string>();
      for (const source of successful.flatMap(item => item.sources)) { const retained = evidence.add([source])[0] ?? evidence.all().find(item => item.canonicalUrl === source.canonicalUrl); if (retained) sourceAliases.set(source.id, retained.id); }
      const completed: SpecialistResult[] = successful.map(item => ({ ...item.result, findings: item.result.findings.map(finding => ({ ...finding, sourceIds: finding.sourceIds.map(id => sourceAliases.get(id) ?? id) })) }));
      const missingSkillIds = run.skillIds.filter(skillId => !completed.some(result => result.specialist.startsWith(`${skillId}/`)));
      if (completed.length < 2) {
        const failures = settled.flatMap((result, index) => result.status === "rejected" ? [`${run.plan.specialists[index].label}: ${result.reason instanceof Error ? result.reason.message : "failed"}`] : []);
        throw new Error(`Only ${completed.length} specialists produced verified evidence; at least 2 are required. ${failures.join("; ")}`.trim());
      }
      const report = await step.run("synthesize-report", () => synthesizeReport({ runId, skillIds: run.skillIds, query: run.query, specialistResults: completed, sources: evidence.all(), skillPrompts: run.skillIds.map(id => `${getSkill(id).instructions}\n${getSkill(id).synthesisPrompt}`) }));
      if (missingSkillIds.length) {
        report.degraded = true;
        report.risks = [`Partial coverage: no specialist completed for ${missingSkillIds.join(", ")}.`, ...report.risks];
      }
      const degraded = report.degraded || completed.some(result => result.limitations.some(item => item.startsWith("Degraded"))); const status = completed.length === run.plan.specialists.length && !degraded ? "completed" : "partial"; runStore.setStatus(runId, status, { report }); conversationStore.add(run.threadId, "assistant", report.executiveAnswer); traceStore.add(run.threadId, "run.completed", { status, degraded, sourceCount: report.sources.length }, runId); return { runId, status, reportId: report.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Deep Research failed"; runStore.setStatus(runId, "failed", { error: message }); traceStore.add(run.threadId, "run.failed", { error: message }, runId); return { runId, status: "failed", error: message };
    }
  },
);
export const refreshDashboard = inngest.createFunction({ id: "refresh-dashboard", retries: 1, timeouts: { finish: "1m" } }, { event: "dashboard/refresh.requested" }, async ({ step }) => step.run("refresh-dashboard", async () => ({ refreshedAt: new Date().toISOString() })));
export const functions = [deepResearch, refreshDashboard];
