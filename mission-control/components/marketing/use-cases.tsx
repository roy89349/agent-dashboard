// UseCasesSection — seven compact audience cards. Server component; hover motion is CSS (mk-lift).
import {
  Rocket,
  Briefcase,
  MoonStar,
  Wrench,
  Database,
  ShieldCheck,
  ClipboardList,
} from "lucide-react";
import {
  ACCENT_TONES,
  type AccentTone,
  LiquidGlassCard,
  SectionHeader,
  GlassOrbBackground,
} from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

const USE_CASES: { icon: typeof Rocket; tone: AccentTone; title: string; line: string }[] = [
  {
    icon: Rocket,
    tone: "emerald",
    title: "Solo founders",
    line: "Run a full product team without hiring one.",
  },
  {
    icon: Briefcase,
    tone: "indigo",
    title: "AI-native agencies",
    line: "Deliver client work with agent squads you control.",
  },
  {
    icon: MoonStar,
    tone: "violet",
    title: "SaaS builders",
    line: "Ship features while you sleep — review PRs in the morning.",
  },
  {
    icon: Wrench,
    tone: "amber",
    title: "Internal tool teams",
    line: "Automate the backlog nobody has time for.",
  },
  {
    icon: Database,
    tone: "indigo",
    title: "Data automation teams",
    line: "Pipelines with reviews, budgets and audit trails.",
  },
  {
    icon: ShieldCheck,
    tone: "red",
    title: "Code review & security teams",
    line: "Every change gated, every action logged.",
  },
  {
    icon: ClipboardList,
    tone: "emerald",
    title: "Product teams",
    line: "Turn specs into reviewed pull requests.",
  },
];

export function UseCasesSection() {
  return (
    <section id="use-cases" className="mk-section relative">
      <GlassOrbBackground variant="violet" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="Who it's for"
          title="Built for teams that ship."
          subtitle="If the backlog grows faster than the headcount, an accountable agent team closes the gap."
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {USE_CASES.map(({ icon: Icon, tone, title, line }) => (
            <LiquidGlassCard key={title} className="p-6">
              <span className={cn("grid size-10 place-items-center rounded-xl border", ACCENT_TONES[tone])}>
                <Icon className="size-5" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-white">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-white/55">{line}</p>
            </LiquidGlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
