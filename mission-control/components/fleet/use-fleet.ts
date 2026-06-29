"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FleetStatus, FleetDesired } from "@/lib/types";

/**
 * Shared fleet-state hook: polls status + desired state, and provides write actions
 * (declarative patch with CAS retry, imperative commands). One poll per consumer.
 */
export function useFleet(pollMs = 3000) {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [desired, setDesired] = useState<FleetDesired | null>(null);
  const [rev, setRev] = useState(0);
  const revRef = useRef(0);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [s, f] = await Promise.all([
        fetch("/api/fleet/status", { cache: "no-store" }),
        fetch("/api/fleet", { cache: "no-store" }),
      ]);
      if (s.ok) setStatus((await s.json()).status);
      if (f.ok) {
        const d = (await f.json()).fleet as FleetDesired;
        revRef.current = d.rev;
        setRev(d.rev);
        setDesired(d);
      }
    } catch {
      /* fleet offline → status stays null */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  const patch = useCallback(
    async (p: Record<string, unknown>, confirm?: boolean, retry = true): Promise<boolean> => {
      setBusy(true);
      try {
        const res = await fetch("/api/fleet", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ patch: p, baseRev: revRef.current, confirm }),
        });
        if (res.ok) {
          const nr = (await res.json()).rev as number;
          revRef.current = nr;
          setRev(nr);
          refresh();
          return true;
        }
        if (res.status === 409 && retry) {
          await refresh();
          return patch(p, confirm, false);
        }
        const j = await res.json().catch(() => ({}));
        toast.error(j.error ?? `Failed (${res.status})`);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh],
  );

  const command = useCallback(
    async (cmd: string, issue?: number, confirm?: boolean) => {
      const res = await fetch("/api/fleet/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cmd, issue, confirm }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(cmd === "breaker-reset" ? "Breaker reset" : `${cmd} #${issue} sent`);
        refresh();
      } else {
        toast.error(j.error ?? "Command failed");
      }
    },
    [refresh],
  );

  return { status, desired, rev, loaded, busy, refresh, patch, command };
}

export function fmtDur(s: number | null): string {
  if (s == null || s < 0) return "—";
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return m > 0 ? `${m}m ${ss}s` : `${ss}s`;
}
