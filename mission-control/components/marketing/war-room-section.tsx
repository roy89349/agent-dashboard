// WarRoomSection — large 3D war-room mockup: health tiles, agent grid, live event timeline.
// Server component; tilt/float are CSS-only and flatten on mobile/reduced-motion.
import { Radar, Activity, OctagonAlert, GitPullRequestArrow, ArrowRight } from "lucide-react";
import {
  SectionHeader,
  GlassOrbBackground,
  FloatingBadge,
  GlassButton,
  ExampleChip,
} from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

const HEALTH_TILES = [
  { label: "Workers", value: "12", tone: "text-white" },
  { label: "Decisions", value: "2", tone: "text-amber-300" },
  { label: "Workflows", value: "4", tone: "text-white" },
  { label: "Blockers", value: "1", tone: "text-red-400" },
  { label: "PRs", value: "7", tone: "text-emerald-300" },
  { label: "Breaker", value: "OK", tone: "text-emerald-300" },
];

const AGENTS = [
  { name: "frontend-01", task: "Building checkout UI", dot: "bg-emerald-400", glow: "shadow-[0_0_8px] shadow-emerald-400/60" },
  { name: "backend-02", task: "Writing API tests", dot: "bg-emerald-400", glow: "shadow-[0_0_8px] shadow-emerald-400/60" },
  { name: "qa-01", task: "Verifying PR #84", dot: "bg-emerald-400", glow: "shadow-[0_0_8px] shadow-emerald-400/60" },
  { name: "security-01", task: "Waiting on approval", dot: "bg-amber-400", glow: "shadow-[0_0_8px] shadow-amber-400/60" },
  { name: "infra-01", task: "Blocked · migration", dot: "bg-red-500", glow: "shadow-[0_0_8px] shadow-red-500/60" },
  { name: "docs-01", task: "Idle", dot: "bg-white/30", glow: "" },
];

const EVENTS = [
  { dot: "bg-emerald-400", text: "backend-02 opened PR #86 — payment webhooks" },
  { dot: "bg-amber-400", text: "Decision requested: deploy checkout to production" },
  { dot: "bg-red-500", text: "Blocker raised: staging migration failing" },
  { dot: "bg-indigo-400", text: "Workflow “Checkout v2” advanced to QA" },
  { dot: "bg-white/35", text: "Context compiled for qa-01 — 12.4k → 3.1k tokens" },
];

export function WarRoomSection() {
  return (
    <section id="war-room" className="mk-section relative">
      <GlassOrbBackground variant="emerald" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="Total overview"
          title="One room. The whole floor."
          subtitle="Every agent, blocker, workflow and pull request in one live command room — so nothing ships, stalls or waits without you knowing."
        />

        <div className="grid items-center gap-12 lg:grid-cols-[1.55fr_1fr] lg:gap-14">
          {/* ── 3D mockup ── */}
          <div className="mk-scene relative">
            <FloatingBadge className="-top-7 right-2 hidden sm:flex mk-float">
              <span className="size-2 rounded-full bg-amber-400 shadow-[0_0_10px] shadow-amber-400/60" />
              Decisions waiting for you
            </FloatingBadge>

            <div aria-hidden className="mk-tilt mk-3d mk-glass p-4 sm:p-6">
              {/* panel header */}
              <div className="flex items-center gap-2">
                <Radar className="size-3.5 text-emerald-300" />
                <span className="text-[11px] font-semibold tracking-tight text-white/85">War Room</span>
                <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-0.5 text-[9px] font-medium text-emerald-300">
                  <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px] shadow-emerald-400/60" /> Live
                </span>
                <ExampleChip size="sm" />
              </div>

              {/* health tile strip */}
              <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {HEALTH_TILES.map((t) => (
                  <div
                    key={t.label}
                    className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-2 py-2 text-center shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]"
                  >
                    <p className={cn("text-sm font-semibold tracking-tight", t.tone)}>{t.value}</p>
                    <p className="mt-0.5 text-[8px] font-medium uppercase tracking-wider text-white/35">{t.label}</p>
                  </div>
                ))}
              </div>

              {/* body: agent grid + event timeline */}
              <div className="mt-3 grid gap-3 sm:grid-cols-[1.5fr_1fr]">
                {/* agent grid */}
                <div className="glass-inset !rounded-xl p-3">
                  <p className="mb-2 text-[8px] font-semibold uppercase tracking-wider text-white/35">Agents</p>
                  <div className="grid grid-cols-2 gap-2">
                    {AGENTS.map((a) => (
                      <div
                        key={a.name}
                        className="rounded-lg border border-white/[0.07] bg-white/[0.04] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className={cn("size-1.5 shrink-0 rounded-full", a.dot, a.glow)} />
                          <span className="truncate font-mono text-[9px] font-medium text-white/80">{a.name}</span>
                        </div>
                        <p className="mt-1 truncate pl-3 text-[8.5px] text-white/40">{a.task}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* event timeline */}
                <div className="glass-inset !rounded-xl p-3">
                  <p className="mb-2 text-[8px] font-semibold uppercase tracking-wider text-white/35">Events</p>
                  <div className="flex flex-col gap-2">
                    {EVENTS.map((e) => (
                      <div key={e.text} className="flex gap-2">
                        <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", e.dot)} />
                        <p className="text-[9px] leading-snug text-white/55">{e.text}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ── copy ── */}
          <div>
            <h3 className="text-xl font-semibold tracking-tight text-white sm:text-2xl">
              See everything. Chase nothing.
            </h3>
            <p className="mt-4 text-base leading-relaxed text-white/55">
              The war room is the live nerve center of your fleet. Health tiles give you the state of
              the floor at a glance, every agent reports what it is doing right now, and the event
              stream turns raw activity into a clean, severity-ranked timeline.
            </p>
            <ul className="mt-6 flex flex-col gap-3.5">
              <li className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300">
                  <Activity className="size-3.5" />
                </span>
                <span className="text-sm leading-relaxed text-white/65">
                  Live status for every agent — working, waiting, blocked or idle.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-300">
                  <OctagonAlert className="size-3.5" />
                </span>
                <span className="text-sm leading-relaxed text-white/65">
                  Blockers and waiting decisions surface instantly instead of hiding in logs.
                </span>
              </li>
              <li className="flex items-start gap-3">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-indigo-400/20 bg-indigo-400/10 text-indigo-300">
                  <GitPullRequestArrow className="size-3.5" />
                </span>
                <span className="text-sm leading-relaxed text-white/65">
                  Jump from any event straight to the workflow, agent or PR behind it.
                </span>
              </li>
            </ul>
            <div className="mt-8">
              <GlassButton href="/" variant="glass">
                Open Dashboard <ArrowRight className="size-4" />
              </GlassButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
