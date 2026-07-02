import { Radio, Signal } from "lucide-react";
import { SectionHeader, Pill, GlassOrbBackground, ExampleChip } from "@/components/marketing/shared";
import { cn } from "@/lib/utils";

/* Phone Control — a generic dark chat UI inside a CSS-only glass phone (no messenger branding).
   Server component; tilt/float are mk- classes. Mockup is decorative → aria-hidden. */

/* single source for the command pills: rendered absolutely on desktop, in-flow on mobile */
const COMMANDS: { cmd: string; className: string }[] = [
  { cmd: "/status", className: "mk-float left-0 top-[14%]" },
  { cmd: "/task Build settings page", className: "mk-float-slow right-0 top-[26%]" },
  { cmd: "/approve 42", className: "mk-float mk-float-delay left-2 top-[52%]" },
  { cmd: "/logs backend", className: "mk-float-slow mk-float-delay right-4 top-[64%]" },
  { cmd: "/pause", className: "mk-float left-6 top-[84%]" },
];

function UserBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[80%] rounded-2xl rounded-br-md bg-emerald-400/15 px-3 py-1.5 font-mono text-[11px] text-emerald-100">
        {children}
      </p>
    </div>
  );
}

function FleetCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className="flex justify-start">
      <div
        className={`max-w-[85%] rounded-2xl rounded-bl-md border border-white/10 bg-white/[0.06] px-3 py-2 ${className ?? ""}`}
      >
        {children}
      </div>
    </div>
  );
}

export function PhoneControlSection() {
  return (
    <section id="phone" className="mk-section relative">
      <GlassOrbBackground variant="indigo" />
      <div className="mx-auto max-w-6xl">
        <SectionHeader
          eyebrow="Command from anywhere"
          title="Control the fleet from your phone"
          subtitle="You don't need to be at your laptop to keep agents moving. Mission Control turns your phone into the command line for your AI team."
        />

        <div className="relative mx-auto max-w-3xl">
          {/* floating command pills (desktop ornaments) */}
          <div aria-hidden className="pointer-events-none absolute inset-0 z-20 hidden lg:block">
            {COMMANDS.map(({ cmd, className }) => (
              <Pill key={cmd} className={cn("absolute font-mono", className)}>
                {cmd}
              </Pill>
            ))}
          </div>

          {/* the phone */}
          <div className="mk-scene flex justify-center">
            <div aria-hidden className="mk-tilt-r mk-3d mk-glass w-72 !rounded-[2.5rem] p-2">
              <div className="relative overflow-hidden rounded-[2.1rem] border border-white/[0.08] bg-[var(--bg-elev)]">
                {/* notch */}
                <div className="absolute inset-x-0 top-2 z-10 flex justify-center">
                  <div className="h-5 w-24 rounded-full bg-black/80 ring-1 ring-white/10" />
                </div>

                {/* chat header */}
                <div className="flex items-center gap-2 border-b border-white/[0.07] bg-white/[0.03] px-4 pb-3 pt-9">
                  <span className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 text-black">
                    <Radio className="size-3.5" />
                  </span>
                  <div>
                    <p className="text-[11px] font-semibold text-white">Mission Control</p>
                    <p className="flex items-center gap-1 text-[9px] text-emerald-300/80">
                      <span className="size-1.5 rounded-full bg-emerald-400" /> fleet online
                    </p>
                  </div>
                  <ExampleChip size="sm" className="ml-auto" />
                  <Signal className="size-3.5 text-white/30" />
                </div>

                {/* conversation */}
                <div className="space-y-2.5 px-3 py-4">
                  <UserBubble>/status</UserBubble>

                  <FleetCard>
                    <p className="text-[10px] font-semibold text-white/85">Fleet status</p>
                    <p className="mt-0.5 text-[10px] text-white/55">3 agents working · 1 PR ready</p>
                    <div className="mt-1.5 flex gap-1">
                      <span className="h-1 w-10 rounded-full bg-emerald-400/50" />
                      <span className="h-1 w-6 rounded-full bg-indigo-400/50" />
                      <span className="h-1 w-4 rounded-full bg-white/15" />
                    </div>
                  </FleetCard>

                  <UserBubble>/task Build settings page</UserBubble>

                  <FleetCard className="!border-red-400/25 !bg-red-500/[0.08]">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold text-red-200">
                      <span className="size-1.5 rounded-full bg-red-400" /> Backend Agent is blocked
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/50">Waiting on a failing migration — needs a call.</p>
                  </FleetCard>

                  <FleetCard>
                    <p className="text-[10px] font-semibold text-white/85">Approve PR #42?</p>
                    <p className="mt-0.5 text-[10px] text-white/50">Settings page · 6 files · risk: low</p>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <span className="rounded-md bg-emerald-400 px-1.5 py-1 text-center text-[9px] font-semibold text-black">
                        Approve
                      </span>
                      <span className="rounded-md border border-red-400/40 bg-red-500/15 px-1.5 py-1 text-center text-[9px] font-semibold text-red-200">
                        Reject
                      </span>
                      <span className="rounded-md border border-white/12 bg-white/[0.05] px-1.5 py-1 text-center text-[9px] font-medium text-white/70">
                        More info
                      </span>
                      <span className="rounded-md border border-indigo-400/30 bg-indigo-500/10 px-1.5 py-1 text-center text-[9px] font-medium text-indigo-200">
                        Let manager decide
                      </span>
                    </div>
                  </FleetCard>

                  <FleetCard className="!border-amber-400/25 !bg-amber-500/[0.08]">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-200">
                      <span className="size-1.5 rounded-full bg-amber-400" /> Token budget warning
                    </p>
                    <p className="mt-0.5 text-[10px] text-white/50">Frontend Agent at 80% of run budget.</p>
                  </FleetCard>

                  <UserBubble>/pause</UserBubble>
                </div>

                {/* input bar */}
                <div className="border-t border-white/[0.07] px-3 py-2.5">
                  <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5">
                    <span className="font-mono text-[10px] text-white/35">/</span>
                    <span className="text-[10px] text-white/25">Message the fleet…</span>
                    <span className="ml-auto size-5 rounded-full bg-emerald-400/80" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* in-flow command pills (mobile/tablet fallback) */}
          <div className="mt-8 flex flex-wrap justify-center gap-2 lg:hidden">
            {COMMANDS.map(({ cmd }) => (
              <Pill key={cmd} className="font-mono">
                {cmd}
              </Pill>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
