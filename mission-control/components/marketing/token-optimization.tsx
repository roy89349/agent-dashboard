import { ArrowRight, BrainCircuit, Coins, Database, Gauge, Route, Zap } from "lucide-react";
import {
  SectionHeader,
  LiquidGlassCard,
  Pill,
  GlassOrbBackground,
  ExampleChip,
} from "@/components/marketing/shared";

/* Token Optimization — messy raw context → optimization engine → compact compiled package.
   Server component; all motion/tilt is CSS (mk- classes). Metrics are illustrative → "Example" chips. */

const SUBSYSTEMS = [
  "Context Compiler",
  "Budget Manager",
  "Model Router",
  "Prompt Compression",
  "Semantic Cache",
  "Token Ledger",
  "Quality Guardrails",
];

/* dull, oversized raw-context block for the messy left stack */
function RawBlock({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={`absolute rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 shadow-[0_10px_30px_rgba(0,0,0,0.35)] ${className ?? ""}`}
    >
      {label && <p className="text-[10px] font-medium text-white/40">{label}</p>}
      <div className="mt-1.5 space-y-1">
        <div className="h-1 w-full rounded-full bg-white/10" />
        <div className="h-1 w-4/5 rounded-full bg-white/10" />
        <div className="h-1 w-3/5 rounded-full bg-white/[0.07]" />
      </div>
    </div>
  );
}

/* compact bright block for the optimized right package */
function CompiledBlock({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-emerald-300/20 bg-emerald-400/[0.08] px-3 py-2">
      <p className="text-[10px] font-semibold text-emerald-200/90">{label}</p>
      <div className="mt-1.5 flex gap-1">
        <div className="h-1 w-8 rounded-full bg-emerald-300/40" />
        <div className="h-1 w-5 rounded-full bg-emerald-300/25" />
      </div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div aria-hidden className="flex items-center justify-center py-1 lg:py-0">
      <span className="grid size-9 rotate-90 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-emerald-300/80 shadow-[0_0_20px_rgba(16,185,129,0.15)] lg:rotate-0">
        <ArrowRight className="size-4" />
      </span>
    </div>
  );
}

const METRIC_CARDS = [
  {
    icon: Gauge,
    title: "Less wasted context",
    body: "The Context Compiler sends the task brief and the relevant diff — not the whole transcript.",
    chart: true,
  },
  {
    icon: Route,
    title: "Smart model routing",
    body: "Routine steps run on small, cheap models. Frontier models are reserved for the calls that need them.",
  },
  {
    icon: Database,
    title: "Cache-aware runs",
    body: "Stable prompt prefixes keep the semantic cache warm, so repeated work is never paid for twice.",
  },
  {
    icon: Coins,
    title: "Budget approvals",
    body: "Runs that hit their token ceiling pause and ask before spending more — no silent overruns.",
  },
];

export function TokenOptimizationSection() {
  return (
    <section id="tokens" className="mk-section relative">
      <GlassOrbBackground variant="emerald" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="Economics"
          title="Token optimization, built into the core."
          subtitle="Mission Control does not just run agents. It controls what they read, which model answers, and what each run can spend."
        />

        {/* ── 3D flow: raw mess → engine → compiled package ── */}
        <div className="mk-scene">
          <div
            aria-hidden
            className="mk-tilt mk-3d flex flex-col items-stretch gap-2 lg:flex-row lg:items-center lg:gap-3"
          >
            {/* LEFT — unmanaged context */}
            <div className="mk-glass flex-1 !rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/40">Unmanaged context</p>
                <span className="text-[10px] text-white/30">everything, every time</span>
              </div>
              <div className="relative mt-4 h-44">
                <RawBlock label="full logs" className="left-0 top-1 w-[62%] -rotate-3" />
                <RawBlock className="right-[6%] top-4 w-[48%] rotate-2 opacity-70" />
                <RawBlock label="old chats" className="left-[14%] top-14 w-[58%] rotate-1" />
                <RawBlock className="right-0 top-[4.5rem] w-[42%] -rotate-2 opacity-60" />
                <RawBlock label="entire files" className="bottom-1 left-[6%] w-[64%] rotate-[-2deg]" />
              </div>
            </div>

            <FlowArrow />

            {/* CENTER — optimization engine */}
            <div className="mk-glass mk-z-46 shrink-0 !rounded-2xl p-6 lg:w-64">
              <div className="relative mx-auto grid size-28 place-items-center">
                <span className="absolute inset-0 rounded-full border border-emerald-300/15" />
                <span className="absolute inset-3 rounded-full border border-emerald-300/25" />
                <span className="absolute inset-6 rounded-full border border-emerald-300/35" />
                <span className="grid size-12 place-items-center rounded-full bg-gradient-to-br from-emerald-400 to-indigo-500 text-black shadow-[0_0_35px] shadow-emerald-400/45">
                  <BrainCircuit className="size-6" />
                </span>
              </div>
              <p className="mt-4 text-center text-xs font-semibold text-white">Optimization Engine</p>
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                {["Context Compiler", "Model Router", "Compression", "Cache"].map((chip) => (
                  <span
                    key={chip}
                    className="rounded-full border border-emerald-300/20 bg-emerald-400/[0.07] px-2 py-0.5 text-[10px] font-medium text-emerald-200/80"
                  >
                    {chip}
                  </span>
                ))}
              </div>
            </div>

            <FlowArrow />

            {/* RIGHT — compiled context package */}
            <div className="mk-glass mk-z-24 flex-1 !rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-wider text-emerald-200/70">Compiled context</p>
                <span className="text-[10px] text-white/30">only what the task needs</span>
              </div>
              <div className="mx-auto mt-4 max-w-60 space-y-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 shadow-[0_0_30px_rgba(16,185,129,0.08)]">
                <CompiledBlock label="task brief" />
                <CompiledBlock label="constraints" />
                <CompiledBlock label="relevant diff" />
                <CompiledBlock label="memory" />
              </div>
            </div>
          </div>
        </div>

        {/* ── metric-ish cards (illustrative → Example chips) ── */}
        <div className="mt-14 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {METRIC_CARDS.map((card) => (
            <LiquidGlassCard key={card.title} className="p-6">
              <div className="flex items-start justify-between gap-2">
                <span className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300">
                  <card.icon className="size-4.5" />
                </span>
                <ExampleChip />
              </div>
              <h3 className="mt-3 text-sm font-semibold text-white">{card.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">{card.body}</p>
              {card.chart && (
                <div aria-hidden className="mt-4 flex items-end gap-3 border-t border-white/[0.07] pt-3">
                  <div className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-16 w-full items-end justify-center">
                      <div className="h-full w-6 rounded-t bg-white/12" />
                    </div>
                    <span className="text-[10px] text-white/35">raw</span>
                  </div>
                  <div className="flex flex-1 flex-col items-center gap-1">
                    <div className="flex h-16 w-full items-end justify-center">
                      <div className="h-[30%] w-6 rounded-t bg-emerald-400/70 shadow-[0_0_14px_rgba(16,185,129,0.35)]" />
                    </div>
                    <span className="text-[10px] text-white/35">compiled</span>
                  </div>
                </div>
              )}
            </LiquidGlassCard>
          ))}
        </div>

        {/* ── the seven subsystems ── */}
        <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
          {SUBSYSTEMS.map((name) => (
            <Pill key={name}>
              <Zap aria-hidden className="size-3 text-emerald-300/70" />
              {name}
            </Pill>
          ))}
        </div>
      </div>
    </section>
  );
}
