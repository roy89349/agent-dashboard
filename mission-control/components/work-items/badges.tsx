import { Badge, type Tone } from "@/components/ui/badge";
import type { WorkItemState, WorkItemPriority } from "@/lib/work-items";

export const STATE_TONE: Record<WorkItemState, Tone> = {
  queued: "slate", running: "indigo", blocked: "red", waiting_user: "amber",
  review: "teal", failed: "red", done: "emerald", cancelled: "slate",
};
export const STATE_LABEL: Record<WorkItemState, string> = {
  queued: "Queued", running: "Running", blocked: "Blocked", waiting_user: "Waiting on you",
  review: "In review", failed: "Failed", done: "Done", cancelled: "Cancelled",
};

export function StateBadge({ state }: { state: WorkItemState }) {
  return <Badge tone={STATE_TONE[state] ?? "slate"}>{STATE_LABEL[state] ?? state}</Badge>;
}

const PRIO_TONE: Record<WorkItemPriority, Tone> = { low: "slate", normal: "slate", high: "amber", urgent: "red" };
export function PriorityBadge({ p }: { p: WorkItemPriority }) {
  if (p === "normal") return null; // normal is the baseline — don't clutter
  return <Badge tone={PRIO_TONE[p] ?? "slate"}>{p}</Badge>;
}
