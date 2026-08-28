"use client";

import { FormEvent, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { error: signInError } = await createSupabaseBrowserClient().auth.signInWithPassword({ email, password });
    if (signInError) setError(signInError.message);
    else window.location.assign(new URLSearchParams(window.location.search).get("next") ?? "/");
  }
  return <main className="min-h-screen grid place-items-center bg-[#f4f2eb] p-6"><form onSubmit={submit} className="card w-full max-w-md p-8 space-y-4"><h1 className="serif text-4xl">Sign in to Jarvis</h1><input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="Email" className="w-full rounded-lg border p-3"/><input required type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Password" className="w-full rounded-lg border p-3"/>{error && <p className="text-sm text-red-700">{error}</p>}<button className="w-full rounded-lg bg-[#17211b] p-3 text-white">Sign in</button><a className="text-sm underline" href="/register">Create an account</a></form></main>;
}
