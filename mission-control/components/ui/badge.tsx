import { cn } from "@/lib/utils";

// Canonical dark badge tones. Translucent fills + matching text/border — never solid light surfaces.
export type Tone = "emerald" | "red" | "amber" | "indigo" | "slate" | "teal" | "rose";

export const BADGE_TONE: Record<Tone, string> = {
  emerald: "border-emerald-500/30 bg-emerald-500/15 text-emerald-300",
  red: "border-red-500/30 bg-red-500/15 text-red-300",
  amber: "border-amber-500/30 bg-amber-500/15 text-amber-300",
  indigo: "border-indigo-500/30 bg-indigo-500/15 text-indigo-300",
  teal: "border-teal-500/30 bg-teal-500/15 text-teal-200",
  rose: "border-rose-500/30 bg-rose-500/15 text-rose-200",
  slate: "border-white/10 bg-white/5 text-white/55",
};

export function Badge({
  tone = "slate",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        BADGE_TONE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
