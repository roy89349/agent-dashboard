// Solution section — six one-line transformations + a 3D layered system diagram
// (User → Manager → Specialists → Gates → PR → Approval → Ship). Server component; CSS-only 3D.
import {
  ArrowRight,
  User,
  Crown,
  PanelsTopLeft,
  Database,
  FlaskConical,
  ShieldCheck,
  GitPullRequest,
  BadgeCheck,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import {
  SectionHeader,
  LiquidGlassCard,
  GlassOrbBackground,
  FloatingBadge,
} from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

/* ── copy ── */
const TRANSFORMS: { from: string; to: string }[] = [
  { from: "Agents", to: "Named roles" },
  { from: "Tasks", to: "Repeatable workflows" },
  { from: "Decisions", to: "Explicit approvals" },
  { from: "Costs", to: "Measurable budgets" },
  { from: "Your phone", to: "A command center" },
  { from: "Everything", to: "Auditable" },
];

/* ── diagram data ── */
type Tone = "emerald" | "indigo" | "amber" | "neutral";

const NODE_TONE: Record<Tone, string> = {
  emerald: "border-emerald-400/25 bg-emerald-500/10 text-emerald-200/95",
  indigo: "border-indigo-400/25 bg-indigo-500/10 text-indigo-200/95",
  amber: "border-amber-400/25 bg-amber-500/10 text-amber-200/95",
  neutral: "border-white/12 bg-white/[0.06] text-white/85",
};

function Node({
  icon: Icon,
  label,
  tone = "neutral",
  className,
}: {
  icon: LucideIcon;
  label: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-medium shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_6px_18px_rgba(0,0,0,0.35)] backdrop-blur-md",
        NODE_TONE[tone],
        className,
      )}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {label}
    </span>
  );
}

/* thin vertical gradient connector */
function VLine({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-5 w-px bg-gradient-to-b from-emerald-400/50 to-indigo-400/40", className)}
    />
  );
}

const SPECIALISTS = [
  { icon: PanelsTopLeft, label: "Frontend" },
  { icon: Database, label: "Backend" },
  { icon: FlaskConical, label: "QA" },
] as const;

const TAIL: { icon: LucideIcon; label: string; tone: Tone }[] = [
  { icon: ShieldCheck, label: "Review & Security Gates", tone: "amber" },
  { icon: GitPullRequest, label: "Pull Request", tone: "neutral" },
  { icon: BadgeCheck, label: "Your Approval", tone: "indigo" },
  { icon: Rocket, label: "Ship", tone: "emerald" },
];

/* desktop diagram: vertical flow, specialist row fans out */
function DiagramDesktop() {
  return (
    <div className="hidden flex-col items-center md:flex">
      <Node icon={User} label="You" tone="emerald" />
      <VLine />
      <Node icon={Crown} label="Manager Agent" tone="indigo" />
      <VLine />
      {/* fan-out: horizontal rail + three stubs down, chips, three stubs down + rail */}
      <div className="w-full max-w-md">
        <div aria-hidden className="relative h-px">
          <span className="absolute inset-y-0 left-[16.66%] right-[16.66%] bg-gradient-to-r from-indigo-400/0 via-indigo-400/45 to-indigo-400/0" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {SPECIALISTS.map((s) => (
            <div key={s.label} className="flex flex-col items-center">
              <VLine className="h-4" />
              <Node icon={s.icon} label={s.label} />
              <VLine className="h-4 bg-gradient-to-b from-indigo-400/40 to-emerald-400/45" />
            </div>
          ))}
        </div>
        <div aria-hidden className="relative h-px">
          <span className="absolute inset-y-0 left-[16.66%] right-[16.66%] bg-gradient-to-r from-emerald-400/0 via-emerald-400/45 to-emerald-400/0" />
        </div>
      </div>
      {TAIL.map((n) => (
        <div key={n.label} className="flex flex-col items-center">
          <VLine />
          <Node icon={n.icon} label={n.label} tone={n.tone} />
        </div>
      ))}
    </div>
  );
}

/* mobile diagram: simple stacked rail */
function DiagramMobile() {
  return (
    <div className="relative pl-7 md:hidden">
      <span
        aria-hidden
        className="absolute bottom-3 left-2 top-3 w-px bg-gradient-to-b from-emerald-400/50 via-indigo-400/40 to-emerald-400/50"
      />
      <div className="flex flex-col gap-4">
        {[
          { icon: User, label: "You", tone: "emerald" as Tone },
          { icon: Crown, label: "Manager Agent", tone: "indigo" as Tone },
        ].map((n) => (
          <div key={n.label} className="relative">
            <span aria-hidden className="absolute -left-[23px] top-1/2 size-2 -translate-y-1/2 rounded-full bg-emerald-400/70" />
            <Node icon={n.icon} label={n.label} tone={n.tone} />
          </div>
        ))}
        <div className="relative">
          <span aria-hidden className="absolute -left-[23px] top-4 size-2 rounded-full bg-indigo-400/70" />
          <div className="flex flex-wrap gap-2">
            {SPECIALISTS.map((s) => (
              <Node key={s.label} icon={s.icon} label={s.label} />
            ))}
          </div>
        </div>
        {TAIL.map((n) => (
          <div key={n.label} className="relative">
            <span aria-hidden className="absolute -left-[23px] top-1/2 size-2 -translate-y-1/2 rounded-full bg-emerald-400/70" />
            <Node icon={n.icon} label={n.label} tone={n.tone} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function SolutionSection() {
  return (
    <section id="product" className="mk-section relative overflow-x-clip">
      <GlassOrbBackground variant="emerald" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="The solution"
          title="Mission Control is the operating layer for AI agents."
          subtitle="One layer that turns loose agents into an accountable team — with roles, workflows, gates and a paper trail."
        />
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-14">
          {/* transformations */}
          <ul className="flex flex-col gap-3">
            {TRANSFORMS.map((t) => (
              <li
                key={t.from}
                className="glass-card flex items-center gap-3 px-4 py-3"
              >
                <span className="min-w-0 text-sm text-white/50">{t.from}</span>
                <ArrowRight aria-hidden className="size-4 shrink-0 text-emerald-300/80" />
                <span className="min-w-0 text-sm font-semibold text-white">{t.to}</span>
              </li>
            ))}
          </ul>

          {/* 3D system diagram */}
          <div className="mk-scene relative">
            <div className="mk-tilt-r mk-3d relative">
              <LiquidGlassCard lift={false} className="p-6 sm:p-8">
                <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.2em] text-white/50">
                  One goal, orchestrated end to end
                </p>
                <DiagramDesktop />
                <DiagramMobile />
              </LiquidGlassCard>
              <FloatingBadge className="mk-float -right-5 top-14 hidden sm:flex">
                <ShieldCheck aria-hidden className="size-4 text-amber-300/90" />
                <span className="text-xs">Gates before merge</span>
              </FloatingBadge>
              <FloatingBadge className="mk-float-slow mk-float-delay -left-6 bottom-16 hidden sm:flex">
                <BadgeCheck aria-hidden className="size-4 text-emerald-300/90" />
                <span className="text-xs">You hold the final call</span>
              </FloatingBadge>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
