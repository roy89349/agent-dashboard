import { Badge, type Tone } from "@/components/ui/badge";
import type { WorkflowStatus, WorkflowStepStatus } from "@/lib/workflows";

const WF_TONE: Record<WorkflowStatus, Tone> = {
  queued: "slate", running: "emerald", blocked: "red", waiting_user: "amber", failed: "red", done: "emerald", cancelled: "slate",
};
export const WF_LABEL: Record<WorkflowStatus, string> = {
  queued: "Queued", running: "Running", blocked: "Blocked", waiting_user: "Waiting on you", failed: "Failed", done: "Done", cancelled: "Cancelled",
};
export function WorkflowStatusBadge({ status }: { status: WorkflowStatus }) {
  return <Badge tone={WF_TONE[status] ?? "slate"}>{WF_LABEL[status] ?? status}</Badge>;
}

const STEP_TONE: Record<WorkflowStepStatus, Tone> = {
  queued: "slate", running: "emerald", blocked: "red", waiting_user: "amber", review: "indigo", failed: "red", done: "emerald", skipped: "slate",
};
export const STEP_LABEL: Record<WorkflowStepStatus, string> = {
  queued: "Queued", running: "Running", blocked: "Blocked", waiting_user: "Waiting", review: "Review", failed: "Failed", done: "Done", skipped: "Skipped",
};
export function StepStatusBadge({ status }: { status: WorkflowStepStatus }) {
  return <Badge tone={STEP_TONE[status] ?? "slate"}>{STEP_LABEL[status] ?? status}</Badge>;
}
