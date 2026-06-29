import { WorkerLanes } from "@/components/fleet/worker-lanes";

export const dynamic = "force-dynamic";

export default function WorkersPage() {
  return (
    <div className="p-4">
      <WorkerLanes />
    </div>
  );
}
