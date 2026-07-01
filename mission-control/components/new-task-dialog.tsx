"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function NewTaskDialog() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, body }),
    });
    setBusy(false);
    if (res.ok) {
      const j = await res.json();
      toast.success(`Task #${j.number} created — the fleet will pick it up`);
      setTitle("");
      setBody("");
      setOpen(false);
      router.refresh();
    } else {
      toast.error("Could not create the task");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="accent" size="sm">
          <Plus className="size-4" /> New task
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New task for the fleet</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <Input
            autoFocus
            placeholder="What needs to happen? (title)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <textarea
            className="min-h-28 w-full resize-y rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white backdrop-blur-sm transition-colors placeholder:text-white/30 outline-none focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/20"
            placeholder="Optional: more context, acceptance criteria, files involved…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <Button type="submit" variant="accent" size="lg" className="w-full" disabled={busy || !title.trim()}>
            {busy ? "Creating…" : "Create (agent-ready)"}
          </Button>
          <p className="text-center text-[11px] text-white/35">
            Created as <span className="font-medium text-white/50">agent-ready</span> — the fleet picks it up automatically.
          </p>
        </form>
      </DialogContent>
    </Dialog>
  );
}
