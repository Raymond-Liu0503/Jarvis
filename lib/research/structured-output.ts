import { z } from "zod";

/**
 * Recovers a schema-valid object when a model wraps otherwise valid JSON in a
 * small amount of malformed framing. Object contents are never rewritten.
 */
export function recoverObjectFromText<T>(text: string, schema: z.ZodType<T>): T | undefined {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const starts: number[] = [];
  for (let index = trimmed.indexOf("{"); index >= 0 && starts.length < 64; index = trimmed.indexOf("{", index + 1)) starts.push(index);
  const ends: number[] = [];
  for (let index = trimmed.indexOf("}"); index >= 0 && ends.length < 64; index = trimmed.indexOf("}", index + 1)) ends.push(index);

  for (const start of starts) {
    for (const end of ends.toReversed()) {
      if (end < start) continue;
      try {
        let value: unknown = JSON.parse(trimmed.slice(start, end + 1));
        // Some models JSON-encode the entire object one additional time.
        if (typeof value === "string") value = JSON.parse(value);
        const parsed = schema.safeParse(value);
        if (parsed.success) return parsed.data;
      } catch {
        // Try the next object boundary. Schema validation remains mandatory.
      }
    }
  }
  return undefined;
}

export function requireObjectFromText<T>(text: string, schema: z.ZodType<T>): T {
  const recovered = recoverObjectFromText(text, schema);
  if (recovered === undefined) throw new Error("The model response did not contain a schema-valid JSON object");
  return recovered;
}
