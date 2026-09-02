import { z } from "zod";

const positiveInt = (fallback: number) => z.coerce.number().int().positive().default(fallback);

export const runtimeConfigSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  ALLOW_SIGN_UP: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  WORKER_ID: z.preprocess(value => value === "" ? undefined : value, z.string().min(1).optional()),
  DATABASE_POOL_MAX: positiveInt(10),
  WORKER_POLL_INTERVAL_MS: positiveInt(750),
  WORKER_LEASE_MS: positiveInt(45_000),
  WORKER_HEARTBEAT_MS: positiveInt(10_000),
  WORKER_CONCURRENCY: positiveInt(1),
  WORKER_MAX_ATTEMPTS: positiveInt(3),
  WEB_RESEARCH_CONCURRENCY: positiveInt(2),
  WEB_RESEARCH_CACHE_TTL_HOURS: positiveInt(6),
  RESEARCH_DEBUG_PAYLOADS: z.enum(["off", "redacted"]).default("off"),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;

export function getRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const config = runtimeConfigSchema.parse(env);
  if (config.WORKER_HEARTBEAT_MS >= config.WORKER_LEASE_MS) {
    throw new Error("WORKER_HEARTBEAT_MS must be shorter than WORKER_LEASE_MS");
  }
  if (config.DATABASE_POOL_MAX < config.WORKER_CONCURRENCY + 1) {
    throw new Error("DATABASE_POOL_MAX must be at least WORKER_CONCURRENCY + 1");
  }
  return config;
}
