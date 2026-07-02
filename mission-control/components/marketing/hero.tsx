// Hero — the flagship section of /landing. Server component: all motion is CSS (mk- classes).
import {
  ArrowRight,
  Bot,
  Check,
  Coins,
  GitPullRequest,
  Pause,
  Play,
  ShieldCheck,
  Smartphone,
  Workflow,
  X,
} from "lucide-react";
import { ExampleChip, FloatingBadge, GlassButton, GlassOrbBackground, Pill } from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

/* ── miniature dashboard data (pure abstract shapes; widths are literal Tailwind classes) ── */
const KANBAN: {
  name: string;
  count: number;
  cards: {
    title: string;
    sub: string;
    dot: string;
    progress?: string;
    chip?: { label: string; cls: string };
  }[];
}[] = [
  {
    name: "Backlog",
    count: 4,
    cards: [
      { title: "w-4/5", sub: "w-1/2", dot: "bg-white/30" },
      { title: "w-3/5", sub: "w-2/5", dot: "bg-white/30" },
      { title: "w-3/4", sub: "w-1/3", dot: "bg-white/30" },
    ],
  },
  {
    name: "Building",
    count: 2,
    cards: [
      { title: "w-3/4", sub: "w-3/5", dot: "bg-indigo-400", progress: "w-2/3" },
      { title: "w-3/5", sub: "w-2/5", dot: "bg-indigo-400", progress: "w-1/3" },
    ],
  },
  {
    name: "Review",
    count: 2,
    cards: [
      {
        title: "w-4/5",
        sub: "w-1/2",
        dot: "bg-amber-400",
        chip: { label: "review", cls: "bg-amber-400/15 text-amber-300" },
      },
      { title: "w-2/3", sub: "w-2/5", dot: "bg-white/30" },
    ],
  },
  {
    name: "Done",
    count: 3,
    cards: [
      {
        title: "w-3/4",
        sub: "w-1/2",
        dot: "bg-emerald-400",
        chip: { label: "PR ready", cls: "bg-emerald-400/15 text-emerald-300" },
      },
      { title: "w-3/5", sub: "w-1/3", dot: "bg-emerald-400" },
    ],
  },
];

const WAR_ROOM_TILES = [
  "bg-emerald-400",
  "bg-emerald-400",
  "bg-indigo-400",
  "bg-amber-400",
  "bg-emerald-400",
  "bg-white/30",
];

const COMMAND_STATS: [string, string][] = [
  ["6", "Agents"],
  ["3", "Running"],
  ["12", "Queue"],
];

const HERO_PILLS: { icon: React.ElementType; label: string }[] = [
  { icon: Bot, label: "24/7 Agents" },
  { icon: Smartphone, label: "Phone Approvals" },
  { icon: Coins, label: "Token Optimization" },
  { icon: ShieldCheck, label: "Safety Gates" },
  { icon: Workflow, label: "Workflow Engine" },
];

export function HeroSection() {
  return (
    <section id="hero" className="mk-section relative overflow-x-clip !pt-40">
      <GlassOrbBackground variant="hero" />

      <div className="mx-auto max-w-6xl">
        {/* ── headline block ── */}
        <div className="mx-auto max-w-3xl text-center">
          <Pill className="mb-7">
            <span aria-hidden className="size-1.5 rounded-full bg-emerald-400" />
            The operating layer for autonomous AI agents
          </Pill>

          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl lg:text-6xl lg:leading-[1.06]">
            Operate Your Own <span className="mk-grad-text">AI Production Team</span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">
            Mission Control turns autonomous AI agents into a managed, reviewable and
            token-optimized production system — controlled from your dashboard or your phone.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <GlassButton href="/" variant="accent" size="lg">
              Open Dashboard <ArrowRight className="size-4" />
            </GlassButton>
            <GlassButton href="#features" variant="glass" size="lg">
              Explore the System
            </GlassButton>
          </div>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-2">
            {HERO_PILLS.map(({ icon: Icon, label }) => (
              <Pill key={label}>
                <Icon aria-hidden className="size-3.5 text-emerald-300/80" />
                {label}
              </Pill>
            ))}
          </div>
        </div>

        {/* ── the big 3D dashboard mockup (decorative) ── */}
        <div aria-hidden className="relative mx-auto mt-16 max-w-4xl sm:mt-24">
          {/* grounded depth shadow */}
          <div className="absolute -bottom-12 left-1/2 h-20 w-[82%] -translate-x-1/2 rounded-[100%] bg-black/70 blur-3xl" />

          <div className="mk-scene">
            <div className="mk-tilt mk-3d relative">
              {/* orbiting badge: PR ready */}
              <div className="pointer-events-none absolute -right-6 -top-10 z-20 hidden lg:block [transform:translateZ(90px)]">
                <FloatingBadge className="static mk-float">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-400/15 text-emerald-300">
                    <GitPullRequest className="size-4" />
                  </span>
                  <span className="text-[13px] font-medium leading-tight">
                    PR #42 ready <span className="text-white/40">· review passed</span>
                  </span>
                </FloatingBadge>
              </div>

              {/* orbiting badge: token savings */}
              <div className="pointer-events-none absolute -left-8 top-1/3 z-20 hidden lg:block [transform:translateZ(70px)]">
                <FloatingBadge className="static mk-float-slow">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-indigo-400/15 text-indigo-300">
                    <Coins className="size-4" />
                  </span>
                  <span className="flex flex-col gap-1.5">
                    <span className="flex items-center gap-2 text-[13px] font-medium leading-none">
                      Token savings
                      <ExampleChip size="sm" />
                    </span>
                    <span className="h-1.5 w-28 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full w-[62%] rounded-full bg-gradient-to-r from-emerald-400 to-emerald-300" />
                    </span>
                  </span>
                </FloatingBadge>
              </div>

              {/* orbiting badge: phone approval */}
              <div className="pointer-events-none absolute -bottom-8 right-8 z-20 hidden lg:block [transform:translateZ(110px)]">
                <FloatingBadge className="static mk-float mk-float-delay">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-violet-400/15 text-violet-300">
                    <Smartphone className="size-4" />
                  </span>
                  <span className="flex flex-col gap-1.5">
                    <span className="text-[13px] font-medium leading-none">Approve from your phone?</span>
                    <span className="flex gap-1.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <Check className="size-2.5" /> Approve
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-white/55">
                        <X className="size-2.5" /> Reject
                      </span>
                    </span>
                  </span>
                </FloatingBadge>
              </div>

              {/* ── the panel ── */}
              <div className="mk-glass relative overflow-hidden">
                {/* window chrome */}
                <div className="flex items-center gap-1.5 border-b border-white/[0.07] px-4 py-2.5">
                  <span className="size-2.5 rounded-full bg-white/12" />
                  <span className="size-2.5 rounded-full bg-white/12" />
                  <span className="size-2.5 rounded-full bg-white/12" />
                  <span className="ml-3 text-[9px] font-medium tracking-wide text-white/35">
                    mission-control · fleet
                  </span>
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-emerald-400/10 px-2 py-0.5 text-[8px] font-semibold uppercase tracking-widest text-emerald-300">
                    <span className="size-1 rounded-full bg-emerald-400" /> Live
                  </span>
                  <ExampleChip size="sm" className="ml-1.5" />
                </div>

                <div className="flex">
                  {/* slim sidebar */}
                  <div className="hidden w-11 flex-col items-center gap-2 border-r border-white/[0.07] py-3 sm:flex">
                    <span className="mb-1 grid size-5 rounded-md bg-gradient-to-br from-emerald-400 to-indigo-500" />
                    {[true, false, false, false, false].map((active, i) => (
                      <span
                        key={i}
                        className={cn(
                          "grid size-6 place-items-center rounded-lg",
                          active ? "bg-emerald-400/15" : "bg-white/[0.04]",
                        )}
                      >
                        <span
                          className={cn("size-1.5 rounded-full", active ? "bg-emerald-300" : "bg-white/25")}
                        />
                      </span>
                    ))}
                    <span className="mt-auto size-5 rounded-full bg-white/10" />
                  </div>

                  {/* main column */}
                  <div className="flex-1 space-y-2.5 p-3">
                    {/* command strip */}
                    <div className="flex items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.03] px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/60" />
                        <span className="text-[9px] font-medium text-white/70">Fleet online</span>
                      </span>
                      <span className="hidden h-4 w-px bg-white/10 sm:block" />
                      <span className="hidden items-center gap-3 tabular-nums sm:flex">
                        {COMMAND_STATS.map(([value, label]) => (
                          <span key={label} className="flex items-baseline gap-1">
                            <span className="text-[10px] font-semibold text-white/85">{value}</span>
                            <span className="text-[8px] uppercase tracking-wide text-white/35">{label}</span>
                          </span>
                        ))}
                      </span>
                      <span className="ml-auto flex items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-400/15 px-2 py-1 text-[8px] font-semibold text-emerald-300">
                          <Play className="size-2" /> Start
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-1 text-[8px] font-semibold text-white/55">
                          <Pause className="size-2" /> Pause
                        </span>
                      </span>
                    </div>

                    {/* kanban */}
                    <div className="grid grid-cols-4 gap-2">
                      {KANBAN.map((col) => (
                        <div key={col.name} className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-1.5">
                          <div className="mb-1.5 flex items-center justify-between px-0.5">
                            <span className="text-[8px] font-semibold uppercase tracking-wider text-white/40">
                              {col.name}
                            </span>
                            <span className="text-[8px] tabular-nums text-white/30">{col.count}</span>
                          </div>
                          <div className="space-y-1.5">
                            {col.cards.map((c, i) => (
                              <div
                                key={i}
                                className="space-y-1 rounded-md border border-white/[0.07] bg-white/[0.04] p-1.5"
                              >
                                <div className={cn("h-1 rounded-full bg-white/25", c.title)} />
                                <div className={cn("h-1 rounded-full bg-white/10", c.sub)} />
                                {c.progress && (
                                  <div className="h-1 overflow-hidden rounded-full bg-white/10">
                                    <div className={cn("h-full rounded-full bg-indigo-400/80", c.progress)} />
                                  </div>
                                )}
                                <div className="flex items-center justify-between pt-0.5">
                                  <span className={cn("size-1.5 rounded-full", c.dot)} />
                                  {c.chip && (
                                    <span
                                      className={cn(
                                        "rounded-full px-1.5 py-px text-[8px] font-semibold leading-tight",
                                        c.chip.cls,
                                      )}
                                    >
                                      {c.chip.label}
                                    </span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* war-room strip */}
                    <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-white/[0.03] p-2">
                      <span className="hidden px-1 text-[8px] font-semibold uppercase tracking-widest text-white/35 sm:block">
                        War room
                      </span>
                      <div className="grid flex-1 grid-cols-6 gap-1.5">
                        {WAR_ROOM_TILES.map((tone, i) => (
                          <div
                            key={i}
                            className="flex flex-col gap-1 rounded-md border border-white/[0.06] bg-white/[0.03] p-1.5"
                          >
                            <div className="flex items-center gap-1">
                              <span className={cn("size-1 rounded-full", tone)} />
                              <span className="h-0.5 flex-1 rounded-full bg-white/15" />
                            </div>
                            <div className="h-0.5 w-2/3 rounded-full bg-white/10" />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
