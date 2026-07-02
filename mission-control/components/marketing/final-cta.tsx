import { ArrowRight, Lock, ShieldCheck, Smartphone } from "lucide-react";
import { SectionHeader, GlassButton, Pill, GlassOrbBackground } from "@/components/marketing/shared";

/* Final CTA — one big glass panel, orbs behind and inside, two clear actions. */

export function FinalCTASection() {
  return (
    <section id="cta" className="mk-section relative">
      <GlassOrbBackground variant="hero" />
      <div className="mx-auto max-w-4xl">
        <div className="mk-glass relative overflow-hidden px-6 py-16 text-center sm:px-12 sm:py-20">
          {/* inner ambience */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="mk-orb left-[-15%] top-[-40%] h-72 w-72 bg-emerald-500/20" />
            <div className="mk-orb bottom-[-45%] right-[-10%] h-80 w-80 bg-indigo-600/25 [animation-delay:-12s]" />
          </div>

          <div className="relative">
            <SectionHeader
              className="mb-0 max-w-none"
              title={
                <>
                  Stop prompting. <span className="mk-grad-text">Start operating.</span>
                </>
              }
              subtitle="Turn AI agents into a managed production team with workflows, approvals, token optimization and phone control."
            />

            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <GlassButton href="/" variant="accent" size="lg">
                Open Dashboard <ArrowRight aria-hidden className="size-4.5" />
              </GlassButton>
              <GlassButton href="/" variant="glass" size="lg">
                Configure your AI team
              </GlassButton>
            </div>

            <div className="mt-10 flex flex-wrap items-center justify-center gap-2">
              <Pill>
                <Lock aria-hidden className="size-3 text-emerald-300/70" /> Self-hosted — your keys stay yours
              </Pill>
              <Pill>
                <ShieldCheck aria-hidden className="size-3 text-emerald-300/70" /> Approval-gated by default
              </Pill>
              <Pill>
                <Smartphone aria-hidden className="size-3 text-emerald-300/70" /> Runs while you are away
              </Pill>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
