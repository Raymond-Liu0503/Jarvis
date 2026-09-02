import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const pool = databaseUrl ? new Pool({ connectionString: databaseUrl, max: 8 }) : null;
const userId = crypto.randomUUID();
const operatorId = crypto.randomUUID();

async function createRun(label: string) {
  const thread = await pool!.query<{ id: string }>("insert into public.threads(user_id,title) values($1,$2) returning id", [userId, label]);
  const run = await pool!.query<{ id: string }>("insert into public.research_runs(user_id,thread_id,query,idempotency_key) values($1,$2,$3,$4) returning id", [userId, thread.rows[0].id, label, crypto.randomUUID()]);
  return run.rows[0].id;
}
async function enqueue(runId: string, key = crypto.randomUUID()) {
  const result = await pool!.query<Record<string, unknown>>("select job.* from public.enqueue_research_job($1,$2::uuid,'research.start',jsonb_build_object('runId',$2::uuid),$3,3,null) job", [userId, runId, key]);
  await pool!.query("update public.research_jobs set available_at='-infinity' where id=$1", [result.rows[0].id]);
  return result;
}
async function claim(worker: string) { return (await pool!.query<Record<string, unknown>>("select * from public.claim_research_job($1,'30 seconds')", [worker])).rows[0]; }

describeDatabase("PostgreSQL research queue", () => {
  beforeAll(async () => {
    await pool!.query("insert into auth.users(id,email,raw_app_meta_data,created_at,updated_at) values($1,$2,'{}',now(),now()),($3,$4,'{\"role\":\"operator\"}',now(),now())", [userId, `${userId}@test.local`, operatorId, `${operatorId}@test.local`]);
  });
  afterAll(async () => { if (pool) { await pool.query("delete from public.operator_actions where actor_user_id=$1", [operatorId]); await pool.query("delete from auth.users where id in ($1,$2)", [userId, operatorId]); await pool.end(); } });

  it("lets concurrent workers claim distinct jobs", async () => {
    const [runA, runB] = await Promise.all([createRun("concurrent-a"), createRun("concurrent-b")]); await Promise.all([enqueue(runA), enqueue(runB)]);
    const [a, b] = await Promise.all([claim("worker-a"), claim("worker-b")]); expect(a.id).not.toBe(b.id);
    await Promise.all([pool!.query("select public.complete_research_job($1,$2,$3)", [a.id,a.lease_owner,a.lease_token]), pool!.query("select public.complete_research_job($1,$2,$3)", [b.id,b.lease_owner,b.lease_token])]);
  });
  it("recovers expired leases and fences stale owners", async () => {
    const runId = await createRun("lease recovery"); await enqueue(runId); const stale = await claim("stale-worker");
    const client = await pool!.connect();
    try {
      await client.query("begin");
      await client.query("update public.research_jobs set lease_expires_at=now()-interval '1 second' where id=$1", [stale.id]);
      const decoyThread = await client.query<{id:string}>("insert into public.threads(user_id,title) values($1,'lease decoy') returning id", [userId]);
      const decoyRun = await client.query<{id:string}>("insert into public.research_runs(user_id,thread_id,query,idempotency_key) values($1,$2,'lease decoy',$3) returning id", [userId,decoyThread.rows[0].id,crypto.randomUUID()]);
      const decoy = await client.query<{id:string}>("select job.id from public.enqueue_research_job($1,$2::uuid,'research.start',jsonb_build_object('runId',$2::uuid),$3,3,null) job", [userId,decoyRun.rows[0].id,crypto.randomUUID()]);
      await client.query("update public.research_jobs set available_at='-infinity' where id=$1", [decoy.rows[0].id]);
      await client.query("select * from public.claim_research_job('recovery-worker','30 seconds')");
      expect((await client.query("select status from public.research_jobs where id=$1", [stale.id])).rows[0].status).toBe("retry_scheduled");
      expect((await client.query<{ ok:boolean }>("select public.heartbeat_research_job($1,$2,$3,'30 seconds') ok", [stale.id,"stale-worker",stale.lease_token])).rows[0].ok).toBe(false);
      expect((await client.query<{ ok:boolean }>("select public.complete_research_job($1,$2,$3) ok", [stale.id,"stale-worker",stale.lease_token])).rows[0].ok).toBe(false);
      await client.query("rollback");
    } finally { client.release(); }
    await pool!.query("select public.complete_research_job($1,$2,$3)", [stale.id,stale.lease_owner,stale.lease_token]);
  });
  it("keeps runs non-terminal while retrying and fails only on dead letter", async () => {
    const runId=await createRun("retry lifecycle"); await enqueue(runId); const first=await claim("retry-worker");
    expect((await pool!.query<{status:string}>("select public.fail_research_job($1,$2,$3,true,'provider_timeout','Provider timeout') status",[first.id,first.lease_owner,first.lease_token])).rows[0].status).toBe("retry_scheduled");
    expect((await pool!.query("select status from public.research_runs where id=$1",[runId])).rows[0].status).not.toBe("failed");
    await pool!.query("update public.research_jobs set available_at=now() where id=$1",[first.id]); const second=await claim("retry-worker");
    expect((await pool!.query<{status:string}>("select public.fail_research_job($1,$2,$3,false,'invalid_payload','Invalid job payload') status",[second.id,second.lease_owner,second.lease_token])).rows[0].status).toBe("dead_lettered");
    expect((await pool!.query("select status from public.research_runs where id=$1",[runId])).rows[0].status).toBe("failed");
  });
  it("makes cancellation terminal and prevents stale completion", async () => {
    const runId=await createRun("cancel lifecycle"); await enqueue(runId); const job=await claim("cancel-worker");
    expect((await pool!.query<{ok:boolean}>("select public.cancel_research_as($1,$2,null) ok",[runId,userId])).rows[0].ok).toBe(true);
    expect((await pool!.query<{ok:boolean}>("select public.complete_research_job($1,$2,$3) ok",[job.id,job.lease_owner,job.lease_token])).rows[0].ok).toBe(false);
  });
  it("enforces execution deadlines and rejects completion after timeout", async () => {
    const runId=await createRun("deadline lifecycle"); await enqueue(runId); const job=await claim("deadline-worker");
    await pool!.query("update public.research_jobs set deadline_at=now()-interval '1 second' where id=$1", [job.id]);
    expect((await pool!.query<{ok:boolean}>("select public.heartbeat_research_job($1,$2,$3,'30 seconds') ok", [job.id,job.lease_owner,job.lease_token])).rows[0].ok).toBe(false);
    expect((await pool!.query<{status:string}>("select public.fail_research_job($1,$2,$3,true,'deadline_expired','Research execution deadline expired') status", [job.id,job.lease_owner,job.lease_token])).rows[0].status).toBe("dead_lettered");
    expect((await pool!.query<{ok:boolean}>("select public.complete_research_job($1,$2,$3) ok", [job.id,job.lease_owner,job.lease_token])).rows[0].ok).toBe(false);
  });
  it("requeues owned work on graceful shutdown and fences the old token", async () => {
    const runId=await createRun("shutdown lifecycle"); await enqueue(runId); const job=await claim("shutdown-worker");
    expect((await pool!.query<{count:number}>("select public.requeue_worker_jobs('shutdown-worker') count")).rows[0].count).toBe(1);
    expect((await pool!.query("select status from public.research_jobs where id=$1", [job.id])).rows[0].status).toBe("retry_scheduled");
    expect((await pool!.query<{ok:boolean}>("select public.complete_research_job($1,$2,$3) ok", [job.id,job.lease_owner,job.lease_token])).rows[0].ok).toBe(false);
    await pool!.query("select public.cancel_research_as($1,$2,null)", [runId,userId]);
  });
  it("returns identical enqueues and rejects mismatched key reuse", async () => {
    const runId=await createRun("idempotency"); const key=crypto.randomUUID(); const first=await enqueue(runId,key); const duplicate=await enqueue(runId,key);
    expect(duplicate.rows[0].id).toBe(first.rows[0].id);
    await expect(pool!.query("select public.enqueue_research_job($1,$2,'research.resume','{}',$3,3,null)",[userId,runId,key])).rejects.toMatchObject({code:"23505"});
    await pool!.query("select public.cancel_research_as($1,$2,null)", [runId,userId]);
  });
  it("preserves history and creates an audited checkpoint replay", async () => {
    const runId=await createRun("operator replay"); await enqueue(runId); const job=await claim("replay-worker");
    expect(job.run_id).toBe(runId);
    await pool!.query("select public.fail_research_job($1,$2,$3,false,'deterministic','Deterministic failure')",[job.id,job.lease_owner,job.lease_token]);
    expect((await pool!.query("select status from public.research_jobs where id=$1", [job.id])).rows[0].status).toBe("dead_lettered");
    expect((await pool!.query("select count(*)::int count from public.research_jobs where run_id=$1 and status in ('queued','running','retry_scheduled')", [runId])).rows[0].count).toBe(0);
    const replay=await pool!.query<Record<string,unknown>>("select replacement.* from public.operator_replay_research_job($1,$2) replacement",[job.id,operatorId]);
    expect(replay.rows[0].id).not.toBe(job.id); expect(replay.rows[0].replayed_from_job_id).toBe(job.id);
    expect((await pool!.query("select count(*)::int count from public.research_job_attempts where job_id=$1",[job.id])).rows[0].count).toBe(1);
    expect((await pool!.query("select status from public.research_runs where id=$1",[runId])).rows[0].status).toBe("queued");
    expect((await pool!.query("select count(*)::int count from public.operator_actions where target_id=$1 and action='job.replay'",[job.id])).rows[0].count).toBe(1);
  });
});
