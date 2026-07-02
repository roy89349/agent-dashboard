import {
  ClipboardList,
  ShieldCheck,
  SlidersHorizontal,
  ScanEye,
  ScrollText,
  Wallet,
  EyeOff,
  ServerOff,
} from "lucide-react";
import { SectionHeader, LiquidGlassCard, GlassOrbBackground } from "@/components/marketing/shared";

/* Safety — eight calm trust cards. Emerald/indigo accents alternate; no alarm colors. */

const SAFEGUARDS = [
  {
    icon: ClipboardList,
    title: "Plan-only mode",
    body: "Agents propose a full plan first — nothing executes until you approve it.",
    tone: "emerald",
  },
  {
    icon: ShieldCheck,
    title: "Approval gates",
    body: "Every risky action becomes a decision: merge, deploy, spend, delete.",
    tone: "indigo",
  },
  {
    icon: SlidersHorizontal,
    title: "Autonomy levels",
    body: "Dial each agent from suggest-only to fully autonomous — per agent, per project.",
    tone: "indigo",
  },
  {
    icon: ScanEye,
    title: "Security Agent",
    body: "A dedicated agent reviews every diff for secrets, injection paths and unsafe calls.",
    tone: "emerald",
  },
  {
    icon: ScrollText,
    title: "Audit Log",
    body: "Every action recorded — who, why, which approval, what risk.",
    tone: "emerald",
  },
  {
    icon: Wallet,
    title: "Budget limits",
    body: "Hard token ceilings per run, per agent, per day. Hitting one pauses the run.",
    tone: "indigo",
  },
  {
    icon: EyeOff,
    title: "Redacted phone messages",
    body: "Secrets and customer data are stripped before anything reaches your phone.",
    tone: "indigo",
  },
  {
    icon: ServerOff,
    title: "No shell-out from API",
    body: "The public API reads state and queues tasks — it can never touch a shell.",
    tone: "emerald",
  },
] as const;

const TONE = {
  emerald: "bg-emerald-400/10 text-emerald-300",
  indigo: "bg-indigo-400/10 text-indigo-300",
} as const;

export function SafetySection() {
  return (
    <section id="safety" className="mk-section relative">
      <GlassOrbBackground variant="emerald" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="Trust"
          title="Autonomous does not mean uncontrolled."
          subtitle="Every safeguard is a first-class feature, not an afterthought. You decide how much rope each agent gets."
        />

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SAFEGUARDS.map((item) => (
            <LiquidGlassCard key={item.title} className="p-6">
              <span className={`grid size-10 place-items-center rounded-xl ${TONE[item.tone]}`}>
                <item.icon aria-hidden className="size-5" />
              </span>
              <h3 className="mt-4 text-[15px] font-semibold text-white">{item.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-white/50">{item.body}</p>
            </LiquidGlassCard>
          ))}
        </div>
      </div>
    </section>
  );
}
