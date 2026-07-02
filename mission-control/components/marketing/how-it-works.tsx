// How it works — five numbered glass steps on a 3D rail (lg: 5-col grid on a gradient line;
// mobile: stacked with a left rail). Server component; CSS-only 3D and motion.
import {
  Users,
  Target,
  Network,
  Hammer,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { SectionHeader, LiquidGlassCard, GlassOrbBackground } from "@/components/marketing/shared";

type Step = {
  n: string;
  icon: LucideIcon;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    icon: Users,
    title: "Build your team",
    body: "Define roles, skills, budgets and autonomy levels. Your agents, your rules.",
  },
  {
    n: "02",
    icon: Target,
    title: "Give a goal",
    body: "One sentence — from the dashboard or your phone. That's the whole brief.",
  },
  {
    n: "03",
    icon: Network,
    title: "Agents plan",
    body: "The Manager decomposes the goal into safe, reviewable tasks with clear owners.",
  },
  {
    n: "04",
    icon: Hammer,
    title: "Agents build and review",
    body: "Workflows run; QA and security gates check every change before it moves on.",
  },
  {
    n: "05",
    icon: Rocket,
    title: "You approve and ship",
    body: "Decide from the dashboard or your phone. Ship, then track the results.",
  },
];

function NumberChip({ step }: { step: Step }) {
  return (
    <span className="mk-glass relative z-10 grid size-12 shrink-0 place-items-center !rounded-2xl">
      <span className="mk-grad-text text-base font-bold tracking-tight">{step.n}</span>
    </span>
  );
}

function StepCard({ step }: { step: Step }) {
  return (
    <LiquidGlassCard className="flex-1 p-5">
      <div className="flex items-center gap-2">
        <step.icon aria-hidden className="size-4 shrink-0 text-emerald-300/80" />
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-white/55">{step.body}</p>
    </LiquidGlassCard>
  );
}

export function HowItWorksSection() {
  return (
    <section id="how" className="mk-section relative overflow-x-clip">
      <GlassOrbBackground variant="indigo" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="How it works"
          title="From goal to shipped — in five steps."
          subtitle="A tight loop you can run from your desk or your pocket — and repeat for every goal."
        />

        {/* lg: 3D horizontal rail */}
        <div className="mk-scene hidden lg:block">
          <div className="mk-tilt mk-3d relative">
            <span
              aria-hidden
              className="absolute left-[8%] right-[8%] top-6 h-px bg-gradient-to-r from-emerald-400/0 via-emerald-400/45 to-indigo-400/0"
            />
            <ol className="grid grid-cols-5 gap-4">
              {STEPS.map((s) => (
                <li key={s.n} className="flex flex-col items-center gap-3">
                  <NumberChip step={s} />
                  <span aria-hidden className="h-4 w-px bg-gradient-to-b from-emerald-400/45 to-emerald-400/0" />
                  <StepCard step={s} />
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* mobile / tablet: stacked with a left rail */}
        <div className="relative lg:hidden">
          <span
            aria-hidden
            className="absolute bottom-8 left-6 top-8 w-px bg-gradient-to-b from-emerald-400/45 via-indigo-400/35 to-emerald-400/45"
          />
          <ol className="flex flex-col gap-6">
            {STEPS.map((s) => (
              <li key={s.n} className="flex items-start gap-4">
                <NumberChip step={s} />
                <StepCard step={s} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
