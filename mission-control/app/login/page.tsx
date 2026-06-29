"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: pw }),
    });
    setBusy(false);
    if (res.ok) router.push("/");
    else if (res.status === 429) setErr("Too many attempts — please wait.");
    else setErr("Wrong password");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0B1220] p-6">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-xl">
        <div>
          <h1 className="text-xl font-semibold text-[#0F172A]">Mission Control</h1>
          <p className="text-sm text-[#64748B]">Sign in to control the dev-fleet.</p>
        </div>
        <Input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="text-sm text-red-500">{err}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy}>
          {busy ? "Working…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
