"use client";
// Skill detail drawer: edit the capability + link it to agents. Linking writes Agent.skill_ids (a separate
// CAS) and surfaces the risk/role/approval warnings the goal asks for — a capability is not a permission.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Archive, ArchiveRestore, Trash2, Link2, AlertTriangle, ShieldAlert, Lock, X } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useConfirm } from "@/components/ui/confirm";
import { AgentAvatar, RoleChip } from "@/components/fleet/agent-meta";
import { RiskBadge } from "./risk-badge";
import { evaluateSkillForAgent, type SkillWarning } from "@/lib/skills-view";
import { SKILL_RISKS, type Skill, type SkillInput, type Agent, type AgentInput } from "@/lib/types";
import type { SaveResult } from "./use-skills";

const inputCls = "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-white/45">{label}{hint && <span className="text-white/25">{hint}</span>}</span>
      {children}
    </label>
  );
}
function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-white/70">{label}</span>
      <button onClick={() => onChange(!on)} className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-emerald-500" : "bg-white/15"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${on ? "left-[1.125rem]" : "left-0.5"}`} />
      </button>
    </div>
  );
}
function Chips({ values, onChange, placeholder }: { values: string[]; onChange: (v: string[]) => void; placeholder: string }) {
  const [t, setT] = useState("");
  const add = () => { const v = t.trim(); if (v && !values.includes(v)) onChange([...values, v]); setT(""); };
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-2">
      <div className="flex flex-wrap gap-1">
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-white/70">
            {v}<button onClick={() => onChange(values.filter((x) => x !== v))} className="text-white/40 hover:text-white"><X className="size-3" /></button>
          </span>
        ))}
      </div>
      <input value={t} onChange={(e) => setT(e.target.value)} onBlur={add} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25" />
    </div>
  );
}

function WarnChip({ w }: { w: SkillWarning }) {
  const cls = w.severity === "high" ? "border-red-500/30 bg-red-500/15 text-red-300" : w.severity === "medium" ? "border-amber-500/30 bg-amber-500/15 text-amber-300" : "border-white/10 bg-white/5 text-white/50";
  const Icon = w.severity === "high" ? ShieldAlert : w.severity === "medium" ? AlertTriangle : Lock;
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${cls}`}><Icon className="size-3" /> {w.message}</span>;
}

export function SkillDetail({
  open, onClose, skill, agents, saveSkill, saveAgent,
}: {
  open: boolean;
  onClose: () => void;
  skill: Skill | null;
  agents: Agent[];
  saveSkill: (p: { upsert?: SkillInput; remove?: string }, c?: boolean) => Promise<SaveResult>;
  saveAgent: (p: { upsert?: AgentInput }, c?: boolean) => Promise<SaveResult>;
}) {
  const [s, setS] = useState<Skill | null>(skill);
  const [schemaText, setSchemaText] = useState("");
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  // re-seed only when the selected skill IDENTITY changes — a same-id reload (post-save / archive) must
  // not clobber in-progress edits.
  useEffect(() => {
    setS(skill);
    setSchemaText(skill?.config_schema ? JSON.stringify(skill.config_schema, null, 2) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skill?.id]);
  if (!s) return null;
  const set = <K extends keyof Skill>(k: K, v: Skill[K]) => setS((x) => (x ? { ...x, [k]: v } : x));

  async function save() {
    if (!s) return;
    let config_schema: Record<string, unknown> | null = null;
    if (schemaText.trim()) {
      try {
        const parsed = JSON.parse(schemaText);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config_schema = parsed;
        else return toast.error("config_schema must be a JSON object");
      } catch { return toast.error("config_schema is not valid JSON"); }
    }
    setBusy(true);
    const r = await saveSkill({ upsert: { ...s, config_schema } });
    setBusy(false);
    if (r.ok) toast.success(`${s.name} saved`);
    else toast.error(r.error ?? "Save failed");
  }
  async function toggleArchive() {
    if (!s) return;
    const r = await saveSkill({ upsert: { id: s.id, archived: !s.archived } });
    if (r.ok) { set("archived", !s.archived); toast.success(s.archived ? "Restored" : "Archived"); }
    else toast.error(r.error ?? "Failed");
  }
  async function del() {
    if (!s) return;
    if (await confirm({ title: `Delete skill "${s.name}"?`, body: "Archiving is usually safer — it keeps history.", tone: "danger", confirmLabel: "Delete" })) {
      const r = await saveSkill({ remove: s.id });
      if (r.ok) { toast.success("Deleted"); onClose(); } else toast.error(r.error ?? "Failed");
    }
  }
  async function toggleLink(agent: Agent, linked: boolean) {
    const skill_ids = linked ? agent.skill_ids.filter((x) => x !== s!.id) : [...new Set([...agent.skill_ids, s!.id])];
    // minimal partial patch: the server merges it, so no other field is touched and the fleet-confirm /
    // opus-gate can't trip on an unchanged value.
    const r = await saveAgent({ upsert: { id: agent.id, skill_ids } });
    if (!r.ok) toast.error(r.error ?? "Could not update link");
  }

  return (
    <Drawer open={open} onOpenChange={(o) => !o && onClose()}>
      {open && (
        <DrawerContent title="Skill">
          <div className="space-y-4 p-4">
            {/* header */}
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{s.name}</p>
              <RiskBadge risk={s.risk_level} />
            </div>

            {/* edit form */}
            <Field label="Name"><input className={inputCls} value={s.name} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="Description"><textarea className="min-h-16 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white outline-none focus:border-emerald-500/40" value={s.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Category"><input className={inputCls} value={s.category} onChange={(e) => set("category", e.target.value)} /></Field>
              <Field label="Risk level"><select className={inputCls} value={s.risk_level} onChange={(e) => set("risk_level", e.target.value as Skill["risk_level"])}>{SKILL_RISKS.map((r) => <option key={r} value={r} className="bg-[#0d1322]">{r}</option>)}</select></Field>
            </div>
            <Field label="Compatible roles" hint="empty = all"><Chips values={s.compatible_roles} onChange={(v) => set("compatible_roles", v)} placeholder="role + Enter" /></Field>
            <Field label="Allowed tools"><Chips values={s.allowed_tools} onChange={(v) => set("allowed_tools", v)} placeholder="Read, Edit, Bash…" /></Field>
            <Field label="Required permissions"><Chips values={s.required_permissions} onChange={(v) => set("required_permissions", v)} placeholder="repo:read…" /></Field>
            <Field label="config_schema (JSON, optional)"><textarea spellCheck={false} className="min-h-20 w-full rounded-lg border border-white/10 bg-black/40 p-2 font-mono text-[11px] text-white/80 outline-none focus:border-emerald-500/40" value={schemaText} onChange={(e) => setSchemaText(e.target.value)} placeholder='{ "type": "object", "properties": {} }' /></Field>
            <Toggle on={s.approval_required} onChange={(v) => set("approval_required", v)} label="Approval required per use" />
            {!s.approval_required && (s.risk_level === "high" || s.risk_level === "critical") && (
              <p className="flex items-start gap-1.5 text-[11px] text-amber-300"><AlertTriangle className="mt-0.5 size-3 shrink-0" /> A {s.risk_level}-risk skill without approval is dangerous on autonomous agents.</p>
            )}
            <Toggle on={s.enabled} onChange={(v) => set("enabled", v)} label="Enabled" />
            <button onClick={save} disabled={busy} className="h-10 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">{busy ? "Saving…" : "Save skill"}</button>
            <div className="flex gap-2">
              <button onClick={toggleArchive} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/10 text-sm text-white/70 hover:bg-white/5">{s.archived ? <><ArchiveRestore className="size-4" /> Restore</> : <><Archive className="size-4" /> Archive</>}</button>
              <button onClick={del} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-white/10 px-3 text-sm text-red-300 hover:bg-red-500/10"><Trash2 className="size-4" /></button>
            </div>

            {/* linked agents + warnings */}
            <div className="border-t border-white/10 pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-white/50"><Link2 className="size-3.5" /> Agents — link this capability</p>
              <div className="space-y-1.5">
                {agents.length === 0 && <p className="text-xs text-white/40">No agents in the registry yet.</p>}
                {agents.map((a) => {
                  const linked = a.skill_ids.includes(s.id);
                  const warns = evaluateSkillForAgent(s, a).filter((w) => w.kind !== "approval_required" && w.kind !== "disabled");
                  return (
                    <div key={a.id} className={`rounded-xl border p-2 ${linked ? "border-emerald-400/40 bg-emerald-500/[0.05]" : "border-white/10 bg-white/[0.02]"}`}>
                      <div className="flex items-center gap-2">
                        <AgentAvatar name={a.name} role={a.role} />
                        <span className="min-w-0 flex-1 truncate text-sm text-white/85">{a.name}</span>
                        <RoleChip role={a.role} />
                        <button onClick={() => toggleLink(a, linked)} title={linked ? "Unlink" : "Link"} className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${linked ? "bg-emerald-500" : "bg-white/15"}`}>
                          <span className={`absolute top-0.5 size-4 rounded-full bg-white transition-all ${linked ? "left-[1.125rem]" : "left-0.5"}`} />
                        </button>
                      </div>
                      {warns.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1">{warns.map((w, i) => <WarnChip key={i} w={w} />)}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}
