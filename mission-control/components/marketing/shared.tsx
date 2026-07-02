// Marketing design-system primitives (the /landing site). Liquid glass on the dashboard's tokens,
// one visual language for every section. All primitives are presentational server components —
// the interactive nav lives in components/marketing/nav.tsx.
import Link from "next/link";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── buttons ── */
export function GlassButton({
  href,
  variant = "glass",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: "accent" | "glass";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition-all duration-200",
        size === "lg" ? "h-13 px-7 text-base" : size === "sm" ? "h-9 px-4 text-[13px]" : "h-11 px-5 text-sm",
        variant === "accent"
          ? "bg-emerald-400 text-black shadow-[0_8px_30px_rgba(16,185,129,0.35)] hover:bg-emerald-300 hover:shadow-[0_10px_40px_rgba(16,185,129,0.45)]"
          : "mk-glass !rounded-xl text-white/90 hover:text-white hover:!border-white/25",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ── glass card ── */
export function LiquidGlassCard({
  className,
  lift = true,
  children,
}: {
  className?: string;
  lift?: boolean;
  children: React.ReactNode;
}) {
  return <div className={cn("mk-glass", lift && "mk-lift", className)}>{children}</div>;
}

/* ── small trust/feature pill ── */
export function Pill({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3.5 py-1.5 text-xs font-medium text-white/70 backdrop-blur-md",
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ── "Example" disclaimer chip — the one implementation for every illustrative number ── */
export function ExampleChip({ size = "md", className }: { size?: "sm" | "md"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-white/12 bg-white/[0.05] px-2 py-0.5 font-semibold uppercase tracking-wider text-white/50",
        size === "sm" ? "text-[8px]" : "text-[10px]",
        className,
      )}
    >
      Example
    </span>
  );
}

/* ── per-card accent tones — restricted to the shared palette (quiet, never neon) ── */
export const ACCENT_TONES = {
  emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300",
  indigo: "border-indigo-400/20 bg-indigo-400/10 text-indigo-300",
  violet: "border-violet-400/20 bg-violet-400/10 text-violet-300",
  amber: "border-amber-400/20 bg-amber-400/10 text-amber-300",
  red: "border-red-400/20 bg-red-500/10 text-red-300",
} as const;
export type AccentTone = keyof typeof ACCENT_TONES;

/* ── floating badge card (hero/mockup ornaments — always decorative) ── */
export function FloatingBadge({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "mk-glass pointer-events-none absolute z-20 flex items-center gap-2.5 !rounded-2xl px-4 py-3 text-sm text-white/85",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── section header ── */
export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  className,
}: {
  eyebrow?: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto mb-14 max-w-3xl text-center", className)}>
      {eyebrow && (
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300/80">{eyebrow}</p>
      )}
      <h2 className="text-3xl font-semibold tracking-tight text-white sm:text-4xl md:text-[2.75rem] md:leading-[1.15]">
        {title}
      </h2>
      {subtitle && <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-white/55 sm:text-lg">{subtitle}</p>}
    </div>
  );
}

/* ── ambient orb background (per-section, absolutely positioned) ── */
export function GlassOrbBackground({ variant = "hero" }: { variant?: "hero" | "emerald" | "indigo" | "violet" }) {
  return (
    <div aria-hidden className="absolute inset-0 -z-10 overflow-hidden">
      {variant === "hero" && (
        <>
          <div className="mk-orb left-[8%] top-[-10%] h-[34rem] w-[34rem] bg-indigo-600/30" />
          <div className="mk-orb right-[5%] top-[15%] h-[28rem] w-[28rem] bg-emerald-500/20 [animation-delay:-8s]" />
          <div className="mk-orb bottom-[-20%] left-[38%] h-[30rem] w-[30rem] bg-violet-600/20 [animation-delay:-16s]" />
        </>
      )}
      {variant === "emerald" && <div className="mk-orb left-[15%] top-[5%] h-[26rem] w-[26rem] bg-emerald-500/15" />}
      {variant === "indigo" && <div className="mk-orb right-[10%] top-[10%] h-[26rem] w-[26rem] bg-indigo-600/20" />}
      {variant === "violet" && <div className="mk-orb left-[40%] top-[20%] h-[26rem] w-[26rem] bg-violet-600/15" />}
    </div>
  );
}

/* ── footer ── */
export function MarketingFooter() {
  return (
    <footer className="border-t border-white/[0.07] px-6 py-14">
      <div className="mx-auto flex max-w-6xl flex-col gap-10 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 text-black">
              <Radio className="size-4" />
            </span>
            <span className="text-sm font-semibold text-white">Mission Control</span>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-white/55">
            The operating layer for AI agents — workflows, approvals, token optimization and phone
            control for autonomous production teams.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-10 text-sm sm:grid-cols-3">
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Product</p>
            <div className="flex flex-col gap-2">
              <Link href="/" className="text-white/60 hover:text-white">Dashboard</Link>
              <a href="#features" className="text-white/60 hover:text-white">Features</a>
              <a href="#tokens" className="text-white/60 hover:text-white">Token Optimization</a>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Trust</p>
            <div className="flex flex-col gap-2">
              <a href="#safety" className="text-white/60 hover:text-white">Safety</a>
              <a href="#phone" className="text-white/60 hover:text-white">Phone Control</a>
              <a href="#use-cases" className="text-white/60 hover:text-white">Use Cases</a>
            </div>
          </div>
          <div>
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-white/50">Operate</p>
            <div className="flex flex-col gap-2">
              <Link href="/" className="text-white/60 hover:text-white">Docs & Knowledge</Link>
              <Link href="/" className="text-white/60 hover:text-white">Config</Link>
            </div>
          </div>
        </div>
      </div>
      <p className="mx-auto mt-12 max-w-6xl text-xs text-white/50">
        Self-hosted · your keys never leave your server · © {new Date().getFullYear()} Mission Control
      </p>
    </footer>
  );
}
