import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}

export async function requireAuthenticatedUser() {
  const user = await getAuthenticatedUser();
  if (!user) throw new Error("Authentication required");
  return user;
}
