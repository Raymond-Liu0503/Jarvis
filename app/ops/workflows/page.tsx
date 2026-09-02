import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth";
import { isOperator } from "@/lib/operator-auth";
import { WorkflowsConsole } from "@/components/workflows-console";

export default async function WorkflowsPage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?next=/ops/workflows");
  if (!isOperator(user)) return <main className="p-10"><h1 className="serif text-3xl">403</h1><p>Operator role required.</p></main>;
  return <WorkflowsConsole />;
}
