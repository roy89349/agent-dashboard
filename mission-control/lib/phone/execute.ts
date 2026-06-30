// Executes a (validated) CommandPlan through the existing lib/* services. This is the ONLY place
// phone input reaches fleet.json / commands.jsonl / GitHub — and only AFTER routeCommand authorized
// + validated it. No shell-out. Every action is audited.
import type { PhoneProvider, Button } from "./types";
import type { CommandPlan } from "./commands";
import { HELP_TEXT } from "./commands";
import { readFleet, writeFleet, appendCommand, prioritizeIssue, readStatus } from "../fleet";
import { listFleetIssues, listOpenPulls, createAgentTask, requeueIssue } from "../github";
import { readAgents } from "../agents";
import { recordAudit } from "../db";
import {
  createApproval,
  decideApproval,
  getApproval,
  listPendingApprovals,
  redactApprovalPreview,
  approvalErrorStatus,
} from "../approvals";
import { runApprovalAction } from "./actions";

export interface Reply {
  text: string;
  buttons?: Button[][];
}

async function statusReply(provider: PhoneProvider, what: string): Promise<Reply> {
  if (what === "agents") {
    const a = readAgents().agents;
    const on = a.filter((x) => x.enabled);
    return {
      text: `Agents (${on.length}/${a.length} enabled):\n` +
        a.map((x) => `  ${x.enabled ? "🟢" : "⚪️"} ${x.role} — ${x.name}${x.blocking ? " [blocking]" : ""}`).join("\n"),
    };
  }
  if (what === "tasks") {
    const issues = (await listFleetIssues().catch(() => [])).slice(0, 15);
    return { text: issues.length ? "Tasks:\n" + issues.map((i) => `  #${i.number} [${i.labels.join(",")}] ${i.title}`).join("\n") : "No fleet tasks." };
  }
  if (what === "prs") {
    const prs = (await listOpenPulls().catch(() => [])).slice(0, 15);
    return { text: prs.length ? "Open PRs:\n" + prs.map((p) => `  #${p.number} ${p.title}${p.issue ? ` (closes #${p.issue})` : ""}`).join("\n") : "No open PRs." };
  }
  if (what === "decisions") {
    const ps = listPendingApprovals();
    if (!ps.length) return { text: "No pending approvals." };
    return {
      text: "Pending approvals:\n" + ps.map((p) => `  • ${p.kind} — ${p.summary}${p.issue ? ` (#${p.issue})` : ""}`).join("\n") +
        "\n(use /decisions on the dashboard or wait for the buttons)",
    };
  }
  // status / fleet
  const st = readStatus();
  const fleet = readFleet();
  const slots = (st?.slots ?? []).map((s) => ({ issue: s.issue, phase: s.phase, title: s.title }));
  const summary = {
    online: st?.online ?? false,
    mode: st?.mode ?? fleet.mode,
    claiming: st?.claiming ?? false,
    pauseReason: st?.pause_reason ?? null,
    workers: st?.knobs?.max_workers ?? fleet.max_workers ?? 1,
    prsToday: st?.prs_today ?? 0,
    breakerTripped: st?.breaker?.tripped ?? false,
    pendingApprovals: listPendingApprovals().length,
    slots,
  };
  return { text: provider.formatStatusMessage(summary) };
}

function newTaskButtons(id: string): Button[][] {
  return [
    [{ text: "✅ Create task", data: `new:${id}:create` }, { text: "👔 Ask manager first", data: `new:${id}:manager` }],
    [
      { text: "Frontend", data: `new:${id}:frontend` },
      { text: "Backend", data: `new:${id}:backend` },
      { text: "QA", data: `new:${id}:qa` },
    ],
    [{ text: "✖️ Cancel", data: `new:${id}:cancel` }],
  ];
}

/** Run a plan. `actor` = the verified chat id. Returns the reply to send back. */
export async function executeCommand(provider: PhoneProvider, plan: CommandPlan, actor: string): Promise<Reply> {
  const audit = (action: string, detail?: string, issue?: number | null) =>
    recordAudit({ actor, via: "telegram", action, issue: issue ?? null, detail: detail ?? null });

  switch (plan.kind) {
    case "unauthorized":
      return { text: "Not authorized." };
    case "empty":
    case "help":
      return { text: HELP_TEXT };
    case "unknown":
      return { text: "Unknown command. Try /help." };

    case "status":
      return statusReply(provider, plan.what);

    case "fleet_mode": {
      if (plan.needsApproval) {
        const { approval } = createApproval({
          kind: "risky_action",
          summary: `Stop the fleet (mode=${plan.mode})?`,
          risk: "halts all autonomous work until resumed",
          action: { type: "fleet_mode", mode: plan.mode },
        });
        audit("phone.command", `request stop (approval ${approval.id})`);
        return {
          text: `⚠️ Stopping the fleet needs confirmation.`,
          buttons: [[{ text: "✅ Confirm stop", data: `apv:${approval.id}:approve` }, { text: "✖️ Cancel", data: `apv:${approval.id}:reject` }]],
        };
      }
      try {
        const cur = readFleet();
        writeFleet({ mode: plan.mode }, cur.rev, true);
        audit("fleet.mode", plan.mode);
        return { text: `Fleet → ${plan.mode}.` };
      } catch (e) {
        return { text: `Could not change mode: ${e instanceof Error ? e.message : "error"}` };
      }
    }

    case "breaker_reset":
      appendCommand({ cmd: "breaker-reset" });
      audit("fleet.breaker_reset");
      return { text: "🧯 Breaker reset requested." };

    case "create_task": {
      try {
        const r = await createAgentTask({
          title: plan.title,
          labels: plan.role ? [plan.role] : undefined,
          source: "phone",
        });
        audit("task.create", `#${r.number}${plan.role ? ` role=${plan.role}` : ""}`, r.number);
        return { text: `✅ Task created: #${r.number}${plan.role ? ` (assigned to ${plan.role})` : ""}\n${r.url}` };
      } catch (e) {
        return { text: `Could not create task: ${e instanceof Error ? e.message : "error"}` };
      }
    }

    case "free_text": {
      // Treat as a message to the Manager: park it as a pending prompt_confirm approval + offer buttons.
      const { approval } = createApproval({
        kind: "prompt_confirm",
        summary: plan.text,
        advice: "Free-text message — make it a task?",
        action: { type: "create_task" },
      });
      audit("phone.message", `parked as ${approval.id}`);
      return { text: `📝 Got it:\n“${plan.text}”\n\nWant me to make this a task?`, buttons: newTaskButtons(approval.id) };
    }

    case "continue":
      try {
        await requeueIssue(plan.issue);
        audit("task.continue", `#${plan.issue}`, plan.issue);
        return { text: `▶️ #${plan.issue} re-queued (agent-ready).` };
      } catch (e) {
        return { text: `Could not continue #${plan.issue}: ${e instanceof Error ? e.message : "error"}` };
      }

    case "cancel":
      appendCommand({ cmd: "cancel", issue: plan.issue });
      audit("task.cancel", `#${plan.issue}`, plan.issue);
      return { text: `🚫 Cancel requested for #${plan.issue}.` };

    case "priority":
      prioritizeIssue(plan.issue, plan.level === "high");
      audit("task.priority", `#${plan.issue} ${plan.level}`, plan.issue);
      return { text: `📌 #${plan.issue} priority → ${plan.level}.` };

    case "decision":
      return decideReply(plan.approvalId, plan.action, actor);

    case "new_task_button":
      return newTaskReply(plan.approvalId, plan.choice, actor);
  }
}

async function decideReply(
  id: string,
  action: "approve" | "reject" | "info" | "manager" | "pause",
  actor: string,
): Promise<Reply> {
  const a = getApproval(id);
  if (!a) return { text: "That approval no longer exists." };
  if (action === "info")
    return {
      text: `ℹ️ ${a.kind} — ${a.summary}\n` +
        (a.risk ? `risk: ${a.risk}\n` : "") +
        (a.advice ? `advice: ${a.advice}\n` : "") +
        (a.diff_preview ? `\n${redactApprovalPreview(a.diff_preview)}` : "") +
        `\nstatus: ${a.status}`,
    };
  if (action === "manager") return { text: "👔 Noted — leaving this for the manager to weigh in." };
  try {
    if (action === "pause") {
      decideApproval(id, "reject", { via: "telegram", by: actor, trusted: true, reason: "paused via phone" });
      if (a.issue) appendCommand({ cmd: "cancel", issue: a.issue });
      return { text: `⏸ Paused${a.issue ? ` #${a.issue}` : ""} and dismissed the approval.` };
    }
    const decided = decideApproval(id, action, { via: "telegram", by: actor, trusted: true });
    if (action === "approve") {
      const res = await runApprovalAction(decided);
      return { text: res.ok ? `✅ Approved — ${res.detail}` : `✅ Approved, but the action failed: ${res.detail}` };
    }
    return { text: "❌ Rejected." };
  } catch (e) {
    const s = approvalErrorStatus(e);
    return { text: s === 410 ? "This approval has expired." : s === 409 ? "Already decided." : `Could not decide: ${e instanceof Error ? e.message : "error"}` };
  }
}

async function newTaskReply(
  id: string,
  choice: "create" | "frontend" | "backend" | "qa" | "manager" | "cancel",
  actor: string,
): Promise<Reply> {
  const a = getApproval(id);
  if (!a) return { text: "That suggestion is no longer available." };
  if (choice === "manager") return { text: "👔 Okay — I'll let the manager weigh in first." };
  if (choice === "cancel") {
    try {
      decideApproval(id, "reject", { via: "telegram", by: actor, trusted: true, reason: "cancelled" });
    } catch {}
    return { text: "✖️ Cancelled." };
  }
  try {
    const role = choice === "create" ? null : choice;
    const r = await createAgentTask({ title: a.summary, labels: role ? [role] : undefined, source: "phone (manager)" });
    decideApproval(id, "approve", { via: "telegram", by: actor, trusted: true });
    recordAudit({ actor, via: "telegram", action: "task.create", approval_id: id, issue: r.number, detail: role ?? "" });
    return { text: `✅ Task created: #${r.number}${role ? ` (assigned to ${role})` : ""}\n${r.url}` };
  } catch (e) {
    return { text: `Could not create task: ${e instanceof Error ? e.message : "error"}` };
  }
}
