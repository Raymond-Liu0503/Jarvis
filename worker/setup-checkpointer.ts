import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { getRuntimeConfig } from "@/lib/runtime-config";

const databaseUrl = getRuntimeConfig().DATABASE_URL;
async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to initialize LangGraph checkpoints");
  const checkpointer = PostgresSaver.fromConnString(databaseUrl, { schema: "langgraph" });
  await checkpointer.setup();
  console.log("LangGraph checkpoint tables are ready");
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
