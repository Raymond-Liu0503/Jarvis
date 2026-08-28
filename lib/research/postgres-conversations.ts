import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationMessage = { role: "user" | "assistant"; content: string };

export async function ensurePersistentThread(supabase: SupabaseClient, userId: string, requestedId: string | undefined, firstMessage: string) {
  if (requestedId) {
    const { data, error } = await supabase.from("threads").select("id").eq("id", requestedId).eq("user_id", userId).maybeSingle();
    if (error) throw new Error(`Could not load conversation: ${error.message}`);
    if (data?.id) return { id: String(data.id), created: false };
  }
  const { data, error } = await supabase.from("threads").insert({ user_id: userId, title: firstMessage.trim().slice(0, 80), skill_ids: [] }).select("id").single();
  if (error || !data) throw new Error(`Could not create conversation: ${error?.message ?? "unknown database error"}`);
  return { id: String(data.id), created: true };
}

export async function conversationContext(supabase: SupabaseClient, userId: string, threadId: string) {
  const { data, error } = await supabase.from("messages").select("role,content,created_at").eq("thread_id", threadId).eq("user_id", userId).order("created_at", { ascending: false }).limit(24);
  if (error) throw new Error(`Could not load conversation history: ${error.message}`);
  let size = 0;
  return (data ?? []).filter(message => {
    size += String(message.content).length;
    return size <= 12_000;
  }).reverse().map(message => ({ role: message.role as ConversationMessage["role"], content: String(message.content) }));
}

export async function addConversationMessage(supabase: SupabaseClient, userId: string, threadId: string, role: ConversationMessage["role"], content: string) {
  const { error } = await supabase.from("messages").insert({ user_id: userId, thread_id: threadId, role, content });
  if (error) throw new Error(`Could not save conversation message: ${error.message}`);
}

export async function saveQuickRouting(supabase: SupabaseClient, userId: string, threadId: string, route: { selections: Array<{ skillId: string; confidence: number; rationale: string }>; fallback?: boolean }) {
  const skillIds = route.selections.map(item => item.skillId);
  const { error: threadError } = await supabase.from("threads").update({ skill_ids: skillIds }).eq("id", threadId).eq("user_id", userId);
  if (threadError) throw new Error(`Could not update conversation routing: ${threadError.message}`);
  const { error } = await supabase.from("routing_decisions").insert({ user_id: userId, thread_id: threadId, selected_skill_ids: skillIds, candidates: route.selections, rationale: { source: route.fallback ? "heuristic" : "model" }, used_fallback: route.fallback ?? false });
  if (error) throw new Error(`Could not save routing decision: ${error.message}`);
}

export async function saveQuickEvent(supabase: SupabaseClient, userId: string, threadId: string, eventType: string, detail: Record<string, unknown>) {
  const { error } = await supabase.from("execution_events").insert({ user_id: userId, thread_id: threadId, run_id: null, event_key: `${eventType}:${crypto.randomUUID()}`, event_type: eventType, detail });
  if (error) console.error("Could not save Quick Chat event", { threadId, eventType, error: error.message });
}
