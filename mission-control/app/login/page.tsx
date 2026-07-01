"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Radio } from "lucide-react";
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
    <main className="flex min-h-dvh items-center justify-center p-6">
      <form onSubmit={submit} className="glass w-full max-w-sm space-y-4 p-6 shadow-[0_0_40px_rgba(16,185,129,0.07),0_8px_32px_rgba(0,0,0,0.35)]">
        <div className="flex items-center gap-2.5">
          <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-400 to-indigo-500 text-black shadow-[0_0_18px_rgba(16,185,129,0.25)]">
            <Radio className="size-4.5" />
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-semibold tracking-tight text-white">Mission Control</h1>
            <p className="text-xs text-white/40">Sign in to control the dev-fleet.</p>
          </div>
        </div>
        <Input type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <p className="text-sm text-red-400">{err}</p>}
        <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy}>
          {busy ? "Working…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
