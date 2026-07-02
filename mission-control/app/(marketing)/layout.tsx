import type { Metadata } from "next";

// Marketing route group: NO AppShell, no session UI — the public face of Mission Control.
// The dashboard ((app) group) is untouched; /landing is allowlisted in proxy.ts (page only).
export const metadata: Metadata = {
  title: "Mission Control — AI Agent Operating System",
  description:
    "Build, manage and monitor AI agent teams with workflows, phone approvals, safety gates and token optimization.",
  openGraph: {
    title: "Mission Control — AI Agent Operating System",
    description:
      "Turn autonomous AI agents into a managed, reviewable and token-optimized production system — controlled from your dashboard or your phone.",
    type: "website",
    siteName: "Mission Control",
  },
  twitter: {
    card: "summary_large_image",
    title: "Mission Control — AI Agent Operating System",
    description:
      "Operate your own AI production team: workflows, approvals, token optimization and phone control.",
  },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh overflow-x-clip">{children}</div>;
}
