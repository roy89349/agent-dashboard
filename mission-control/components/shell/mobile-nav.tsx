"use client";
// Mobile command center: a fixed bottom nav (phones only — md:hidden) plus a "More" bottom-sheet for
// the secondary destinations and fleet quick-actions. Desktop keeps the sidebar untouched.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {
  LayoutDashboard, Inbox, Radio, Users, MoreHorizontal,
  MessagesSquare, BookOpen, Settings, Smartphone, ListTodo,
  Play, Pause, Square, X,
} from "lucide-react";
import type { FleetStatus } from "@/lib/types";

const PRIMARY = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/approvals", label: "Decisions", icon: Inbox, badge: true },
  { href: "/workers", label: "War Room", icon: Radio },
  { href: "/agents", label: "Agents", icon: Users },
];

const MORE = [
  { href: "/", label: "Tasks", icon: ListTodo, hint: "the kanban board" },
  { href: "/chats", label: "Conversations", icon: MessagesSquare, hint: "orchestrator chat" },
  { href: "/kennis", label: "Knowledge", icon: BookOpen, hint: "Obsidian vault" },
  { href: "/config", label: "Config", icon: Settings, hint: "limits & integrations" },
  { href: "/config#phone", label: "Phone Command setup", icon: Smartphone, hint: "Telegram / WhatsApp" },
];

export function MobileNav({
  pending,
  status,
  onMode,
}: {
  pending: number;
  status: FleetStatus | null;
  onMode: (m: string) => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));
  const online = status?.online ?? false;
  const mode = status?.mode ?? "running";

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-white/10 bg-[#080b14]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {PRIMARY.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.href);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`relative flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors ${
                active ? "text-emerald-300" : "text-white/45"
              }`}
            >
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-b bg-emerald-400" />}
              <span className="relative">
                <Icon className="size-5" />
                {item.badge && pending > 0 && (
                  <span className="absolute -right-2 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-amber-500 px-1 text-[9px] font-bold text-black">
                    {pending > 9 ? "9+" : pending}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen(true)}
          className="flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-medium text-white/45"
        >
          <MoreHorizontal className="size-5" />
          More
        </button>
      </nav>

      {/* More bottom-sheet */}
      <Dialog.Root open={moreOpen} onOpenChange={setMoreOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm md:hidden" />
          <Dialog.Content className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl border-t border-white/10 bg-[#0d1322] pb-[env(safe-area-inset-bottom)] text-white [animation:mc-drawer-up_0.22s_ease-out] md:hidden">
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/15" />
            <div className="flex items-center justify-between px-5 py-3">
              <Dialog.Title className="text-sm font-semibold">Mission Control</Dialog.Title>
              <Dialog.Close className="rounded-lg p-1.5 text-white/40 hover:bg-white/10 hover:text-white">
                <X className="size-4" />
              </Dialog.Close>
            </div>

            {/* fleet quick actions */}
            <div className="mx-4 mb-3 rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="mb-2.5 flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-red-500"}`} />
                <span className="text-sm font-medium">Fleet {online ? "online" : "offline"}</span>
                {status?.pause_reason && (
                  <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[11px] text-amber-300">{status.pause_reason}</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <QuickMode label="Start" icon={Play} active={mode === "running"} tone="emerald" onClick={() => { onMode("running"); setMoreOpen(false); }} />
                <QuickMode label="Pause" icon={Pause} active={mode === "paused"} tone="amber" onClick={() => { onMode("paused"); setMoreOpen(false); }} />
                <QuickMode label="Stop" icon={Square} active={mode === "stopped"} tone="red" onClick={() => { onMode("stopped"); setMoreOpen(false); }} />
              </div>
            </div>

            <div className="overflow-y-auto px-3 pb-4">
              {MORE.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-white/5 text-white/60">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-medium">{item.label}</span>
                      {item.hint && <span className="block truncate text-xs text-white/35">{item.hint}</span>}
                    </span>
                  </Link>
                );
              })}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

function QuickMode({
  label, icon: Icon, active, tone, onClick,
}: {
  label: string; icon: React.ComponentType<{ className?: string }>; active: boolean;
  tone: "emerald" | "amber" | "red"; onClick: () => void;
}) {
  const on =
    tone === "emerald" ? "bg-emerald-500 text-black"
    : tone === "amber" ? "bg-amber-500 text-black"
    : "bg-red-500 text-white";
  return (
    <button
      onClick={onClick}
      className={`flex h-11 items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition-colors ${
        active ? on : "bg-white/5 text-white/70 hover:bg-white/10"
      }`}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}
