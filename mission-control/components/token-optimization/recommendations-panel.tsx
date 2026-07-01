"use client";
// Optimization Recommendations — rule-based suggestions over the last 7 days. Nothing self-applies:
// Apply/Dismiss are explicit actions, and Apply only flips policy through the validated budget-manager.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Lightbulb, Sparkles, X } from "lucide-react";
import { SectionLabel } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import type { Recommendation } from "@/lib/token-optimization/recommendations";
import { Skeleton } from "./parts";

export function RecommendationsPanel() {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (generate = false) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/token-optimization/recommendations${generate ? "?generate=1" : ""}`, { cache: "no-store" });
      if (r.ok) {
        setRecs((await r.json()).recommendations ?? []);
        if (generate) toast.success("Recommendations regenerated from the last 7 days");
      } else toast.error("Failed to load recommendations");
    } catch {
      toast.error("Failed to load recommendations");
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, status: "applied" | "dismissed") {
    const r = await fetch("/api/token-optimization/recommendations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (r.ok) {
      toast.success(status === "applied" ? "Recommendation applied" : "Recommendation dismissed");
      load();
    } else {
      const j = await r.json().catch(() => ({}));
      toast.error(j.error ?? "Action failed");
    }
  }

  const open = (recs ?? []).filter((r) => r.status === "open");
  const closed = (recs ?? []).filter((r) => r.status !== "open");

  return (
    <div className="space-y-4">
      <section className="glass p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2">
          <SectionLabel>Open recommendations</SectionLabel>
          <Button size="sm" className="min-h-11" onClick={() => load(true)} disabled={busy}>
            <Sparkles className="size-4" /> Generate
          </Button>
        </div>
        {recs == null ? (
          <Skeleton className="h-28" />
        ) : open.length === 0 ? (
          <EmptyState icon={Lightbulb} title="No open recommendations" hint="Hit Generate to scan the last 7 days of usage, cache and compression stats for savings opportunities." tone="slate" />
        ) : (
          <div className="space-y-2">
            {open.map((r) => (
              <div key={r.id} className="glass-card p-3">
                <div className="flex flex-wrap items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-medium text-white/85">{r.title}</p>
                  {r.impact && <Badge tone="indigo">{r.impact}</Badge>}
                </div>
                {r.detail && <p className="mt-1 text-xs leading-relaxed text-white/45">{r.detail}</p>}
                <div className="mt-2.5 flex gap-2">
                  <Button size="sm" variant="accent" className="min-h-11 flex-1 sm:flex-none" onClick={() => act(r.id, "applied")}>
                    <Check className="size-4" /> Apply
                  </Button>
                  <Button size="sm" variant="secondary" className="min-h-11 flex-1 sm:flex-none" onClick={() => act(r.id, "dismissed")}>
                    <X className="size-4" /> Dismiss
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section className="glass p-4">
          <SectionLabel className="mb-2.5">Applied &amp; dismissed</SectionLabel>
          <div className="space-y-1.5">
            {closed.map((r) => (
              <div key={r.id} className="glass-inset flex flex-wrap items-center gap-2 px-3 py-2 text-xs opacity-60">
                <Badge tone={r.status === "applied" ? "emerald" : "slate"}>{r.status}</Badge>
                <span className="min-w-0 flex-1 truncate text-white/60">{r.title}</span>
                {r.impact && <span className="text-white/30">{r.impact}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
