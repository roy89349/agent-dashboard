"use client";
// Promise-based confirm modal — the dark replacement for window.confirm / window.prompt. Mount
// <ConfirmProvider> once (in the app shell); call const confirm = useConfirm() and `await confirm({...})`
// anywhere below it. Supports a `challenge` word (type-to-confirm) for dangerous, irreversible actions.
import { createContext, useCallback, useContext, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AlertTriangle, ShieldAlert } from "lucide-react";

export type ConfirmOpts = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  challenge?: string; // if set, the user must type this exact text to enable Confirm
};

const Ctx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<ConfirmOpts | null>(null);
  const [typed, setTyped] = useState("");
  const resolverRef = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback((o: ConfirmOpts) => {
    setTyped("");
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    resolverRef.current?.(ok);
    resolverRef.current = null;
    setOpts(null);
  }, []);

  const danger = opts?.tone === "danger";
  const challengeOk = !opts?.challenge || typed === opts.challenge;
  const Icon = danger ? ShieldAlert : AlertTriangle;

  return (
    <Ctx.Provider value={confirm}>
      {children}
      <DialogPrimitive.Root open={!!opts} onOpenChange={(o) => !o && close(false)}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-[80] bg-black/65 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-[80] w-[92vw] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-white/10 bg-[#0d1322] p-5 text-white shadow-2xl shadow-black/50 [animation:mc-fade-in_0.18s_ease-out]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && challengeOk) {
                e.preventDefault();
                close(true);
              }
            }}
          >
            <div className="flex items-start gap-3">
              <div className={`grid size-9 shrink-0 place-items-center rounded-xl ${danger ? "bg-red-500/15 text-red-300" : "bg-white/5 text-white/60"}`}>
                <Icon className="size-[18px]" />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title className="text-sm font-semibold">{opts?.title}</DialogPrimitive.Title>
                {opts?.body && (
                  <DialogPrimitive.Description className="mt-1 text-xs leading-relaxed text-white/55">
                    {opts.body}
                  </DialogPrimitive.Description>
                )}
              </div>
            </div>

            {opts?.challenge && (
              <div className="mt-3.5">
                <label className="mb-1 block text-[11px] text-white/40">
                  Type <span className="font-mono font-semibold text-white/80">{opts.challenge}</span> to confirm
                </label>
                <input
                  autoFocus
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  className="h-9 w-full rounded-lg border border-white/10 bg-white/5 px-3 text-sm text-white outline-none focus:border-emerald-500/40"
                />
              </div>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => close(false)}
                className="h-9 rounded-lg px-3.5 text-sm text-white/70 hover:bg-white/5"
              >
                {opts?.cancelLabel ?? "Cancel"}
              </button>
              <button
                onClick={() => close(true)}
                disabled={!challengeOk}
                className={`h-9 rounded-lg px-4 text-sm font-semibold transition-colors disabled:opacity-40 ${
                  danger ? "bg-red-500 text-white hover:bg-red-400" : "bg-emerald-500 text-black hover:bg-emerald-400"
                }`}
              >
                {opts?.confirmLabel ?? "Confirm"}
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </Ctx.Provider>
  );
}
