import { Pool, type PoolClient, type QueryResultRow } from "pg";

const globalDb = globalThis as typeof globalThis & { __jarvisPool?: Pool };

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  globalDb.__jarvisPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
  return globalDb.__jarvisPool;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  return getPool().query<T>(text, values);
}
