// Problem section — six pain points as calm, muted glass cards. Server component; CSS-only motion.
import {
  MessageSquareDashed,
  EyeOff,
  ShieldOff,
  Coins,
  Dices,
  PhoneOff,
  type LucideIcon,
} from "lucide-react";
import { SectionHeader, LiquidGlassCard, GlassOrbBackground } from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

type Pain = {
  icon: LucideIcon;
  tone: "red" | "amber";
  title: string;
  body: string;
};

const PAINS: Pain[] = [
  {
    icon: MessageSquareDashed,
    tone: "red",
    title: "Prompt chaos",
    body: "Every task starts from a blank prompt. Context gets retyped, rules get forgotten, results drift.",
  },
  {
    icon: EyeOff,
    tone: "amber",
    title: "No visibility",
    body: "Agents work in terminals and tabs. You find out what happened after it happened.",
  },
  {
    icon: ShieldOff,
    tone: "red",
    title: "No approval system",
    body: "Risky actions — deploys, deletes, spending — run on trust. There is no gate between idea and impact.",
  },
  {
    icon: Coins,
    tone: "amber",
    title: "Token costs explode",
    body: "Long contexts and retry loops burn budget silently. Nobody sees the bill until it lands.",
  },
  {
    icon: Dices,
    tone: "amber",
    title: "Quality is inconsistent",
    body: "One run ships clean code, the next skips the tests. Without review gates, output is a dice roll.",
  },
  {
    icon: PhoneOff,
    tone: "red",
    title: "No phone control",
    body: "Agents keep working when you leave your desk — and every decision waits until you are back.",
  },
];

const TONE = {
  red: "border-red-400/20 bg-red-500/10 text-red-300/90",
  amber: "border-amber-400/20 bg-amber-500/10 text-amber-300/90",
} as const;

export function ProblemSection() {
  return (
    <section id="problem" className="mk-section relative">
      <GlassOrbBackground variant="violet" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="The problem"
          title="AI agents are powerful. Managing them is the hard part."
          subtitle="Spinning up one agent takes a minute. Running a team of them in production — without chaos — is a different job entirely."
        />
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PAINS.map((p) => (
            <LiquidGlassCard key={p.title} className="p-6">
              <span
                aria-hidden
                className={cn(
                  "mb-4 inline-grid size-10 place-items-center rounded-xl border",
                  TONE[p.tone],
                )}
              >
                <p.icon className="size-5" />
              </span>
              <h3 className="text-base font-semibold text-white">{p.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{p.body}</p>
            </LiquidGlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
