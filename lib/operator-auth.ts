import type { User } from "@supabase/supabase-js";
import { getAuthenticatedUser } from "@/lib/auth";

export function isOperator(user: Pick<User, "app_metadata"> | null | undefined) {
  return user?.app_metadata?.role === "operator";
}

export async function getOperator() {
  const user = await getAuthenticatedUser();
  return user && isOperator(user) ? user : null;
}
