import { getBoard } from "@/lib/board";
import { Board } from "@/components/board";
import { ControlBar } from "@/components/fleet/control-bar";

// Verse GitHub+telemetrie-snapshot bij paginabezoek; daarna pollen de componenten zelf.
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const initial = await getBoard();
  return (
    <div className="space-y-4 p-4">
      <ControlBar />
      <Board initial={initial} />
    </div>
  );
}
