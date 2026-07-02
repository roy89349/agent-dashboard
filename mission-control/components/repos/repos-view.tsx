"use client";
// Multi-repo registry — the "Repositories" screen. Lists the resolved repos (the env-configured PRIMARY
// first, marked read-only, then the EXTRAS from control/repos.json) as liquid-glass cards, with an
// "Add repository" form, an enable toggle, and delete-with-confirm. Single-repo installs need ZERO config:
// with no extras the screen shows the primary + a "Single-repo mode" note. Everything the form sends is
// re-validated + clamped server-side (lib/repos.ts); CAS on rev guards concurrent writes.
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FolderGit2, Plus, Trash2, Pencil, RefreshCw, GitFork, FolderOpen, Coins, ShieldAlert, Cpu, GitPullRequest, BookOpen, Power, Lock,
} from "lucide-react";
import { PageHeader } from "@/components/ui/glass";
import { Badge, type Tone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useConfirm } from "@/components/ui/confirm";

type Overrides = {
  budget_mode: "economy" | "balanced" | "high_quality" | null;
  max_pr_per_day: number | null;
  risk_floor: "low" | "medium" | "high" | null;
  model: string | null;
};
type Repo = {
  id: string;
  name: string;
  repo: string;
  repo_dir: string;
  project_name: string;
  project_desc: string;
  green_cmd: string;
  label_ready: string;
  vault_dir: string;
  enabled: boolean;
  overrides: Overrides;
  primary?: boolean;
};

const BUDGET_MODES = ["economy", "balanced", "high_quality"] as const;
const RISK_FLOORS = ["low", "medium", "high"] as const;
const MODE_TONE: Record<string, Tone> = { economy: "teal", balanced: "emerald", high_quality: "indigo" };
const RISK_TONE: Record<string, Tone> = { low: "slate", medium: "amber", high: "rose" };

const inputCls =
  "mt-1 min-h-11 w-full rounded-lg border border-white/10 bg-white/[0.05] px-2.5 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/25 focus:border-emerald-500/40";

type FormState = {
  id: string;
  name: string;
  repo: string;
  repo_dir: string;
  project_name: string;
  project_desc: string;
  green_cmd: string;
  label_ready: string;
  vault_dir: string;
  budget_mode: string; // "" = inherit
  risk_floor: string; // "" = inherit
  max_pr_per_day: string; // "" = inherit
  model: string; // "" = inherit
};
const EMPTY_FORM: FormState = {
  id: "", name: "", repo: "", repo_dir: "", project_name: "", project_desc: "",
  green_cmd: "", label_ready: "", vault_dir: "",
  budget_mode: "", risk_floor: "", max_pr_per_day: "", model: "",
};

export function ReposView() {
  const confirm = useConfirm();
  const [repos, setRepos] = useState<Repo[] | null>(null); // resolved (primary + enabled)
  const [extras, setExtras] = useState<Repo[]>([]); // raw registry (includes disabled)
  const [rev, setRev] = useState(0);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [f, setF] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/repos", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        setRepos(j?.repos ?? []);
        setExtras(j?.extras ?? []);
        setRev(j?.rev ?? 0);
      })
      .catch(() => { setRepos([]); setExtras([]); })
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const primary = useMemo(() => (repos ?? []).find((r) => r.primary) ?? null, [repos]);

  function openAdd() {
    setEditingId(null);
    setF(EMPTY_FORM);
    setFormOpen(true);
  }
  function openEdit(r: Repo) {
    setEditingId(r.id);
    setF({
      id: r.id, name: r.name, repo: r.repo, repo_dir: r.repo_dir,
      project_name: r.project_name, project_desc: r.project_desc,
      green_cmd: r.green_cmd, label_ready: r.label_ready, vault_dir: r.vault_dir,
      budget_mode: r.overrides.budget_mode ?? "",
      risk_floor: r.overrides.risk_floor ?? "",
      max_pr_per_day: r.overrides.max_pr_per_day != null ? String(r.overrides.max_pr_per_day) : "",
      model: r.overrides.model ?? "",
    });
    setFormOpen(true);
  }

  async function save() {
    if (!f.id.trim() || !f.repo.trim() || !f.repo_dir.trim()) {
      toast.error("id, repo (owner/name) and repo_dir are required");
      return;
    }
    setBusy(true);
    try {
      const upsert = {
        id: f.id.trim(),
        name: f.name.trim(),
        repo: f.repo.trim(),
        repo_dir: f.repo_dir.trim(),
        project_name: f.project_name.trim(),
        project_desc: f.project_desc.trim(),
        green_cmd: f.green_cmd.trim(),
        label_ready: f.label_ready.trim(),
        vault_dir: f.vault_dir.trim(),
        overrides: {
          budget_mode: f.budget_mode || null,
          risk_floor: f.risk_floor || null,
          max_pr_per_day: f.max_pr_per_day.trim() === "" ? null : Number(f.max_pr_per_day),
          model: f.model.trim() || null,
        },
      };
      const r = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { upsert }, baseRev: rev }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast.error(j.error ?? "Save failed");
        if (r.status === 409) load(); // stale rev — reload
      } else {
        toast.success(editingId ? "Repository updated" : "Repository added");
        setFormOpen(false);
        setF(EMPTY_FORM);
        setEditingId(null);
        load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggle(r: Repo) {
    setBusy(true);
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: { upsert: { id: r.id, enabled: !r.enabled } }, baseRev: rev }),
      });
      if (res.ok) { toast.success(r.enabled ? `Disabled ${r.name}` : `Enabled ${r.name}`); load(); }
      else { const j = await res.json().catch(() => ({})); toast.error(j.error ?? "Failed"); if (res.status === 409) load(); }
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Repo) {
    const ok = await confirm({
      title: `Delete repository "${r.name}"?`,
      body: `The fleet stops building against ${r.repo}. This removes it from control/repos.json (the primary env repo is unaffected).`,
      tone: "danger",
      confirmLabel: "Delete",
      challenge: r.id,
    });
    if (!ok) return;
    const res = await fetch(`/api/repos?id=${encodeURIComponent(r.id)}`, { method: "DELETE" });
    if (res.ok) { toast.success(`Deleted ${r.name}`); load(); }
    else { const j = await res.json().catch(() => ({})); toast.error(j.error ?? "Delete failed"); }
  }

  const field = (k: keyof FormState, label: string, placeholder?: string, hint?: string) => (
    <label className="block text-xs text-white/50">
      {label}
      {hint && <span className="text-white/25"> · {hint}</span>}
      <input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder={placeholder} className={inputCls} />
    </label>
  );

  const enabledCount = extras.filter((r) => r.enabled).length;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">
      <PageHeader
        className="mb-5"
        title={
          <span className="inline-flex items-center gap-2.5">
            <span className="glass-card grid size-9 place-items-center rounded-xl text-emerald-300"><FolderGit2 className="size-[18px]" /></span>
            Repositories
          </span>
        }
        subtitle={
          loading
            ? "Loading the registry…"
            : `1 primary + ${extras.length} extra${extras.length === 1 ? "" : "s"} (${enabledCount} enabled) · run the fleet across projects — extras inherit the global defaults`
        }
        actions={
          <>
            <Button variant="outline" size="sm" className="h-10" onClick={load}>
              <RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button size="sm" className="h-10" onClick={() => (formOpen ? setFormOpen(false) : openAdd())}>
              <Plus className="size-4" /> {formOpen ? "Close" : "Add repository"}
            </Button>
          </>
        }
      />

      {/* ── add / edit form ── */}
      {formOpen && (
        <div className="glass-inset mb-5 space-y-3 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">
            {editingId ? `Edit repository · ${editingId}` : "Add a repository"}
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-xs text-white/50">
              Id <span className="text-white/25">· [a-z0-9-], unique, not &quot;primary&quot;</span>
              <input value={f.id} disabled={!!editingId} onChange={(e) => setF({ ...f, id: e.target.value })} placeholder="tapsafe" className={`${inputCls} ${editingId ? "opacity-50" : ""}`} />
            </label>
            {field("name", "Display name", "TapSafe")}
            {field("repo", "GitHub repo", "owner/name", "owner/name")}
            {field("repo_dir", "Clone dir", "/opt/fleet/clones/tapsafe", "absolute path on the fleet host")}
            {field("project_name", "Project name", "TapSafe")}
            {field("label_ready", "Ready label", "agent-ready", "empty = inherit LABEL_READY")}
            {field("green_cmd", "Green command", "npm run build", "empty = inherit GREEN_CMD")}
            {field("vault_dir", "Vault dir (optional)", "/path/to/vault")}
          </div>
          <label className="block text-xs text-white/50">
            Project description
            <textarea value={f.project_desc} onChange={(e) => setF({ ...f, project_desc: e.target.value })} placeholder="NL gezinsapp — Expo/RN" rows={2} className={`${inputCls} min-h-16 py-2`} />
          </label>

          <p className="pt-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/35">Overrides <span className="font-normal normal-case tracking-normal text-white/25">· all optional — empty = inherit the global default</span></p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="block text-xs text-white/50">
              Budget mode
              <select value={f.budget_mode} onChange={(e) => setF({ ...f, budget_mode: e.target.value })} className={inputCls}>
                <option value="" className="bg-[#0d1322]">inherit</option>
                {BUDGET_MODES.map((m) => <option key={m} value={m} className="bg-[#0d1322]">{m}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/50">
              Risk floor
              <select value={f.risk_floor} onChange={(e) => setF({ ...f, risk_floor: e.target.value })} className={inputCls}>
                <option value="" className="bg-[#0d1322]">inherit</option>
                {RISK_FLOORS.map((m) => <option key={m} value={m} className="bg-[#0d1322]">{m}</option>)}
              </select>
            </label>
            <label className="block text-xs text-white/50">
              Max PR/day
              <input type="number" min={1} value={f.max_pr_per_day} onChange={(e) => setF({ ...f, max_pr_per_day: e.target.value })} placeholder="inherit" className={inputCls} />
            </label>
            {field("model", "Model", "inherit")}
          </div>
          <p className="text-[11px] text-white/30">The primary repo comes from the server env and can&apos;t be edited here. Everything is validated + clamped server-side; secrets are never stored.</p>
          <div className="flex gap-2">
            <Button onClick={save} disabled={busy} variant="accent" className="min-h-11">{editingId ? "Save changes" : "Add repository"}</Button>
            <Button onClick={() => { setFormOpen(false); setEditingId(null); }} variant="ghost" className="min-h-11">Cancel</Button>
          </div>
        </div>
      )}

      {/* ── single-repo note ── */}
      {!loading && extras.length === 0 && !formOpen && (
        <div className="glass-inset mb-5 flex items-start gap-3 border-dashed p-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-300"><Lock className="size-[18px]" /></span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white/80">Single-repo mode — add a repo to run the fleet across projects</p>
            <p className="mt-0.5 text-xs text-white/40">Zero config required: the fleet builds against the primary repo from your server env. Adding an extra repo is entirely optional.</p>
          </div>
        </div>
      )}

      {/* ── cards ── */}
      {loading && !repos ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[0, 1].map((i) => <div key={i} className="glass-card h-40 animate-pulse" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {primary && <RepoCard repo={primary} isPrimary />}
          {extras.map((r) => (
            <RepoCard key={r.id} repo={r} onEdit={() => openEdit(r)} onToggle={() => toggle(r)} onDelete={() => remove(r)} busy={busy} />
          ))}
        </div>
      )}

      {!loading && !primary && extras.length === 0 && (
        <EmptyState icon={FolderGit2} title="No repositories" hint="Set REPO / REPO_DIR / PROJECT_NAME in the server env to configure the primary repo." tone="slate" />
      )}
    </div>
  );
}

function RepoCard({
  repo, isPrimary = false, onEdit, onToggle, onDelete, busy,
}: {
  repo: Repo;
  isPrimary?: boolean;
  onEdit?: () => void;
  onToggle?: () => void;
  onDelete?: () => void;
  busy?: boolean;
}) {
  const ov = repo.overrides;
  return (
    <div className={`glass-card flex flex-col p-4 ${repo.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${isPrimary ? "bg-indigo-500/15 text-indigo-300" : "bg-white/5 text-white/60"}`}>
          <FolderGit2 className="size-[18px]" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-white">{repo.name || repo.id}</p>
          <p className="truncate text-xs text-white/40">{repo.project_desc || repo.project_name || repo.id}</p>
        </div>
        {isPrimary ? (
          <Badge tone="indigo" className="shrink-0"><Lock className="size-3" /> primary · from config</Badge>
        ) : (
          <Badge tone={repo.enabled ? "emerald" : "slate"} className="shrink-0">{repo.enabled ? "enabled" : "disabled"}</Badge>
        )}
      </div>

      <div className="mt-3 space-y-1 text-[11px] text-white/50">
        <p className="flex items-center gap-1.5"><GitFork className="size-3 shrink-0 text-white/30" /> <span className="truncate">{repo.repo || "—"}</span></p>
        <p className="flex items-center gap-1.5"><FolderOpen className="size-3 shrink-0 text-white/30" /> <span className="truncate">{repo.repo_dir || "—"}</span></p>
        {repo.vault_dir && <p className="flex items-center gap-1.5"><BookOpen className="size-3 shrink-0 text-white/30" /> <span className="truncate">{repo.vault_dir}</span></p>}
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone={ov.budget_mode ? MODE_TONE[ov.budget_mode] : "slate"}><Coins className="size-3" /> {ov.budget_mode ?? "budget: inherit"}</Badge>
        <Badge tone={ov.risk_floor ? RISK_TONE[ov.risk_floor] : "slate"}><ShieldAlert className="size-3" /> {ov.risk_floor ? `risk ≥ ${ov.risk_floor}` : "risk: inherit"}</Badge>
        {ov.model && <Badge tone="indigo"><Cpu className="size-3" /> {ov.model}</Badge>}
        {ov.max_pr_per_day != null && <Badge tone="slate"><GitPullRequest className="size-3" /> {ov.max_pr_per_day}/day</Badge>}
        {repo.label_ready && <Badge tone="slate">{repo.label_ready}</Badge>}
      </div>

      {!isPrimary && (
        <div className="mt-auto flex items-center gap-1 pt-3">
          <button onClick={onToggle} disabled={busy} aria-label={repo.enabled ? "Disable" : "Enable"} className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs ${repo.enabled ? "text-white/60 hover:bg-white/10" : "text-emerald-300 hover:bg-emerald-500/10"}`}>
            <Power className="size-3.5" /> {repo.enabled ? "Disable" : "Enable"}
          </button>
          <button onClick={onEdit} aria-label={`Edit ${repo.id}`} className="ml-auto grid size-9 place-items-center rounded-lg text-white/40 hover:bg-white/10 hover:text-white"><Pencil className="size-4" /></button>
          <button onClick={onDelete} aria-label={`Delete ${repo.id}`} className="grid size-9 place-items-center rounded-lg text-red-300/60 hover:bg-red-500/10 hover:text-red-300"><Trash2 className="size-4" /></button>
        </div>
      )}
      {isPrimary && (
        <p className="mt-auto pt-3 text-[11px] text-white/30">Configured from the server env (REPO / REPO_DIR / PROJECT_NAME). Not editable here.</p>
      )}
    </div>
  );
}
