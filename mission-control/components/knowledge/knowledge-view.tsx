"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Search, FileText, Save, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

type Entry = { path: string; name: string; dir: string };
type Hit = { path: string; line: number; text: string };

export function KnowledgeView() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [tree, setTree] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [mobileView, setMobileView] = useState<"list" | "editor">("list");
  const debTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirm = useConfirm();

  useEffect(() => {
    fetch("/api/knowledge", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        setConfigured(!!j.configured);
        setRoot(j.root ?? null);
        setTree(j.tree ?? []);
      })
      .catch(() => setConfigured(false));
  }, []);

  // debounced search
  useEffect(() => {
    if (debTimer.current) clearTimeout(debTimer.current);
    if (!q.trim()) {
      setHits(null);
      return;
    }
    debTimer.current = setTimeout(async () => {
      const r = await fetch(`/api/knowledge/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
      if (r.ok) setHits((await r.json()).results ?? []);
    }, 250);
  }, [q]);

  const openNote = useCallback(
    async (p: string) => {
      if (dirty && !(await confirm({ title: "Discard unsaved changes?", tone: "danger", confirmLabel: "Discard" }))) return;
      const r = await fetch(`/api/knowledge/note?path=${encodeURIComponent(p)}`, { cache: "no-store" });
      const j = await r.json();
      if (r.ok) {
        setOpenPath(j.path);
        setContent(j.content);
        setDirty(false);
        setMobileView("editor"); // on phones, jump to the editor pane
      } else {
        toast.error(j.error ?? "Could not open");
      }
    },
    [dirty, confirm],
  );

  async function save() {
    if (!openPath) return;
    setSaving(true);
    const r = await fetch("/api/knowledge/note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: openPath, content }),
    });
    const j = await r.json();
    setSaving(false);
    if (r.ok) {
      toast.success("Saved");
      setDirty(false);
    } else {
      toast.error(j.error ?? "Save failed");
    }
  }

  if (configured === false) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-14 text-center">
          <BookOpen className="mx-auto size-8 text-emerald-400/60" />
          <h2 className="mt-3 text-base font-semibold">No knowledge vault configured</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-white/40">
            Set <code className="text-white/60">VAULT_DIR</code> in{" "}
            <code className="text-white/60">config.local.env</code> and{" "}
            <code className="text-white/60">mission-control/.env.local</code> to an Obsidian/markdown
            folder, then restart. Agents will use it as context and you can browse/search it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] max-md:h-[calc(100dvh-8.5rem)]">
      {/* left: search + tree — full width on phones, fixed rail on desktop */}
      <div className={`${mobileView === "editor" ? "hidden" : "flex"} w-full shrink-0 flex-col border-r border-white/10 sm:flex sm:w-72`}>
        <div className="flex items-center gap-2 border-b border-white/10 px-3">
          <Search className="size-4 text-white/40" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search notes…"
            className="h-11 w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {hits !== null ? (
            hits.length === 0 ? (
              <p className="px-2 py-4 text-center text-xs text-white/30">No matches</p>
            ) : (
              hits.map((h, i) => (
                <button
                  key={i}
                  onClick={() => openNote(h.path)}
                  className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-white/5"
                >
                  <span className="block truncate text-xs font-medium text-white/80">{h.path}:{h.line}</span>
                  <span className="block truncate text-[11px] text-white/40">{h.text}</span>
                </button>
              ))
            )
          ) : tree.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-white/30">Empty vault</p>
          ) : (
            tree.map((e) => (
              <button
                key={e.path}
                onClick={() => openNote(e.path)}
                title={e.path}
                className={`flex w-full items-center gap-2 truncate rounded-lg px-2.5 py-1.5 text-left text-sm ${
                  e.path === openPath ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5"
                }`}
              >
                <FileText className="size-3.5 shrink-0 text-white/30" />
                <span className="truncate">{e.path}</span>
              </button>
            ))
          )}
        </div>
        {root && <p className="truncate border-t border-white/10 px-3 py-1.5 text-[10px] text-white/25" title={root}>{root}</p>}
      </div>

      {/* right: editor */}
      <div className={`${mobileView === "list" ? "hidden" : "flex"} min-w-0 flex-1 flex-col sm:flex`}>
        {openPath ? (
          <>
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-2">
              <button onClick={() => setMobileView("list")} className="-ml-1 rounded-lg p-1 text-white/50 hover:bg-white/10 hover:text-white sm:hidden" aria-label="Back to notes">
                <ArrowLeft className="size-4" />
              </button>
              <FileText className="size-4 text-white/40" />
              <span className="truncate text-sm text-white/80">{openPath}</span>
              {dirty && <span className="text-[10px] text-amber-400">● unsaved</span>}
              <Button size="sm" variant="accent" className="ml-auto" disabled={saving || !dirty} onClick={save}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
              </Button>
            </div>
            <textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                setDirty(true);
              }}
              spellCheck={false}
              className="flex-1 resize-none bg-transparent p-4 font-mono text-[13px] leading-relaxed text-white/90 outline-none"
            />
          </>
        ) : (
          <div className="grid h-full place-items-center text-center">
            <div>
              <BookOpen className="mx-auto size-8 text-white/20" />
              <p className="mt-3 text-sm text-white/40">Pick a note to view or edit</p>
              <p className="mt-1 text-xs text-white/25">{tree.length} notes · search on the left</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
