import type { LucideIcon } from "lucide-react";

// Consistent dark empty state: a soft icon chip, a title, and an optional hint + action.
export function EmptyState({
  icon: Icon,
  title,
  hint,
  action,
  tone = "emerald",
}: {
  icon: LucideIcon;
  title: string;
  hint?: string;
  action?: React.ReactNode;
  tone?: "emerald" | "indigo" | "slate";
}) {
  const chip =
    tone === "indigo"
      ? "bg-indigo-500/10 text-indigo-300"
      : tone === "slate"
        ? "bg-white/5 text-white/40"
        : "bg-emerald-500/10 text-emerald-300";
  return (
    <div className="glass-inset flex flex-col items-center justify-center border-dashed px-4 py-14 text-center">
      <div className={`mb-3 grid size-12 place-items-center rounded-2xl ${chip}`}>
        <Icon className="size-6" />
      </div>
      <p className="text-sm font-medium text-white/80">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-white/40">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
