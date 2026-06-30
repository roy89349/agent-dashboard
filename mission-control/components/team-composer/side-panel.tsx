"use client";
// Tabbed editing surface (right drawer on desktop / bottom-sheet on mobile): Agent | Team | Routing |
// Approval | Budget. Team/Routing/Approval/Budget edit the local draft (saved together by the composer's
// Save). The Agent tab edits the shared registry immediately (separate CAS); fleet-affecting changes are
// confirmed (412). Dangerous options (auto-merge, autonomy "full") are disabled unless the server allows.
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Crown, Trash2, X } from "lucide-react";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import { useConfirm } from "@/components/ui/confirm";
import { AUTONOMY_LEVELS, EDGE_KINDS } from "@/lib/types";
import type { Team, Agent, Autonomy, AgentModel, ApprovalMode, RoutingRule } from "@/lib/types";
import type { SaveResult } from "./use-teams";

type Tab = "agent" | "team" | "routing" | "approval" | "budget";

export function SidePanel(props: {
  open: boolean;
  onClose: () => void;
  tab: Tab;
  setTab: (t: Tab) => void;
  draft: Team;
  setDraft: (fn: (d: Team) => Team) => void;
  agents: Agent[];
  selectedAgent: Agent | null;
  saveAgent: (patch: { upsert?: Agent }, confirm?: boolean) => Promise<SaveResult>;
  allowAutoMerge: boolean;
  allowGlobalOpus: boolean;
  onSetLead: (id: string) => void;
  onRemoveMember: (id: string) => void;
}) {
  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: "agent", label: "Agent", show: !!props.selectedAgent },
    { key: "team", label: "Team", show: true },
    { key: "routing", label: "Routing", show: true },
    { key: "approval", label: "Approval", show: true },
    { key: "budget", label: "Budget", show: true },
  ];
  return (
    <Drawer open={props.open} onOpenChange={(o) => !o && props.onClose()}>
      {props.open && (
        <DrawerContent title="Configure">
          <div className="flex gap-1 overflow-x-auto border-b border-white/10 px-3 py-2">
            {tabs.filter((t) => t.show).map((t) => (
              <button
                key={t.key}
                onClick={() => props.setTab(t.key)}
                className={`shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors ${props.tab === t.key ? "bg-white/10 text-white" : "text-white/50 hover:text-white/80"}`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="p-4">
            {props.tab === "agent" && props.selectedAgent && <AgentTab {...props} agent={props.selectedAgent} />}
            {props.tab === "team" && <TeamTab draft={props.draft} setDraft={props.setDraft} />}
            {props.tab === "routing" && <RoutingTab draft={props.draft} setDraft={props.setDraft} agents={props.agents} />}
            {props.tab === "approval" && <ApprovalTab draft={props.draft} setDraft={props.setDraft} agents={props.agents} allowAutoMerge={props.allowAutoMerge} />}
            {props.tab === "budget" && <BudgetTab draft={props.draft} setDraft={props.setDraft} />}
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}

// ── shared field bits ──
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-xs text-white/45">{label}{hint && <span className="text-white/25">{hint}</span>}</span>
      {children}
    </label>
  );
}
const inputCls = "h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40";
function Select({ value, onChange, options, disabledValues = [] }: { value: string; onChange: (v: string) => void; options: { v: string; l?: string }[]; disabledValues?: string[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => <option key={o.v} value={o.v} disabled={disabledValues.includes(o.v)} className="bg-[#0d1322]">{o.l ?? o.v}</option>)}
    </select>
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
      <input value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} placeholder={placeholder} className="mt-1 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/25" />
    </div>
  );
}

// ── Agent tab (edits the shared registry) ──
function AgentTab({ agent, saveAgent, allowAutoMerge, allowGlobalOpus, draft, onSetLead, onRemoveMember }: {
  agent: Agent; saveAgent: (p: { upsert?: Agent }, c?: boolean) => Promise<SaveResult>; allowAutoMerge: boolean; allowGlobalOpus: boolean; draft: Team; onSetLead: (id: string) => void; onRemoveMember: (id: string) => void;
}) {
  const [a, setA] = useState<Agent>(agent);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();
  useEffect(() => setA(agent), [agent]);
  const set = <K extends keyof Agent>(k: K, v: Agent[K]) => setA((s) => ({ ...s, [k]: v }));

  async function save(force?: boolean) {
    setBusy(true);
    const r = await saveAgent({ upsert: a }, force);
    setBusy(false);
    if (r.ok) toast.success(`${a.name} saved`);
    else if (r.needsConfirm) {
      if (await confirm({ title: "This changes the running fleet", body: r.error, tone: "danger", confirmLabel: "Apply anyway" })) save(true);
    } else if (r.conflict) toast.error(r.error ?? "reloaded");
    else toast.error(r.error ?? "Save failed");
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">{agent.name} <span className="text-white/40">· {agent.role}</span></p>
        <div className="flex gap-1">
          <button onClick={() => onSetLead(agent.id)} title="Set as lead" className={`grid size-8 place-items-center rounded-lg border border-white/10 ${draft.lead === agent.id ? "text-amber-300" : "text-white/50 hover:bg-white/5"}`}><Crown className="size-4" /></button>
          <button onClick={() => onRemoveMember(agent.id)} title="Remove from team" className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/50 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="size-4" /></button>
        </div>
      </div>
      <Field label="Name"><input className={inputCls} value={a.name} onChange={(e) => set("name", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Model"><Select value={a.model_default} onChange={(v) => set("model_default", v as AgentModel)} options={[{ v: "haiku" }, { v: "sonnet" }, { v: "opus" }]} disabledValues={allowGlobalOpus ? [] : ["opus"]} /></Field>
        <Field label="Effort"><Select value={a.effort_default} onChange={(v) => set("effort_default", v as Agent["effort_default"])} options={["low", "medium", "high", "xhigh", "max"].map((v) => ({ v }))} /></Field>
        <Field label="Depth"><Select value={a.depth_default} onChange={(v) => set("depth_default", v as Agent["depth_default"])} options={[{ v: "solo" }, { v: "orchestrate" }]} /></Field>
        <Field label="Autonomy" hint={!allowAutoMerge ? "full disabled" : undefined}><Select value={a.autonomy} onChange={(v) => set("autonomy", v as Autonomy)} options={AUTONOMY_LEVELS.map((v) => ({ v }))} disabledValues={allowAutoMerge ? [] : ["full"]} /></Field>
        <Field label="Max concurrency"><input type="number" min={1} className={inputCls} value={a.max_concurrency} onChange={(e) => set("max_concurrency", Math.max(1, +e.target.value || 1))} /></Field>
        <Field label="Daily token budget" hint="blank = none"><input type="number" min={0} className={inputCls} value={a.daily_token_budget ?? ""} onChange={(e) => set("daily_token_budget", e.target.value === "" ? null : Math.max(0, +e.target.value || 0))} /></Field>
      </div>
      <Field label="Skills"><Chips values={a.skills} onChange={(v) => set("skills", v)} placeholder="add a skill + Enter" /></Field>
      <Toggle on={a.blocking} onChange={(v) => set("blocking", v)} label="Blocking reviewer (reject blocks the PR)" />
      <Toggle on={a.enabled} onChange={(v) => set("enabled", v)} label="Enabled (live in the fleet)" />
      <button onClick={() => save()} disabled={busy} className="h-10 w-full rounded-xl bg-emerald-500 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">{busy ? "Saving…" : "Save agent"}</button>
    </div>
  );
}

// ── Team tab (edits the draft) ──
function TeamTab({ draft, setDraft }: { draft: Team; setDraft: (fn: (d: Team) => Team) => void }) {
  return (
    <div className="space-y-3">
      <Field label="Name"><input className={inputCls} value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} /></Field>
      <Field label="Description"><textarea className="min-h-16 w-full rounded-lg border border-white/10 bg-white/5 p-2 text-sm text-white outline-none focus:border-emerald-500/40" value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} /></Field>
      <Field label="Issue labels this team claims"><Chips values={draft.labels} onChange={(v) => setDraft((d) => ({ ...d, labels: v }))} placeholder="e.g. agent-ready" /></Field>
      <Field label="Repo scope" hint="owner/repo"><Chips values={draft.project_scope.repos} onChange={(v) => setDraft((d) => ({ ...d, project_scope: { ...d.project_scope, repos: v } }))} placeholder="owner/repo" /></Field>
      <Field label="Path scope"><Chips values={draft.project_scope.paths} onChange={(v) => setDraft((d) => ({ ...d, project_scope: { ...d.project_scope, paths: v } }))} placeholder="src/**" /></Field>
      <Toggle on={draft.enabled} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} label="Enabled" />
      <Toggle on={draft.is_template} onChange={(v) => setDraft((d) => ({ ...d, is_template: v }))} label="Template (excluded from active routing)" />
    </div>
  );
}

// ── Routing tab ──
function RoutingTab({ draft, setDraft, agents }: { draft: Team; setDraft: (fn: (d: Team) => Team) => void; agents: Agent[] }) {
  const targets = [...new Set([...draft.members, ...agents.map((a) => a.role)])];
  const setRules = (rules: RoutingRule[]) => setDraft((d) => ({ ...d, routing_rules: rules }));
  const add = () => setRules([...draft.routing_rules, { id: `rule-${draft.routing_rules.length + 1}`, enabled: true, priority: 100, match: { labels: [], path_globs: [], repos: [] }, assign_to: draft.members[0] ?? "", fallback_to: null }]);
  return (
    <div className="space-y-3">
      {draft.routing_rules.length === 0 && <p className="text-xs text-white/40">No routing rules — issues use the global fleet routing. Add a rule to assign matching work to a member/role.</p>}
      {draft.routing_rules.map((r, i) => (
        <div key={i} className="space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <Toggle on={r.enabled} onChange={(v) => setRules(draft.routing_rules.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} label={r.id} />
            <button onClick={() => setRules(draft.routing_rules.filter((_, j) => j !== i))} className="text-white/40 hover:text-red-300"><Trash2 className="size-4" /></button>
          </div>
          <Field label="Match labels"><Chips values={r.match.labels} onChange={(v) => setRules(draft.routing_rules.map((x, j) => (j === i ? { ...x, match: { ...x.match, labels: v } } : x)))} placeholder="label + Enter" /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Assign to"><Select value={r.assign_to} onChange={(v) => setRules(draft.routing_rules.map((x, j) => (j === i ? { ...x, assign_to: v } : x)))} options={targets.map((v) => ({ v }))} /></Field>
            <Field label="Priority"><input type="number" className={inputCls} value={r.priority} onChange={(e) => setRules(draft.routing_rules.map((x, j) => (j === i ? { ...x, priority: +e.target.value || 0 } : x)))} /></Field>
          </div>
        </div>
      ))}
      <button onClick={add} className="h-9 w-full rounded-lg border border-white/10 text-sm text-white/70 hover:bg-white/5">+ Add routing rule</button>
    </div>
  );
}

// ── Approval tab ──
function ApprovalTab({ draft, setDraft, agents, allowAutoMerge }: { draft: Team; setDraft: (fn: (d: Team) => Team) => void; agents: Agent[]; allowAutoMerge: boolean }) {
  const ap = draft.approval_policy;
  const memberRoles = [...new Set(draft.members.map((m) => agents.find((a) => a.id === m)?.role).filter((x): x is string => !!x))];
  const setAp = (patch: Partial<typeof ap>) => setDraft((d) => ({ ...d, approval_policy: { ...d.approval_policy, ...patch } }));
  return (
    <div className="space-y-3">
      <Field label="Mode"><Select value={ap.mode} onChange={(v) => setAp({ mode: v as ApprovalMode })} options={[{ v: "manual", l: "manual — every PR needs a human" }, { v: "auto_below_risk", l: "auto below a risk level" }, { v: "auto", l: "auto (auto-merge)" }]} disabledValues={allowAutoMerge ? [] : ["auto"]} /></Field>
      {ap.mode === "auto_below_risk" && <Field label="Auto-approve up to risk"><Select value={ap.auto_approve_max_risk ?? "low"} onChange={(v) => setAp({ auto_approve_max_risk: v as "low" | "medium" })} options={[{ v: "low" }, { v: "medium" }]} /></Field>}
      <Field label="Required reviews" hint={ap.mode !== "manual" ? "min 1" : undefined}><input type="number" min={ap.mode === "manual" ? 0 : 1} max={10} className={inputCls} value={ap.required_reviews} onChange={(e) => setAp({ required_reviews: Math.max(0, Math.min(10, +e.target.value || 0)) })} /></Field>
      <Field label="Blocking roles" hint="must be member roles"><Chips values={ap.blocking_roles} onChange={(v) => setAp({ blocking_roles: v.filter((r) => memberRoles.includes(r)) })} placeholder={memberRoles.join(", ") || "no member roles yet"} /></Field>
      <Toggle on={ap.auto_merge} onChange={(v) => setAp({ auto_merge: v })} label={`Auto-merge${allowAutoMerge ? "" : " (disabled — ALLOW_AUTO_MERGE)"}`} />
      {ap.auto_merge && !allowAutoMerge && <p className="text-[11px] text-red-300">Auto-merge is server-disabled; saving with it on will be rejected (403).</p>}
    </div>
  );
}

// ── Budget tab ──
function BudgetTab({ draft, setDraft }: { draft: Team; setDraft: (fn: (d: Team) => Team) => void }) {
  const b = draft.budget_caps;
  const setB = (patch: Partial<typeof b>) => setDraft((d) => ({ ...d, budget_caps: { ...d.budget_caps, ...patch } }));
  const num = (v: number | null, on: (n: number | null) => void, ph: string) => (
    <input type="number" min={0} placeholder={ph} className={inputCls} value={v ?? ""} onChange={(e) => on(e.target.value === "" ? null : Math.max(0, +e.target.value || 0))} />
  );
  return (
    <div className="space-y-3">
      <Field label="Team daily token budget" hint="blank = inherit">{num(b.daily_token_budget, (n) => setB({ daily_token_budget: n }), "no cap")}</Field>
      <Field label="Max concurrency" hint="blank = inherit">{num(b.max_concurrency, (n) => setB({ max_concurrency: n }), "inherit")}</Field>
      <Field label="Max PR / day" hint="blank = inherit">{num(b.max_pr_per_day, (n) => setB({ max_pr_per_day: n }), "inherit")}</Field>
      <p className="text-[11px] text-white/35">Per-agent overrides may only lower an agent&apos;s own budget; they are clamped server-side.</p>
    </div>
  );
}
