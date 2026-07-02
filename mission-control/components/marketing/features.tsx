// FeaturesSection — bento grid of the ten core capabilities. Server component; all motion is CSS.
import {
  Play,
  Pause,
  RotateCw,
  Network,
  Workflow,
  Inbox,
  Smartphone,
  Radar,
  Gauge,
  ShieldCheck,
  BookOpen,
  ChartColumn,
  Check,
  X,
} from "lucide-react";
import {
  ACCENT_TONES,
  type AccentTone,
  ExampleChip,
  LiquidGlassCard,
  SectionHeader,
  GlassOrbBackground,
} from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

function FeatureCard({
  icon,
  tone,
  title,
  line,
  className,
  children,
}: {
  icon: React.ReactNode;
  tone: AccentTone;
  title: string;
  line: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <LiquidGlassCard className={cn("flex flex-col p-6", className)}>
      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl border", ACCENT_TONES[tone])}>{icon}</span>
      <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-white/55">{line}</p>
      {children}
    </LiquidGlassCard>
  );
}

/* ── mini mockups (pure divs, decorative) ── */

function CommandStripMock() {
  return (
    <div aria-hidden className="mt-auto pt-6">
      <div className="glass-inset !rounded-xl p-3.5 sm:p-4">
        {/* command strip */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/15 px-2 py-1 text-[9px] font-semibold text-emerald-300">
            <Play className="size-2.5" /> Start all
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-medium text-white/60">
            <Pause className="size-2.5" /> Pause
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-medium text-white/60">
            <RotateCw className="size-2.5" /> Restart
          </span>
          <span className="ml-auto flex items-center gap-1.5">
            <ExampleChip size="sm" />
            <span className="text-[9px] font-medium text-white/35">2 running · 1 paused</span>
          </span>
        </div>
        {/* agent rows */}
        <div className="mt-2.5 flex flex-col gap-1.5">
          {[
            { name: "frontend-01", pct: "w-3/4", dot: "bg-emerald-400", state: "working" },
            { name: "backend-02", pct: "w-1/2", dot: "bg-emerald-400", state: "working" },
            { name: "qa-01", pct: "w-1/4", dot: "bg-amber-400", state: "paused" },
          ].map((a) => (
            <div
              key={a.name}
              className="flex items-center gap-2.5 rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-1.5"
            >
              <span className={cn("size-1.5 shrink-0 rounded-full", a.dot)} />
              <span className="w-20 shrink-0 truncate font-mono text-[9px] text-white/75">{a.name}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                <span
                  className={cn("block h-full rounded-full bg-gradient-to-r from-emerald-400/70 to-emerald-300/40", a.pct)}
                />
              </span>
              <span className="shrink-0 text-[8px] uppercase tracking-wide text-white/35">{a.state}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function OrgChartMock() {
  return (
    <div aria-hidden className="mt-auto pt-6">
      <div className="glass-inset !rounded-xl p-4">
        <div className="flex flex-col items-center">
          {/* manager node */}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-400/25 bg-indigo-400/10 px-3 py-1.5 text-[9px] font-semibold text-indigo-200">
            <span className="size-1.5 rounded-full bg-indigo-400" /> Manager
          </span>
          <span className="h-3.5 w-px bg-white/15" />
          <span className="h-px w-[84%] bg-white/15" />
          {/* worker nodes */}
          <div className="flex w-[84%] items-start justify-between">
            {[
              { tag: "FE", dot: "bg-emerald-400" },
              { tag: "BE", dot: "bg-emerald-400" },
              { tag: "QA", dot: "bg-indigo-400" },
              { tag: "SEC", dot: "bg-amber-400" },
              { tag: "DOC", dot: "bg-violet-400" },
            ].map((n) => (
              <div key={n.tag} className="flex flex-col items-center">
                <span className="h-3.5 w-px bg-white/15" />
                <span className="grid size-9 place-items-center rounded-full border border-white/12 bg-white/[0.06] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
                  <span className="text-[8px] font-semibold text-white/75">{n.tag}</span>
                </span>
                <span className={cn("mt-1.5 size-1 rounded-full", n.dot)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StepperMock() {
  const steps = ["Plan", "Build", "Review", "Ship"];
  return (
    <div aria-hidden className="mt-auto pt-5">
      <div className="glass-inset !rounded-xl px-3.5 py-3">
        <div className="flex items-center">
          {steps.map((s, i) => (
            <div key={s} className={cn("flex items-center", i < steps.length - 1 && "flex-1")}>
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full border",
                  i < 2 && "border-emerald-400/40 bg-emerald-400/20 text-emerald-300",
                  i === 2 &&
                    "border-emerald-400/50 bg-white/[0.05] text-white/80 shadow-[0_0_10px] shadow-emerald-400/25",
                  i > 2 && "border-white/12 bg-white/[0.04] text-white/30",
                )}
              >
                {i < 2 ? <Check className="size-2.5" /> : <span className="size-1.5 rounded-full bg-current" />}
              </span>
              {i < steps.length - 1 && (
                <span className={cn("mx-1 h-px flex-1", i < 2 ? "bg-emerald-400/35" : "bg-white/12")} />
              )}
            </div>
          ))}
        </div>
        <div className="mt-2 flex justify-between text-[8px] font-medium uppercase tracking-wide text-white/35">
          {steps.map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ApprovalMock() {
  return (
    <div aria-hidden className="mt-auto pt-5">
      <div className="glass-inset !rounded-xl p-3.5">
        <div className="flex items-center gap-2">
          <span className="size-1.5 shrink-0 rounded-full bg-amber-400 shadow-[0_0_8px] shadow-amber-400/50" />
          <span className="truncate text-[10px] font-medium text-white/80">Merge PR #142 into main?</span>
          <ExampleChip size="sm" className="ml-auto shrink-0" />
        </div>
        <p className="mt-1 truncate pl-3.5 text-[9px] text-white/40">backend-02 · checkout API · 14 files</p>
        <div className="mt-2.5 flex gap-1.5 pl-3.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-400/25 bg-emerald-400/15 px-2 py-1 text-[9px] font-semibold text-emerald-300">
            <Check className="size-2.5" /> Approve
          </span>
          <span className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/[0.05] px-2 py-1 text-[9px] font-medium text-white/55">
            <X className="size-2.5" /> Reject
          </span>
        </div>
      </div>
    </div>
  );
}

/* ── section ── */

export function FeaturesSection() {
  return (
    <section id="features" className="mk-section relative">
      <GlassOrbBackground variant="indigo" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="The system"
          title="Everything an AI team needs to ship."
          subtitle="Ten capabilities, one operating layer — from composing the team to gating what reaches production."
        />

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-6">
          {/* large */}
          <FeatureCard
            className="md:col-span-2 lg:col-span-3"
            tone="emerald"
            icon={<Play className="size-5" />}
            title="Agent Fleet Control"
            line="Start, pause and monitor autonomous workers from one command strip."
          >
            <CommandStripMock />
          </FeatureCard>
          <FeatureCard
            className="md:col-span-2 lg:col-span-3"
            tone="indigo"
            icon={<Network className="size-5" />}
            title="Team Composer"
            line="Build teams with managers, frontend agents, backend agents, QA, security, docs, KPI and communication agents."
          >
            <OrgChartMock />
          </FeatureCard>

          {/* medium */}
          <FeatureCard
            className="lg:col-span-2"
            tone="violet"
            icon={<Workflow className="size-5" />}
            title="Workflow Engine"
            line="Turn big goals into structured multi-agent pipelines."
          >
            <StepperMock />
          </FeatureCard>
          <FeatureCard
            className="lg:col-span-2"
            tone="amber"
            icon={<Inbox className="size-5" />}
            title="Decision Inbox"
            line="Agents only interrupt you when a real decision is needed."
          >
            <ApprovalMock />
          </FeatureCard>
          <FeatureCard
            className="lg:col-span-2"
            tone="indigo"
            icon={<Smartphone className="size-5" />}
            title="Phone Command Interface"
            line="Send prompts, approve PRs and steer agents from your phone."
          />
          <FeatureCard
            className="lg:col-span-2"
            tone="emerald"
            icon={<Radar className="size-5" />}
            title="War Room"
            line="See every agent, blocker, workflow and PR in one live command room."
          />

          {/* small */}
          <FeatureCard
            className="lg:col-span-2"
            tone="violet"
            icon={<Gauge className="size-5" />}
            title="Token Optimization"
            line="Compile context, route models, compress prompts and track usage per agent."
          />
          <FeatureCard
            className="lg:col-span-2"
            tone="red"
            icon={<ShieldCheck className="size-5" />}
            title="Safety Gates"
            line="Autonomy levels, server-side approvals, audit logs and security checks."
          />
          <FeatureCard
            className="lg:col-span-3"
            tone="emerald"
            icon={<BookOpen className="size-5" />}
            title="Knowledge Vault"
            line="Give agents project rules, architecture notes and previous decisions."
          />
          <FeatureCard
            className="lg:col-span-3"
            tone="indigo"
            icon={<ChartColumn className="size-5" />}
            title="KPI & Costs"
            line="Track output, quality, costs, token usage and team performance."
          />
        </div>
      </div>
    </section>
  );
}
