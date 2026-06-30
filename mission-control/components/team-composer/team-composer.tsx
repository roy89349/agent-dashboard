"use client";
// Team Composer root: switch/create teams, compose them on the canvas (desktop) or tree (mobile),
// configure via the tabbed side panel, add agents / build a recommended team, and Save with CAS.
// The working "draft" is edited locally; Save persists the whole team (one POST). Agent edits go to the
// shared registry on their own CAS. Conflicts surface a reload banner; nothing dangerous bypasses the server.
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Sparkles, Save, Trash2, Network, Copy, X } from "lucide-react";
import { useConfirm } from "@/components/ui/confirm";
import { EmptyState } from "@/components/ui/empty-state";
import { OrgCanvas } from "./org-canvas";
import { OrgTreeMobile } from "./org-tree-mobile";
import { SidePanel } from "./side-panel";
import { AddAgentDialog } from "./add-agent-dialog";
import { RecommendDialog } from "./recommend-dialog";
import { EDGE_STYLE } from "./edges";
import { useTeams } from "./use-teams";
import { EDGE_KINDS, type Team, type TeamInput, type EdgeKind } from "@/lib/types";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 64);
const clone = (t: Team): Team => JSON.parse(JSON.stringify(t));

function emptyTeam(id: string, name = "New team"): Team {
  return {
    id, name, description: "", enabled: true, is_template: false, lead: null, members: [],
    project_scope: { repos: [], paths: [] }, labels: [], edges: [], routing_rules: [],
    approval_policy: { mode: "manual", auto_approve_max_risk: null, blocking_roles: [], required_reviews: 0, auto_merge: false },
    budget_caps: { daily_token_budget: null, max_concurrency: null, max_pr_per_day: null, per_agent: {} },
    layout: {}, source_project_type: null, created_at: "", updated_at: "",
  };
}

export function TeamComposer() {
  const T = useTeams();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState<string>("__new__");
  const [draft, setDraft] = useState<Team>(() => emptyTeam("team-1"));
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<"agent" | "team" | "routing" | "approval" | "budget">("team");
  const [connectMode, setConnectMode] = useState(false);
  const [connectKind, setConnectKind] = useState<EdgeKind>("reports_to");
  const [addOpen, setAddOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const syncRef = useRef("");

  const stored = T.teams.find((t) => t.id === selectedId) ?? null;
  const dirty = !stored || JSON.stringify(stored) !== JSON.stringify(draft);

  // pick a first team once loaded
  useEffect(() => {
    if (T.loaded && selectedId === "__new__" && T.teams.length > 0 && syncRef.current === "") {
      const first = T.teams.find((t) => !t.is_template) ?? T.teams[0];
      setSelectedId(first.id);
      setDraft(clone(first));
      syncRef.current = `${first.id}:${T.teamsRev}`;
    }
  }, [T.loaded, T.teams, T.teamsRev, selectedId]);

  // after a save, re-sync the draft from the stored (server-normalized) team for the selected id
  useEffect(() => {
    if (selectedId === "__new__") return;
    const key = `${selectedId}:${T.teamsRev}`;
    if (syncRef.current === key) return;
    const s = T.teams.find((t) => t.id === selectedId);
    if (s) { setDraft(clone(s)); syncRef.current = key; }
  }, [T.teams, T.teamsRev, selectedId]);

  function selectTeam(id: string) {
    if (id === "__new__") {
      const base = slug(`team-${T.teams.length + 1}`);
      setSelectedId("__new__");
      setDraft(emptyTeam(uniqueId(base)));
      syncRef.current = "new";
    } else {
      const t = T.teams.find((x) => x.id === id);
      if (t) { setSelectedId(id); setDraft(clone(t)); syncRef.current = `${id}:${T.teamsRev}`; }
    }
    setSelectedAgent(null);
    setSelectedEdge(null);
    setConnectMode(false);
    closePanel();
  }
  // dirty-aware team switch (the dropdown / recommend) — doDelete calls selectTeam directly (no prompt).
  async function switchTeamGuarded(id: string) {
    if (dirty && !(await confirm({ title: `Discard unsaved changes to "${draft.name}"?`, tone: "danger", confirmLabel: "Discard" }))) return;
    selectTeam(id);
  }
  async function useRecommended(d: TeamInput) {
    if (dirty && !(await confirm({ title: `Discard unsaved changes to "${draft.name}"?`, tone: "danger", confirmLabel: "Discard" }))) return;
    const id = uniqueId(d.id ?? "team");
    setSelectedId("__new__");
    setDraft({ ...emptyTeam(id), ...d, id } as Team);
    setSelectedAgent(null);
    setSelectedEdge(null);
    syncRef.current = "new";
  }
  function uniqueId(base: string): string {
    let id = base, n = 2;
    while (T.teams.some((t) => t.id === id)) id = `${base}-${n++}`;
    return id;
  }

  // ── draft mutations ──
  const addMember = (id: string) => setDraft((d) => (d.members.includes(id) ? d : { ...d, members: [...d.members, id] }));
  const removeMember = (id: string) =>
    setDraft((d) => {
      const perAgent = Object.fromEntries(Object.entries(d.budget_caps.per_agent).filter(([k]) => k !== id));
      return {
        ...d, members: d.members.filter((m) => m !== id), lead: d.lead === id ? null : d.lead,
        edges: d.edges.filter((e) => e.from !== id && e.to !== id),
        layout: Object.fromEntries(Object.entries(d.layout).filter(([k]) => k !== id)),
        // keep the draft referentially valid so Save doesn't 400 on an orphaned reference
        routing_rules: d.routing_rules.filter((r) => r.assign_to !== id).map((r) => (r.fallback_to === id ? { ...r, fallback_to: null } : r)),
        budget_caps: { ...d.budget_caps, per_agent: perAgent },
      };
    });
  const setLead = (id: string) => setDraft((d) => ({ ...d, lead: id }));
  const moveNode = (id: string, x: number, y: number) => setDraft((d) => ({ ...d, layout: { ...d.layout, [id]: { x, y } } }));
  const autoLayout = () => setDraft((d) => ({ ...d, layout: {} }));
  const addEdge = (from: string, to: string) =>
    setDraft((d) => (d.edges.some((e) => e.from === from && e.to === to && e.kind === connectKind) ? d : { ...d, edges: [...d.edges, { from, to, kind: connectKind }] }));
  const deleteEdge = (i: number) => { setDraft((d) => ({ ...d, edges: d.edges.filter((_, j) => j !== i) })); setSelectedEdge(null); };
  const setEdgeKind = (i: number, kind: EdgeKind) => setDraft((d) => ({ ...d, edges: d.edges.map((e, j) => (j === i ? { ...e, kind } : e)) }));

  function openAgent(id: string) { setSelectedAgent(id); setSelectedEdge(null); setPanelTab("agent"); setPanelOpen(true); }
  function openTeamPanel(tab: typeof panelTab) { setSelectedAgent(null); setPanelTab(tab); setPanelOpen(true); }
  function closePanel() { setPanelOpen(false); }

  async function doSave(asTemplate = false) {
    const payload: TeamInput = asTemplate
      ? { ...draft, id: uniqueId(`${draft.id}-template`), name: `${draft.name} (template)`, is_template: true }
      : draft;
    const r = await T.saveTeam({ upsert: payload });
    if (r.ok) { setSelectedId(payload.id); syncRef.current = ""; toast.success(asTemplate ? "Saved as template" : "Team saved"); }
    else if (r.conflict) toast.error(r.error ?? "Reloaded — review and save again");
    else toast.error(r.error ?? "Save failed");
  }
  async function doDelete() {
    if (!stored) { selectTeam("__new__"); return; }
    if (await confirm({ title: `Delete team "${draft.name}"?`, tone: "danger", confirmLabel: "Delete" })) {
      const r = await T.saveTeam({ remove: stored.id });
      if (r.ok) { toast.success("Deleted"); syncRef.current = ""; selectTeam(T.teams.find((t) => t.id !== stored.id)?.id ?? "__new__"); }
      else toast.error(r.error ?? "Delete failed");
    }
  }

  const active = T.teams.filter((t) => !t.is_template);
  const templates = T.teams.filter((t) => t.is_template);

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] max-md:h-[calc(100dvh-8.5rem)] flex-col">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5">
        <Network className="size-4 shrink-0 text-emerald-300" />
        <select value={selectedId === "__new__" ? "__new__" : selectedId} onChange={(e) => switchTeamGuarded(e.target.value)} className="h-9 max-w-[42vw] rounded-lg border border-white/10 bg-white/5 px-2.5 text-sm text-white outline-none">
          <option value="__new__" className="bg-[#0d1322]">＋ New team</option>
          {active.length > 0 && <optgroup label="Teams">{active.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}</optgroup>}
          {templates.length > 0 && <optgroup label="Templates">{templates.map((t) => <option key={t.id} value={t.id} className="bg-[#0d1322]">{t.name}</option>)}</optgroup>}
        </select>
        {dirty && <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">unsaved</span>}

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <TbBtn onClick={() => setAddOpen(true)} icon={Plus} label="Add agent" />
          <TbBtn onClick={() => setRecOpen(true)} icon={Sparkles} label="Recommend" />
          <TbBtn onClick={() => openTeamPanel("team")} icon={Network} label="Settings" hideLabelMobile />
          <TbBtn onClick={() => doSave(true)} icon={Copy} label="Save as template" hideLabelMobile />
          {stored && <TbBtn onClick={doDelete} icon={Trash2} label="Delete" hideLabelMobile danger />}
          <button onClick={() => doSave(false)} disabled={!dirty} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-emerald-500 px-3 text-sm font-semibold text-black hover:bg-emerald-400 disabled:opacity-40">
            <Save className="size-4" /> Save
          </button>
        </div>
      </div>

      {/* connect-mode kind picker / edge actions */}
      {(connectMode || selectedEdge != null) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-black/20 px-3 py-2 text-xs">
          {connectMode && (
            <>
              <span className="text-white/45">New connection:</span>
              {EDGE_KINDS.map((k) => (
                <button key={k} onClick={() => setConnectKind(k)} className={`rounded-md px-2 py-1 capitalize ${connectKind === k ? "bg-white/15 text-white" : "text-white/50 hover:text-white/80"}`}>{EDGE_STYLE[k].label}</button>
              ))}
            </>
          )}
          {selectedEdge != null && draft.edges[selectedEdge] && (
            <div className="flex items-center gap-2">
              <span className="text-white/45">Edge {draft.edges[selectedEdge].from}→{draft.edges[selectedEdge].to}:</span>
              <select value={draft.edges[selectedEdge].kind} onChange={(e) => setEdgeKind(selectedEdge, e.target.value as EdgeKind)} className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-white">
                {EDGE_KINDS.map((k) => <option key={k} value={k} className="bg-[#0d1322]">{EDGE_STYLE[k].label}</option>)}
              </select>
              <button onClick={() => deleteEdge(selectedEdge)} className="inline-flex items-center gap-1 text-red-300 hover:text-red-200"><X className="size-3.5" /> delete</button>
            </div>
          )}
        </div>
      )}

      {/* canvas (desktop) / tree (mobile) */}
      <div className="min-h-0 flex-1">
        {!T.loaded ? (
          <div className="grid h-full place-items-center text-sm text-white/40">Loading…</div>
        ) : draft.members.length === 0 && selectedId === "__new__" && T.teams.length === 0 ? (
          <div className="grid h-full place-items-center p-4">
            <EmptyState icon={Network} title="No teams yet" hint="Add agents to compose a team, or build a recommended one for your project type." action={
              <button onClick={() => setRecOpen(true)} className="inline-flex h-10 items-center gap-2 rounded-xl bg-emerald-500 px-4 text-sm font-semibold text-black hover:bg-emerald-400"><Sparkles className="size-4" /> Build recommended team</button>
            } />
          </div>
        ) : (
          <>
            <div className="hidden h-full md:block">
              <OrgCanvas
                team={draft} agentById={T.agentById}
                selectedAgent={selectedAgent} onSelectAgent={openAgent}
                selectedEdge={selectedEdge} onSelectEdge={(i) => { setSelectedEdge(i); setConnectMode(false); }}
                connectMode={connectMode} onToggleConnect={() => { setConnectMode((v) => !v); setSelectedEdge(null); }}
                onConnect={addEdge} onMoveNode={moveNode} onAutoLayout={autoLayout}
              />
            </div>
            <div className="h-full overflow-y-auto md:hidden">
              <OrgTreeMobile team={draft} agentById={T.agentById} selectedAgent={selectedAgent} onSelectAgent={openAgent} />
            </div>
          </>
        )}
      </div>

      <SidePanel
        open={panelOpen} onClose={closePanel} tab={panelTab} setTab={setPanelTab}
        draft={draft} setDraft={setDraft} agents={T.agents}
        selectedAgent={selectedAgent ? T.agentById(selectedAgent) : null}
        saveAgent={T.saveAgent} allowAutoMerge={T.allowAutoMerge} allowGlobalOpus={T.allowGlobalOpus}
        onSetLead={setLead} onRemoveMember={(id) => { removeMember(id); closePanel(); }}
      />
      <AddAgentDialog open={addOpen} onClose={() => setAddOpen(false)} agents={T.agents} members={draft.members} saveAgent={T.saveAgent} onAddMember={addMember} />
      <RecommendDialog open={recOpen} onClose={() => setRecOpen(false)} onUse={useRecommended} />
    </div>
  );
}

function TbBtn({ onClick, icon: Icon, label, hideLabelMobile, danger }: { onClick: () => void; icon: React.ComponentType<{ className?: string }>; label: string; hideLabelMobile?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} className={`inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-sm hover:bg-white/5 ${danger ? "text-red-300" : "text-white/70"}`}>
      <Icon className="size-4" /> <span className={hideLabelMobile ? "hidden sm:inline" : ""}>{label}</span>
    </button>
  );
}
