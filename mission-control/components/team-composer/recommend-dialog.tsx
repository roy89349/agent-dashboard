"use client";
import { useState } from "react";
import { Sparkles, AlertTriangle } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { PROJECT_TYPES, type ProjectType, type TeamInput } from "@/lib/types";

const LABELS: Record<ProjectType, string> = {
  saas_webapp: "SaaS web app",
  mobile_app: "Mobile app",
  excel_automation: "Excel / data automation",
  security_audit: "Security audit",
  ui_redesign: "UI redesign",
  bugfix_sprint: "Bugfix sprint",
};

export function RecommendDialog({
  open, onClose, onUse,
}: {
  open: boolean;
  onClose: () => void;
  onUse: (draft: TeamInput) => void;
}) {
  const [picked, setPicked] = useState<ProjectType | null>(null);
  const [preview, setPreview] = useState<{ draftTeam: TeamInput; missingRoles: string[] } | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(pt: ProjectType) {
    setPicked(pt);
    setBusy(true);
    setPreview(null);
    try {
      const r = await fetch("/api/teams/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectType: pt }) });
      if (r.ok) setPreview(await r.json());
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle><span className="inline-flex items-center gap-2"><Sparkles className="size-4 text-emerald-300" /> Build a recommended team</span></DialogTitle></DialogHeader>
        <p className="mb-3 text-xs text-white/45">Pick a project type — a starting team is composed from your enabled agents (config-driven rules). You can edit everything before saving.</p>
        <div className="grid grid-cols-2 gap-2">
          {PROJECT_TYPES.map((pt) => (
            <button key={pt} onClick={() => pick(pt)} className={`glass-card min-h-[44px] cursor-pointer p-3 text-left text-sm ${picked === pt ? "glow-ok border-emerald-400/50 bg-emerald-500/10 text-white" : "glass-hover text-white/70"}`}>
              {LABELS[pt]}
            </button>
          ))}
        </div>

        {busy && <p className="mt-4 text-sm text-white/40">Composing…</p>}
        {preview && (
          <div className="glass-inset mt-4 space-y-3 p-3">
            <p className="text-sm font-semibold text-white">{preview.draftTeam.name}</p>
            <div className="flex flex-wrap gap-1">
              {(preview.draftTeam.members ?? []).map((m) => <Badge key={m} tone="slate">{m}{preview.draftTeam.lead === m ? " ★" : ""}</Badge>)}
              {(preview.draftTeam.members ?? []).length === 0 && <span className="text-xs text-white/40">No enabled agents resolved — add some first.</span>}
            </div>
            {preview.missingRoles.length > 0 && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-300">
                <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                No enabled agent for: {preview.missingRoles.join(", ")} — skipped. Add them from a template, then re-build.
              </p>
            )}
            <button
              onClick={() => { onUse(preview.draftTeam); onClose(); }}
              disabled={(preview.draftTeam.members ?? []).length === 0}
              className="h-11 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.2)] transition-colors hover:bg-emerald-400 disabled:opacity-50 disabled:shadow-none"
            >
              Use this team (edit before saving)
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
