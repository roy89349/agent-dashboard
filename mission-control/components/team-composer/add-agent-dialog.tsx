"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { AGENT_TEMPLATES } from "@/lib/team-presets";
import type { Agent, AgentInput } from "@/lib/types";
import type { SaveResult } from "./use-teams";

// match the server SLUG: must START with [a-z0-9], then [a-z0-9_-], ≤64
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 64);
const SLUG_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function AddAgentDialog({
  open, onClose, agents, members, saveAgent, onAddMember,
}: {
  open: boolean;
  onClose: () => void;
  agents: Agent[];
  members: string[];
  saveAgent: (p: { upsert?: Agent }, c?: boolean) => Promise<SaveResult>;
  onAddMember: (id: string) => void;
}) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [tplRole, setTplRole] = useState(AGENT_TEMPLATES[0].role);
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState(AGENT_TEMPLATES[0].role);
  const [busy, setBusy] = useState(false);
  const existing = agents.filter((a) => !members.includes(a.id));

  function pickTemplate(r: string) {
    setTplRole(r);
    const t = AGENT_TEMPLATES.find((x) => x.role === r);
    if (t) { setRole(t.role); if (!name) setName(t.name); }
  }

  async function create() {
    const tpl = AGENT_TEMPLATES.find((x) => x.role === tplRole);
    const finalName = name.trim() || tpl?.name || role;
    const finalId = slug(id || finalName || role);
    if (!SLUG_RE.test(finalId)) return toast.error("Id must start with a letter/number (a–z, 0–9, -, _)");
    if (agents.some((a) => a.id === finalId)) return toast.error(`Agent id "${finalId}" already exists`);
    const input: AgentInput = {
      id: finalId, role: role.trim() || "custom", name: finalName,
      skills: tpl?.skills ?? [], model_default: tpl?.model_default ?? "sonnet", effort_default: tpl?.effort_default ?? "medium",
      depth_default: tpl?.depth_default ?? "solo", autonomy: tpl?.autonomy ?? "review", blocking: tpl?.blocking ?? false,
      allowed_tools: tpl?.allowed_tools ?? [], review_of_roles: tpl?.review_of_roles ?? [],
      enabled: false, label_scope: [], // new agents start disabled + unscoped → never auto-route the live fleet
    };
    setBusy(true);
    const r = await saveAgent({ upsert: input as Agent }, false);
    setBusy(false);
    if (r.ok) { onAddMember(finalId); reset(); onClose(); toast.success(`${finalName} created (disabled — enable when ready)`); }
    else toast.error(r.error ?? "Create failed");
  }
  function reset() { setId(""); setName(""); }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add agent</DialogTitle></DialogHeader>
        <div className="mb-3 inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5 text-sm">
          {(["existing", "new"] as const).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`min-h-[36px] rounded-md px-3 py-1 transition-colors ${mode === m ? "bg-white/10 text-white ring-1 ring-white/15" : "text-white/50 hover:text-white/80"}`}>{m === "existing" ? "From registry" : "New / template"}</button>
          ))}
        </div>

        {mode === "existing" ? (
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {existing.length === 0 ? <p className="py-6 text-center text-sm text-white/40">Every registered agent is already on this team.</p> : existing.map((a) => (
              <button key={a.id} onClick={() => { onAddMember(a.id); onClose(); }} className="glass-card glass-hover flex min-h-[44px] w-full cursor-pointer items-center gap-2 p-2 text-left">
                <AgentAvatar name={a.name} role={a.role} />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-white">{a.name}</span></span>
                <RoleChip role={a.role} />
                <Plus className="size-4 text-white/40" />
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            <label className="block"><span className="mb-1 block text-xs text-white/45">Template</span>
              <select value={tplRole} onChange={(e) => pickTemplate(e.target.value)} className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40 md:h-9">
                {AGENT_TEMPLATES.map((t) => <option key={t.role} value={t.role} className="bg-[#0d1322]">{t.name}</option>)}
              </select>
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block"><span className="mb-1 block text-xs text-white/45">Name</span><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Frontend" className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40 md:h-9" /></label>
              <label className="block"><span className="mb-1 block text-xs text-white/45">Role</span><input value={role} onChange={(e) => setRole(e.target.value)} className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40 md:h-9" /></label>
            </div>
            <label className="block"><span className="mb-1 flex justify-between text-xs text-white/45">Agent id <span className="text-white/25">auto from name</span></span><input value={id} onChange={(e) => setId(e.target.value)} placeholder={slug(name || role)} className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none transition-colors focus:border-emerald-500/40 md:h-9" /></label>
            <p className="text-[11px] text-white/35">New agents are created <b>disabled</b> with no label scope, so they never re-route the live fleet until you enable + configure them.</p>
            <button onClick={create} disabled={busy} className="h-11 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black shadow-[0_0_18px_rgba(16,185,129,0.2)] transition-colors hover:bg-emerald-400 disabled:opacity-50">{busy ? "Creating…" : "Create + add to team"}</button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
