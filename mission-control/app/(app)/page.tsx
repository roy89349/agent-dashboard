import Link from "next/link";
import { Inbox, Split } from "lucide-react";
import { getBoard } from "@/lib/board";
import { Board } from "@/components/board";
import { ControlBar } from "@/components/fleet/control-bar";
import { MetricsRow } from "@/components/fleet/metrics-row";
import { PageHeader } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";

// Fresh GitHub+telemetry snapshot on page visit; the components poll on their own afterwards.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initial = await getBoard();
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <PageHeader
        title="Mission Control"
        subtitle="Your agent fleet, live — tasks flow from backlog to reviewed PRs."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/approvals">
                <Inbox className="size-3.5" /> Decisions
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/manager">
                <Split className="size-3.5" /> Ask manager
              </Link>
            </Button>
          </>
        }
      />
      <ControlBar />
      <MetricsRow />
      <Board initial={initial} />
    </div>
  );
}
