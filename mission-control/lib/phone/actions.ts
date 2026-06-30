// Executes an APPROVED approval's action through the existing validated lib/* services only — never
// a shell-out, never raw user input to a shell. The action_json was set when the approval was created.
import { readFleet, writeFleet, appendCommand } from "../fleet";
import { mergePull, createAgentTask, requeueIssue } from "../github";
import type { Approval } from "../approvals";

export async function runApprovalAction(a: Approval): Promise<{ ok: boolean; detail: string }> {
  let action: { type?: string; [k: string]: unknown } = {};
  try {
    action = a.action_json ? JSON.parse(a.action_json) : {};
  } catch {
    return { ok: false, detail: "invalid action payload" };
  }
  try {
    switch (action.type) {
      case "merge": {
        const pr = Number(action.pr ?? a.pr);
        if (!Number.isInteger(pr) || pr < 1) return { ok: false, detail: "no PR number" };
        const r = await mergePull(pr, { deleteBranch: true });
        return { ok: r.merged, detail: r.message };
      }
      case "create_task": {
        const title = String(action.title ?? a.summary).slice(0, 240);
        const labels = Array.isArray(action.labels) ? (action.labels as string[]) : undefined;
        const r = await createAgentTask({ title, body: action.body as string, labels, source: "phone approval" });
        return { ok: true, detail: `issue #${r.number}` };
      }
      case "cap_increase": {
        const cur = readFleet();
        writeFleet(
          {
            max_workers: typeof action.max_workers === "number" ? action.max_workers : undefined,
            max_pr_per_day: typeof action.max_pr_per_day === "number" ? action.max_pr_per_day : undefined,
          },
          cur.rev,
          true,
        );
        return { ok: true, detail: "caps updated" };
      }
      case "force_opus": {
        const cur = readFleet();
        writeFleet({ router: "opus" }, cur.rev, true);
        return { ok: true, detail: "router set to opus" };
      }
      case "fleet_mode": {
        const cur = readFleet();
        writeFleet({ mode: action.mode as "running" | "paused" | "stopped" }, cur.rev, true);
        return { ok: true, detail: `mode=${action.mode}` };
      }
      case "requeue": {
        await requeueIssue(Number(action.issue));
        return { ok: true, detail: `requeued #${action.issue}` };
      }
      case "cancel": {
        appendCommand({ cmd: "cancel", issue: Number(action.issue) });
        return { ok: true, detail: `cancel #${action.issue}` };
      }
      case "noop":
      case "ack":
        // sign-off style approvals (plan_signoff, prompt_confirm) — the decision IS the outcome,
        // there is no automated follow-up action to run.
        return { ok: true, detail: "acknowledged" };
      default:
        return { ok: false, detail: `unknown action type: ${action.type ?? "(none)"}` };
    }
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : "action failed" };
  }
}
