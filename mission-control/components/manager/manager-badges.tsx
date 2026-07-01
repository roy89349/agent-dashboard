import { Badge, type Tone } from "@/components/ui/badge";
import type { ManagerPlan } from "@/lib/manager";

type Status = ManagerPlan["status"];
const TONE: Record<Status, Tone> = { proposed: "amber", approved: "indigo", rejected: "red", materialized: "emerald" };
export const STATUS_LABEL: Record<Status, string> = { proposed: "Awaiting decision", approved: "Approved", rejected: "Rejected", materialized: "Materialized" };
export function ManagerStatusBadge({ status }: { status: Status }) {
  return <Badge tone={TONE[status] ?? "slate"}>{STATUS_LABEL[status] ?? status}</Badge>;
}
