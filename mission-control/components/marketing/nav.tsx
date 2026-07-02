"use client";
// MarketingNav — the only interactive piece of the marketing shell (mobile drawer state).
// Kept separate from shared.tsx so the presentational primitives stay server components.
import { useState } from "react";
import Link from "next/link";
import { Radio, Menu, X, ArrowRight } from "lucide-react";
import { GlassButton } from "@/components/marketing/shared";

const NAV_LINKS = [
  { href: "#product", label: "Product" },
  { href: "#features", label: "Features" },
  { href: "#tokens", label: "Token Optimization" },
  { href: "#phone", label: "Phone Control" },
  { href: "#safety", label: "Safety" },
  { href: "#use-cases", label: "Use Cases" },
];

export function MarketingNav() {
  const [open, setOpen] = useState(false);
  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-6 sm:pt-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-emerald-400 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-black"
      >
        Skip to content
      </a>
      <nav className="mk-glass mx-auto flex h-14 max-w-6xl items-center gap-6 !rounded-2xl px-4 sm:px-5">
        <Link href="/landing" className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-br from-emerald-400 to-indigo-500 text-black shadow-[0_0_18px] shadow-emerald-400/40">
            <Radio className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">Mission Control</span>
        </Link>

        <div className="ml-auto hidden items-center gap-6 lg:flex">
          {NAV_LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[13px] font-medium text-white/60 transition-colors hover:text-white">
              {l.label}
            </a>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 lg:ml-6">
          <Link
            href="/"
            className="hidden h-9 items-center rounded-lg px-3.5 text-[13px] font-medium text-white/70 transition-colors hover:text-white sm:inline-flex"
          >
            Open Dashboard
          </Link>
          <GlassButton href="/" variant="accent" size="sm" className="hidden rounded-lg sm:inline-flex">
            Build your AI team <ArrowRight className="size-3.5" />
          </GlassButton>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
            aria-expanded={open}
            className="grid size-9 place-items-center rounded-lg text-white/70 hover:bg-white/10 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </nav>

      {/* mobile drawer */}
      {open && (
        <div className="mk-glass mx-auto mt-2 max-h-[calc(100dvh-5.5rem)] max-w-6xl overflow-y-auto !rounded-2xl p-4 lg:hidden">
          <div className="flex flex-col gap-1">
            {NAV_LINKS.map((l) => (
              <a
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-sm font-medium text-white/70 hover:bg-white/5 hover:text-white"
              >
                {l.label}
              </a>
            ))}
            <div className="mt-2 flex gap-2 border-t border-white/10 pt-3">
              <GlassButton href="/" variant="accent" className="flex-1">
                Open Dashboard
              </GlassButton>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
