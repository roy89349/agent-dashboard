// Executes a (validated) CommandPlan through the existing lib/* services. This is the ONLY place
// phone input reaches fleet.json / commands.jsonl / GitHub — and only AFTER routeCommand authorized
// + validated it. No shell-out. Every action is audited.
import type { PhoneProvider, Button } from "./types";
import type { CommandPlan } from "./commands";
import { ok, warn, err, info, helpCard, listCard, approvalCard, esc } from "./format.ts";
import { readFleet, writeFleet, appendCommand, prioritizeIssue, readStatus } from "../fleet";
import { listFleetIssues, listOpenPulls, createAgentTask, requeueIssue } from "../github";
import { readAgents } from "../agents";
import { recordAudit } from "../db";
import {
  createApproval,
  decideApproval,
  getApproval,
  listPendingApprovals,
  approvalErrorStatus,
} from "../approvals";
import { runApprovalAction } from "./actions";
import { enforce, permissionStatusOf } from "../permissions";

export interface Reply {
  text: string;
  buttons?: Button[][];
}

// Read-only / approval-resolution verbs skip the permission layer; EVERY other (mutating) verb is enforced
// (audited + approval-gated) below — fail-closed, so a new mutating verb can't silently bypass.
const PHONE_READONLY = new Set(["unauthorized", "empty", "help", "unknown", "status", "decision", "new_task_button", "free_text"]);

function phoneSummary(plan: CommandPlan): string {
  switch (plan.kind) {
    case "fleet_mode": return `Set the fleet to ${plan.mode}`;
    case "breaker_reset": return "Reset the circuit breaker";
    case "create_task": return `Create task: ${plan.title}`;
    case "continue": return `Re-queue #${plan.issue} (re-triggers autonomous work)`;
    case "cancel": return `Cancel #${plan.issue}`;
    case "priority": return `Set #${plan.issue} priority → ${plan.level}`;
    default: return plan.kind;
  }
}

async function statusReply(provider: PhoneProvider, what: string): Promise<Reply> {
  if (what === "agents") {
    const a = readAgents().agents;
    const on = a.filter((x) => x.enabled).length;
    return {
      text: listCard(
        `👥 <b>Agents</b>  <i>(${on}/${a.length} enabled)</i>`,
        a.map((x) => `${x.enabled ? "🟢" : "⚪️"} <b>${esc(x.role)}</b> — ${esc(x.name)}${x.blocking ? " 🛡" : ""}`),
        "none",
      ),
    };
  }
  if (what === "tasks") {
    const issues = (await listFleetIssues().catch(() => [])).slice(0, 15);
    return {
      text: listCard(
        "📋 <b>Tasks</b>",
        issues.map((i) => `<b>#${esc(i.number)}</b> <i>[${esc(i.labels.join(", "))}]</i> ${esc(i.title)}`),
        "no fleet tasks",
      ),
    };
  }
  if (what === "prs") {
    const prs = (await listOpenPulls().catch(() => [])).slice(0, 15);
    return {
      text: listCard(
        "🔀 <b>Open PRs</b>",
        prs.map((p) => `<b>#${esc(p.number)}</b> ${esc(p.title)}${p.issue ? ` <i>(closes #${esc(p.issue)})</i>` : ""}`),
        "no open PRs",
      ),
    };
  }
  if (what === "decisions") {
    const ps = listPendingApprovals();
    return {
      text: listCard(
        "🔐 <b>Pending approvals</b>",
        ps.map((p) => `• <b>${esc(p.kind)}</b> — ${esc(p.summary)}${p.issue ? ` (#${esc(p.issue)})` : ""}`),
        "no pending approvals — you're all clear",
      ),
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

  // ── central permission layer: enforce every mutating fleet command (the phone operator is a trusted
  //    human, so most pass + are audited; dangerous ones — stop / cap / opus — return an approval card). ──
  if (!PHONE_READONLY.has(plan.kind)) {
    try {
      const d = await enforce(
        { type: "phone_command", verb: plan.kind, mode: "mode" in plan ? plan.mode : undefined, mutates: true, issue: "issue" in plan ? plan.issue : undefined },
        { agentId: null, initiator: "phone", trusted: true, confirmed: false, via: "telegram", actor },
        { summary: phoneSummary(plan) },
      );
      if (!d.allowed)
        return {
          text: warn(`${phoneSummary(plan)} — needs your approval.`),
          buttons: [[{ text: "✅ Approve", data: `apv:${d.approvalId}:approve` }, { text: "✖️ Reject", data: `apv:${d.approvalId}:reject` }]],
        };
    } catch (e) {
      // FAIL-CLOSED: any throw from enforce (a 403 deny OR a store/audit outage mid-enforce) blocks the
      // command — an error must never fall through to the executing switch.
      const denied = permissionStatusOf(e) === 403;
      return { text: err(denied ? `Not permitted: ${e instanceof Error ? e.message : "denied"}` : "Could not verify permission — command blocked.") };
    }
  }

  switch (plan.kind) {
    case "unauthorized":
      return { text: err("Not authorized.") };
    case "empty":
    case "help":
      return { text: helpCard() };
    case "unknown":
      return { text: warn("Unknown command — try /help.") };

    case "status":
      return statusReply(provider, plan.what);

    case "fleet_mode": {
      // dangerous modes (stop) were already intercepted by the permission layer above (it returned an
      // approval card); reaching here means the mode is permitted (running/paused) → apply it.
      try {
        const cur = readFleet();
        writeFleet({ mode: plan.mode }, cur.rev, true);
        audit("fleet.mode", plan.mode);
        return { text: ok(`Fleet → <b>${esc(plan.mode)}</b>`) };
      } catch (e) {
        return { text: err(`Could not change mode: ${e instanceof Error ? e.message : "error"}`) };
      }
    }

    case "breaker_reset":
      appendCommand({ cmd: "breaker-reset" });
      audit("fleet.breaker_reset");
      return { text: ok("Breaker reset requested.") };

    case "create_task": {
      try {
        const r = await createAgentTask({
          title: plan.title,
          labels: plan.role ? [plan.role] : undefined,
          source: "phone",
        });
        audit("task.create", `#${r.number}${plan.role ? ` role=${plan.role}` : ""}`, r.number);
        return {
          text: info(`✅ Task created — #${r.number}`, [
            plan.role ? `👥 assigned to <b>${esc(plan.role)}</b>` : "",
            `🔗 ${esc(r.url)}`,
          ]),
        };
      } catch (e) {
        return { text: err(`Could not create task: ${e instanceof Error ? e.message : "error"}`) };
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
      return {
        text: info("📝 Got it", [`<blockquote>${esc(plan.text)}</blockquote>`, "", "Want me to make this a task?"]),
        buttons: newTaskButtons(approval.id),
      };
    }

    case "continue":
      try {
        await requeueIssue(plan.issue);
        audit("task.continue", `#${plan.issue}`, plan.issue);
        return { text: ok(`#${esc(plan.issue)} re-queued (agent-ready).`) };
      } catch (e) {
        return { text: err(`Could not continue #${plan.issue}: ${e instanceof Error ? e.message : "error"}`) };
      }

    case "cancel":
      appendCommand({ cmd: "cancel", issue: plan.issue });
      audit("task.cancel", `#${plan.issue}`, plan.issue);
      return { text: ok(`Cancel requested for #${esc(plan.issue)}.`) };

    case "priority":
      prioritizeIssue(plan.issue, plan.level === "high");
      audit("task.priority", `#${plan.issue} ${plan.level}`, plan.issue);
      return { text: ok(`#${esc(plan.issue)} priority → <b>${esc(plan.level)}</b>.`) };

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
  if (!a) return { text: err("That approval no longer exists.") };
  if (action === "info") return { text: approvalCard(a) + `\n\nstatus: <b>${esc(a.status)}</b>` };
  if (action === "manager") return { text: info("👔 Over to the manager", ["Leaving this one for the manager to weigh in."]) };
  try {
    if (action === "pause") {
      decideApproval(id, "reject", { via: "telegram", by: actor, trusted: true, reason: "paused via phone" });
      if (a.issue) appendCommand({ cmd: "cancel", issue: a.issue });
      return { text: ok(`Paused${a.issue ? ` #${esc(a.issue)}` : ""} and dismissed the approval.`) };
    }
    const decided = decideApproval(id, action, { via: "telegram", by: actor, trusted: true });
    if (action === "approve") {
      const res = await runApprovalAction(decided);
      return { text: res.ok ? ok(`Approved — ${esc(res.detail)}`) : warn(`Approved, but the action failed: ${esc(res.detail)}`) };
    }
    return { text: "❌ <b>Rejected.</b>" };
  } catch (e) {
    const s = approvalErrorStatus(e);
    return { text: s === 410 ? warn("This approval has expired.") : s === 409 ? warn("Already decided.") : err(`Could not decide: ${e instanceof Error ? e.message : "error"}`) };
  }
}

async function newTaskReply(
  id: string,
  choice: "create" | "frontend" | "backend" | "qa" | "manager" | "cancel",
  actor: string,
): Promise<Reply> {
  const a = getApproval(id);
  if (!a) return { text: err("That suggestion is no longer available.") };
  if (choice === "manager") return { text: info("👔 Over to the manager", ["I'll let the manager weigh in first."]) };
  if (choice === "cancel") {
    try {
      decideApproval(id, "reject", { via: "telegram", by: actor, trusted: true, reason: "cancelled" });
    } catch {}
    return { text: "✖️ <b>Cancelled.</b>" };
  }
  try {
    const role = choice === "create" ? null : choice;
    const r = await createAgentTask({ title: a.summary, labels: role ? [role] : undefined, source: "phone (manager)" });
    decideApproval(id, "approve", { via: "telegram", by: actor, trusted: true });
    recordAudit({ actor, via: "telegram", action: "task.create", approval_id: id, issue: r.number, detail: role ?? "" });
    return {
      text: info(`✅ Task created — #${r.number}`, [
        role ? `👥 assigned to <b>${esc(role)}</b>` : "",
        `🔗 ${esc(r.url)}`,
      ]),
    };
  } catch (e) {
    return { text: err(`Could not create task: ${e instanceof Error ? e.message : "error"}`) };
  }
}
