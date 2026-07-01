"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { toast } from "sonner";
import {
  LayoutDashboard,
  MessagesSquare,
  BookOpen,
  Settings,
  Play,
  Pause,
  Square,
  Search,
  CornerDownLeft,
  Inbox,
  Users,
  Radio,
  Network,
  Boxes,
  Layers,
  GitBranch,
  Split,
} from "lucide-react";

type Item = {
  group: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  run: () => void | Promise<void>;
};

// quick fleet mode switch without the control bar (reads fresh rev, writes with CAS)
async function setMode(mode: string) {
  try {
    const f = await fetch("/api/fleet", { cache: "no-store" });
    const rev = f.ok ? (await f.json()).fleet.rev : 0;
    const res = await fetch("/api/fleet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patch: { mode }, baseRev: rev, confirm: true }),
    });
    if (res.ok) toast.success(`Fleet → ${mode}`);
    else toast.error((await res.json().catch(() => ({}))).error ?? "Failed");
  } catch {
    toast.error("Fleet unreachable");
  }
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const items: Item[] = useMemo(() => {
    const go = (href: string) => () => {
      router.push(href);
      onOpenChange(false);
    };
    return [
      { group: "Navigation", label: "Dashboard", icon: LayoutDashboard, run: go("/") },
      { group: "Navigation", label: "Work Items", hint: "tasks + handoffs", icon: Layers, run: go("/work-items") },
      { group: "Navigation", label: "Workflows", hint: "multi-role pipelines", icon: GitBranch, run: go("/workflows") },
      { group: "Navigation", label: "Manager", hint: "split big tasks into subtasks", icon: Split, run: go("/manager") },
      { group: "Navigation", label: "Decision Inbox", hint: "pending approvals", icon: Inbox, run: go("/approvals") },
      { group: "Navigation", label: "War Room", hint: "live who's doing what", icon: Radio, run: go("/workers") },
      { group: "Navigation", label: "Agents", hint: "the team", icon: Users, run: go("/agents") },
      { group: "Navigation", label: "Team Composer", hint: "compose your AI team", icon: Network, run: go("/team-composer") },
      { group: "Navigation", label: "Skill Library", hint: "agent capabilities", icon: Boxes, run: go("/skills") },
      { group: "Navigation", label: "Conversations", icon: MessagesSquare, run: go("/chats") },
      { group: "Navigation", label: "Knowledge", hint: "Obsidian vault", icon: BookOpen, run: go("/kennis") },
      { group: "Navigation", label: "Config", icon: Settings, run: go("/config") },
      { group: "Fleet", label: "Start fleet", icon: Play, run: () => { setMode("running"); onOpenChange(false); } },
      { group: "Fleet", label: "Pause fleet", icon: Pause, run: () => { setMode("paused"); onOpenChange(false); } },
      { group: "Fleet", label: "Stop fleet", icon: Square, run: () => { setMode("stopped"); onOpenChange(false); } },
    ];
  }, [router, onOpenChange]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return items;
    return items.filter((i) => (i.label + " " + (i.hint ?? "")).toLowerCase().includes(s));
  }, [q, items]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIdx(0);
    }
  }, [open]);
  useEffect(() => {
    if (idx >= filtered.length) setIdx(Math.max(0, filtered.length - 1));
  }, [filtered, idx]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
        <Dialog.Content
          className="fixed left-1/2 top-[18%] z-50 w-[92vw] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-white/10 bg-[#0d1322] shadow-2xl mc-fade-in"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Command palette</Dialog.Title>
          <div className="flex items-center gap-2 border-b border-white/10 px-3.5">
            <Search className="size-4 text-white/40" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(filtered.length - 1, i + 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(0, i - 1)); }
                else if (e.key === "Enter") { e.preventDefault(); filtered[idx]?.run(); }
              }}
              placeholder="Jump to… or type a command"
              className="h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
            />
            <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-white/40 sm:block">esc</kbd>
          </div>
          <div className="max-h-80 overflow-y-auto p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-white/30">Nothing found</p>
            ) : (
              filtered.map((it, i) => {
                const Icon = it.icon;
                const prevGroup = i > 0 ? filtered[i - 1].group : null;
                return (
                  <div key={it.label}>
                    {it.group !== prevGroup && (
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-white/30">
                        {it.group}
                      </p>
                    )}
                    <button
                      onMouseEnter={() => setIdx(i)}
                      onClick={() => it.run()}
                      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm ${
                        i === idx ? "bg-white/10 text-white" : "text-white/70"
                      }`}
                    >
                      <Icon className="size-4 text-white/50" />
                      <span className="flex-1">{it.label}</span>
                      {it.hint && <span className="text-xs text-white/30">{it.hint}</span>}
                      {i === idx && <CornerDownLeft className="size-3.5 text-white/30" />}
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
