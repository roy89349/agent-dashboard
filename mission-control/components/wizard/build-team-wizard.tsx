"use client";
// "Build My Team for this project" wizard: pick a project template → configure → review a full recommendation
// (agents · skills · workflows · autonomy · review/approval/budget/safety/phone) → edit → create a real team or
// save as a reusable template. Rule-based recommendation from the server; everything editable before saving.
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Wand2, ArrowLeft, ArrowRight, Users, GitBranch, ShieldCheck, Gauge, Brain, Smartphone, AlertTriangle, Check, Loader2, Sparkles } from "lucide-react";
import type { Recommendation, WizardInput, RiskLevel, SpeedQuality, ReviewStrictness, ValidationResult } from "@/lib/project-templates";

type TemplateMeta = { id: string; label: string; description: string; default_risk: RiskLevel; roles: string[] };
const RISKS: RiskLevel[] = ["low", "medium", "high", "critical"];
const RISK_TONE: Record<string, string> = { low: "text-emerald-300", medium: "text-amber-300", high: "text-orange-300", critical: "text-red-400" };
const AUT_TONE: Record<string, string> = { suggest: "text-white/50", review: "text-indigo-300", auto: "text-emerald-300", full: "text-red-300" };

export function BuildTeamWizard() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [templates, setTemplates] = useState<TemplateMeta[]>([]);
  const [input, setInput] = useState<WizardInput>({ project_name: "", template_id: "", speed_vs_quality: "balanced", auto_merge: false, phone_updates: true });
  const [rec, setRec] = useState<Recommendation | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropped, setDropped] = useState<Set<string>>(new Set()); // agent ids the user removed

  useEffect(() => { fetch("/api/project-templates", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => setTemplates(j?.templates ?? [])).catch(() => {}); }, []);
  const patch = (p: Partial<WizardInput>) => setInput((s) => ({ ...s, ...p }));

  const recommend = useCallback(async (over: Partial<WizardInput> = {}) => {
    const payload = { ...input, ...over };
    setBusy(true);
    const r = await fetch("/api/project-templates/recommend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setBusy(false);
    if (!r.ok) { toast.error((await r.json().catch(() => ({}))).error ?? "Recommendation failed"); return; }
    const j = await r.json();
    setRec(j.recommendation); setValidation(j.validation); setDropped(new Set()); setStep(3);
  }, [input]);

  async function create(asTemplate: boolean) {
    if (!rec) return;
    const members = (rec.draft_team.members ?? []).filter((m) => !dropped.has(m));
    const lead = rec.lead_agent_id && !dropped.has(rec.lead_agent_id) ? rec.lead_agent_id : null;
    const edges = (rec.draft_team.edges ?? []).filter((e) => members.includes(e.from) && members.includes(e.to));
    const edited: Recommendation = { ...rec, lead_agent_id: lead, draft_team: { ...rec.draft_team, members, lead, edges } };
    setBusy(true);
    const r = await fetch("/api/project-templates/create", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recommendation: edited, asTemplate }) });
    setBusy(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { toast.error(j.error ?? "Create failed"); return; }
    toast.success(asTemplate ? "Saved as reusable template" : `Team “${j.result?.team_id}” created`);
    router.push("/teams");
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-5 pb-24 sm:px-6 md:pb-5">
      <div className="mb-5 flex items-center gap-3">
        <div className="grid size-9 place-items-center rounded-xl border border-white/10 bg-white/5 text-emerald-300"><Wand2 className="size-[18px]" /></div>
        <div><h2 className="text-base font-semibold text-white">Build my team</h2><p className="text-xs text-white/40">Pick a project type → get a full team proposal → tweak → create</p></div>
      </div>

      <Steps step={step} />

      {step === 1 && <TemplateStep templates={templates} input={input} patch={patch} onNext={() => setStep(2)} />}
      {step === 2 && <ConfigStep templates={templates} input={input} patch={patch} busy={busy} onBack={() => setStep(1)} onRecommend={() => recommend()} />}
      {step === 3 && rec && (
        <ReviewStep rec={rec} validation={validation} busy={busy} dropped={dropped} setDropped={setDropped}
          onAdjust={(over) => { patch(over); recommend(over); }} onBack={() => setStep(2)} onCreate={create} />
      )}
    </div>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Template", "Configure", "Review & create"];
  return (
    <div className="mb-5 flex items-center gap-2">
      {labels.map((l, i) => (
        <div key={l} className="flex flex-1 items-center gap-2">
          <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${step > i + 1 ? "bg-emerald-500 text-black" : step === i + 1 ? "bg-white/15 text-white" : "bg-white/5 text-white/40"}`}>{step > i + 1 ? <Check className="size-3.5" /> : i + 1}</span>
          <span className={`text-xs ${step === i + 1 ? "text-white" : "text-white/40"}`}>{l}</span>
          {i < labels.length - 1 && <span className="h-px flex-1 bg-white/10" />}
        </div>
      ))}
    </div>
  );
}

function TemplateStep({ templates, input, patch, onNext }: { templates: TemplateMeta[]; input: WizardInput; patch: (p: Partial<WizardInput>) => void; onNext: () => void }) {
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-white/50">Project name</label>
        <input value={input.project_name} onChange={(e) => patch({ project_name: e.target.value })} placeholder="e.g. Acme billing revamp" className="mt-1 h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40" />
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {templates.map((t) => (
          <button key={t.id} onClick={() => patch({ template_id: t.id })} className={`rounded-xl border p-3 text-left transition-colors ${input.template_id === t.id ? "border-emerald-500/50 bg-emerald-500/[0.06]" : "border-white/10 bg-white/[0.03] hover:border-white/25"}`}>
            <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium text-white">{t.label}</span><span className={`text-[10px] uppercase ${RISK_TONE[t.default_risk]}`}>{t.default_risk} risk</span></div>
            <p className="mt-0.5 text-[11px] text-white/45">{t.description}</p>
            <p className="mt-1 text-[10px] text-white/30">{t.roles.length} roles · {t.roles.slice(0, 5).join(", ")}{t.roles.length > 5 ? "…" : ""}</p>
          </button>
        ))}
      </div>
      <div className="flex justify-end">
        <button disabled={!input.template_id || !input.project_name.trim()} onClick={onNext} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">Next <ArrowRight className="size-4" /></button>
      </div>
    </div>
  );
}

function ConfigStep({ templates, input, patch, busy, onBack, onRecommend }: { templates: TemplateMeta[]; input: WizardInput; patch: (p: Partial<WizardInput>) => void; busy: boolean; onBack: () => void; onRecommend: () => void }) {
  const tpl = templates.find((t) => t.id === input.template_id);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Repo (owner/name)"><input value={input.repo ?? ""} onChange={(e) => patch({ repo: e.target.value })} placeholder="acme/app" className={inp} /></Field>
        <Field label="Tech stack"><input value={input.tech_stack ?? ""} onChange={(e) => patch({ tech_stack: e.target.value })} placeholder="Next.js · Postgres" className={inp} /></Field>
        <Field label="Goal"><input value={input.goal ?? ""} onChange={(e) => patch({ goal: e.target.value })} placeholder="What should this team achieve?" className={inp} /></Field>
        <Field label={`Risk level${tpl ? ` (default ${tpl.default_risk})` : ""}`}>
          <select value={input.risk_level ?? ""} onChange={(e) => patch({ risk_level: (e.target.value || undefined) as RiskLevel })} className={inp}><option value="" className="bg-[#0d1322]">Template default</option>{RISKS.map((r) => <option key={r} value={r} className="bg-[#0d1322] capitalize">{r}</option>)}</select>
        </Field>
        <Field label="Daily budget (est. tokens)"><input type="number" min={0} value={input.budget_tokens ?? ""} onChange={(e) => patch({ budget_tokens: e.target.value ? Number(e.target.value) : null })} placeholder="auto (scales with team)" className={inp} /></Field>
        <Field label="Speed vs quality">
          <select value={input.speed_vs_quality} onChange={(e) => patch({ speed_vs_quality: e.target.value as SpeedQuality })} className={inp}><option value="speed" className="bg-[#0d1322]">Speed</option><option value="balanced" className="bg-[#0d1322]">Balanced</option><option value="quality" className="bg-[#0d1322]">Quality</option></select>
        </Field>
        <Field label="Review strictness">
          <select value={input.review_strictness ?? ""} onChange={(e) => patch({ review_strictness: (e.target.value || undefined) as ReviewStrictness })} className={inp}><option value="" className="bg-[#0d1322]">Auto (from risk/speed)</option><option value="light" className="bg-[#0d1322]">Light</option><option value="standard" className="bg-[#0d1322]">Standard</option><option value="strict" className="bg-[#0d1322]">Strict</option></select>
        </Field>
        <Field label="Knowledge sources (comma-separated)"><input value={(input.knowledge_sources ?? []).join(", ")} onChange={(e) => patch({ knowledge_sources: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })} placeholder="template defaults" className={inp} /></Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <Toggle label="Auto-merge PRs" hint="ignored at high risk" checked={!!input.auto_merge} onChange={(v) => patch({ auto_merge: v })} />
        <Toggle label="Phone updates" checked={input.phone_updates !== false} onChange={(v) => patch({ phone_updates: v })} />
      </div>
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5"><ArrowLeft className="size-4" /> Back</button>
        <button disabled={busy} onClick={onRecommend} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />} Build recommendation</button>
      </div>
    </div>
  );
}

function ReviewStep({ rec, validation, busy, dropped, setDropped, onAdjust, onBack, onCreate }: {
  rec: Recommendation; validation: ValidationResult | null; busy: boolean; dropped: Set<string>; setDropped: (s: Set<string>) => void;
  onAdjust: (over: Partial<WizardInput>) => void; onBack: () => void; onCreate: (asTemplate: boolean) => void;
}) {
  const toggleMember = (id: string) => { const n = new Set(dropped); n.has(id) ? n.delete(id) : n.add(id); setDropped(n); };
  const activeMembers = (rec.draft_team.members ?? []).filter((m) => !dropped.has(m)).length;
  return (
    <div className="space-y-4">
      {/* adjust bar */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-black/20 p-2.5 text-xs">
        <span className="text-white/40">Adjust:</span>
        <select value={rec.risk_level} onChange={(e) => onAdjust({ risk_level: e.target.value as RiskLevel })} className={inpSm}>{RISKS.map((r) => <option key={r} value={r} className="bg-[#0d1322] capitalize">{r} risk</option>)}</select>
        <select value={rec.speed_vs_quality} onChange={(e) => onAdjust({ speed_vs_quality: e.target.value as SpeedQuality })} className={inpSm}><option value="speed" className="bg-[#0d1322]">Speed</option><option value="balanced" className="bg-[#0d1322]">Balanced</option><option value="quality" className="bg-[#0d1322]">Quality</option></select>
        <select value={rec.review_rules.strictness} onChange={(e) => onAdjust({ review_strictness: e.target.value as ReviewStrictness })} className={inpSm}><option value="light" className="bg-[#0d1322]">Light</option><option value="standard" className="bg-[#0d1322]">Standard</option><option value="strict" className="bg-[#0d1322]">Strict</option></select>
        <label className="flex items-center gap-1 text-white/60"><input type="checkbox" checked={rec.auto_merge} onChange={(e) => onAdjust({ auto_merge: e.target.checked })} /> auto-merge</label>
        {busy && <Loader2 className="size-3.5 animate-spin text-white/40" />}
      </div>

      {/* warnings */}
      {(validation?.errors?.length || rec.warnings.length) ? (
        <div className="space-y-1 rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3 text-xs">
          {validation?.errors?.map((e, i) => <p key={`e${i}`} className="flex items-center gap-1.5 text-red-300"><AlertTriangle className="size-3.5" /> {e}</p>)}
          {rec.warnings.map((w, i) => <p key={`w${i}`} className="flex items-center gap-1.5 text-amber-200/90"><AlertTriangle className="size-3.5" /> {w}</p>)}
        </div>
      ) : null}

      {/* team preview — agent cards */}
      <Panel icon={<Users className="size-4" />} title={`Team · ${activeMembers} members`}>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {rec.roles.map((r) => {
            const off = !r.agent_id || (r.agent_id && dropped.has(r.agent_id));
            return (
              <div key={r.role} className={`rounded-xl border p-2.5 ${off ? "border-white/5 bg-white/[0.01] opacity-50" : "border-white/10 bg-white/[0.03]"}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium capitalize text-white">{r.role}</span>
                  {r.role === rec.lead_role && <span className="rounded bg-indigo-500/20 px-1 text-[9px] uppercase text-indigo-300">lead</span>}
                  {r.blocking && <span className="rounded bg-red-500/15 px-1 text-[9px] uppercase text-red-300">blocking</span>}
                  <span className={`ml-auto text-[10px] uppercase ${AUT_TONE[r.autonomy]}`}>{r.autonomy}</span>
                  {r.agent_id && <input type="checkbox" checked={!dropped.has(r.agent_id)} onChange={() => toggleMember(r.agent_id!)} title="include in team" />}
                </div>
                <p className="text-[11px] text-white/40">{r.agent_name ?? <span className="text-red-300/70">no enabled agent</span>}</p>
                {r.skills.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{r.skills.map((s) => <span key={s.id} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/55">{s.name}</span>)}</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Panel icon={<GitBranch className="size-4" />} title="Workflows">
          <ul className="space-y-1 text-xs text-white/70">{rec.workflows.map((w) => <li key={w.id}>• {w.name}</li>)}</ul>
        </Panel>
        <Panel icon={<ShieldCheck className="size-4" />} title="Risk & safety">
          <ul className="space-y-0.5 text-xs text-white/60">
            <li>Risk: <span className={`capitalize ${RISK_TONE[rec.risk_level]}`}>{rec.risk_level}</span></li>
            <li>Safety mode: <span className="capitalize text-white/80">{rec.safety_mode}</span></li>
            <li>Approval: <span className="text-white/80">{rec.approval_policy.mode}</span>, {rec.approval_policy.required_reviews} review(s)</li>
            <li>Auto-merge: <span className={rec.auto_merge ? "text-amber-300" : "text-emerald-300"}>{rec.auto_merge ? "on (low-risk only)" : "off"}</span></li>
            {rec.review_rules.blocking_roles.length > 0 && <li>Blocking: {rec.review_rules.blocking_roles.join(", ")}</li>}
          </ul>
        </Panel>
        <Panel icon={<Gauge className="size-4" />} title="Budget (estimate)">
          <ul className="space-y-0.5 text-xs text-white/60">
            <li>Team / day: <span className="tabular-nums text-white/80">{(rec.budget.daily_token_budget ?? 0).toLocaleString()}</span> tok</li>
            <li>Per agent: <span className="tabular-nums text-white/80">{rec.budget.per_agent_tokens.toLocaleString()}</span> tok · warn {rec.budget.warning_pct}%</li>
            {rec.budget.cheap_mode && <li className="text-white/50">cheap mode on</li>}
            {rec.budget.high_effort_mode && <li className="text-white/50">high-effort mode on</li>}
          </ul>
        </Panel>
        <Panel icon={<Smartphone className="size-4" />} title="Updates & phone">
          <ul className="space-y-0.5 text-xs text-white/60">
            <li>Updates: <span className="capitalize text-white/80">{rec.update_frequency}</span></li>
            <li>Phone: {rec.phone.updates ? <span className="text-emerald-300">on</span> : <span className="text-white/40">off</span>}</li>
            {rec.phone.commands.length > 0 && <li className="text-white/45">cmds: {rec.phone.commands.join(", ")}</li>}
          </ul>
        </Panel>
      </div>

      <Panel icon={<Brain className="size-4" />} title="Suggested knowledge sources">
        <div className="flex flex-wrap gap-1">{rec.knowledge_sources.map((k, i) => <span key={i} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-white/55">{k}</span>)}</div>
      </Panel>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-sm text-white/60 hover:bg-white/5"><ArrowLeft className="size-4" /> Back</button>
        <div className="flex gap-2">
          <button disabled={busy || !!validation?.errors?.length} onClick={() => onCreate(true)} className="rounded-lg border border-white/15 px-3 py-2 text-sm text-white/75 hover:bg-white/5 disabled:opacity-40">Save as template</button>
          <button disabled={busy || !!validation?.errors?.length || activeMembers === 0} onClick={() => onCreate(false)} className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">{busy ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Create team</button>
        </div>
      </div>
    </div>
  );
}

const inp = "mt-1 h-10 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white placeholder:text-white/30 outline-none focus:border-emerald-500/40";
const inpSm = "h-7 rounded-lg border border-white/10 bg-white/5 px-2 text-xs text-white outline-none";
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="text-xs text-white/50">{label}</span>{children}</label>; }
function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <label className="flex items-center gap-2 text-sm text-white/70"><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}{hint && <span className="text-[10px] text-white/30">({hint})</span>}</label>;
}
function Panel({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-white/45">{icon} {title}</p>{children}</section>;
}
