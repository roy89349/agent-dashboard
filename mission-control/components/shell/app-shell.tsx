"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Cpu,
  MessagesSquare,
  BookOpen,
  Settings,
  Command as CommandIcon,
  Radio,
} from "lucide-react";
import { CommandPalette } from "./command-palette";
import { NewTaskDialog } from "@/components/new-task-dialog";
import type { FleetStatus } from "@/lib/types";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/workers", label: "Workers", icon: Cpu },
  { href: "/chats", label: "Conversations", icon: MessagesSquare },
  { href: "/kennis", label: "Knowledge", icon: BookOpen },
  { href: "/config", label: "Config", icon: Settings },
];

const TITLES: Record<string, string> = {
  "/": "Dashboard",
  "/workers": "Workers",
  "/chats": "Conversations",
  "/kennis": "Knowledge",
  "/config": "Config",
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [status, setStatus] = useState<FleetStatus | null>(null);

  // ⌘K / Ctrl-K → command palette
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // light status poll for the sidebar indicator
  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const r = await fetch("/api/fleet/status", { cache: "no-store" });
        if (r.ok && alive) setStatus((await r.json()).status);
      } catch {
        /* offline */
      }
    }
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const online = status?.online ?? false;
  const title = TITLES[pathname] ?? "Mission Control";

  return (
    <div className="flex min-h-dvh">
      {/* ── sidebar ── */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/10 bg-black/20 px-3 py-4 md:flex">
        <div className="flex items-center gap-2 px-2 pb-5">
          <div className="grid size-7 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 text-black">
            <Radio className="size-4" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">Mission Control</p>
            <p className="text-[10px] text-white/40">agent fleet</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                  active ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white/90"
                }`}
              >
                {active && <span className="absolute left-0 h-5 w-0.5 rounded-r bg-emerald-400" />}
                <Icon className="size-4" />
                {n.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mb-2 flex items-center gap-2 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/50 hover:bg-white/5"
        >
          <CommandIcon className="size-3.5" /> Commands
          <kbd className="ml-auto rounded border border-white/10 px-1 text-[10px]">⌘K</kbd>
        </button>

        <div className="flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-2 text-xs">
          <span className={`size-2 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
          <span className="text-white/60">
            {online ? "Fleet online" : "Fleet offline"}
          </span>
          {status && (
            <span className="ml-auto tabular-nums text-white/40">
              {status.slots.length}/{status.knobs.max_workers ?? "—"}
            </span>
          )}
        </div>
      </aside>

      {/* ── main ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-white/10 bg-[#080b14]/80 px-4 backdrop-blur">
          <h1 className="text-sm font-semibold">{title}</h1>
          {status?.pause_reason && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">
              {status.pause_reason}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2 py-1.5 text-xs text-white/50 hover:bg-white/5"
            >
              <CommandIcon className="size-3.5" /> <kbd className="text-[10px]">⌘K</kbd>
            </button>
            <NewTaskDialog />
          </div>
        </header>

        <main className="mc-fade-in min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}
