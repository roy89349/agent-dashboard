"use client";
// One poll of ONE endpoint (/api/war-room) drives the whole screen. It pauses while the tab is hidden and
// re-fetches on return — no fan-out, no runaway polling. The previous snapshot is kept during a refetch (no flicker).
import { useCallback, useEffect, useRef, useState } from "react";
import type { WarRoomSnapshot } from "@/lib/war-room";

export function useWarRoom(intervalMs = 5000) {
  const [snap, setSnap] = useState<WarRoomSnapshot | null>(null);
  const [error, setError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useCallback(async () => {
    try {
      const r = await fetch("/api/war-room", { cache: "no-store" });
      if (r.ok) { setSnap(await r.json()); setError(false); } else setError(true);
    } catch { setError(true); }
  }, []);

  useEffect(() => {
    let alive = true;
    const loop = async () => {
      if (!alive) return;
      if (typeof document === "undefined" || !document.hidden) await tick();
      if (!alive) return; // re-check after the await so we never arm a timer past unmount
      timer.current = setTimeout(loop, intervalMs);
    };
    loop();
    const onVis = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { alive = false; if (timer.current) clearTimeout(timer.current); document.removeEventListener("visibilitychange", onVis); };
  }, [tick, intervalMs]);

  return { snap, error, refresh: tick };
}
