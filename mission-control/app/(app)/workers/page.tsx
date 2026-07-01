import { WorkerLanes } from "@/components/fleet/worker-lanes";

export const dynamic = "force-dynamic";

export default function WorkersPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 pb-24 md:pb-5">
      <WorkerLanes />
    </div>
  );
}
