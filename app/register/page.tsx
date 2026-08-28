"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const { data, error } = await createSupabaseBrowserClient().auth.signUp({ email, password });
    if (error) { setMessage(error.message); return; }
    if (data.session) { router.replace("/"); return; }
    setMessage("Account created. Check your email if confirmation is enabled.");
  }
  return <main className="min-h-screen grid place-items-center bg-[#f4f2eb] p-6"><form onSubmit={submit} className="card w-full max-w-md p-8 space-y-4"><h1 className="serif text-4xl">Create your Jarvis account</h1><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-lg border p-3"/><input required minLength={8} type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-lg border p-3"/>{message && <p className="text-sm text-[#526057]">{message}</p>}<button className="w-full rounded-lg bg-[#17211b] p-3 text-white">Register</button><a className="text-sm underline" href="/login">Already have an account?</a></form></main>;
}
