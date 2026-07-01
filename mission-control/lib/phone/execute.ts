// Executes a (validated) CommandPlan through the existing lib/* services. This is the ONLY place
// phone input reaches fleet.json / commands.jsonl / GitHub — and only AFTER routeCommand authorized
// + validated it. No shell-out. Every action is audited.
import type { PhoneProvider, Button } from "./types";
import type { CommandPlan } from "./commands";
import { ok, warn, err, info, helpCard, listCard, approvalCard, esc } from "./format.ts";
import { readAgents } from "../agents.ts";
import { recordAudit } from "../db.ts";
import {
  createApproval,
  decideApproval,
  getApproval,
  listPendingApprovals,
  listApprovals,
  approvalErrorStatus,
} from "../approvals.ts";
import { enforce, permissionStatusOf } from "../permissions.ts";
import { handlePlanRejection } from "../plans.ts";
import { learnFromRejection } from "../rejection-learning.ts";
import { handleWorkflowRejection } from "../workflows.ts";
import { handleDecompositionRejection, proposeDecomposition } from "../manager.ts";
import { redact } from "../redact.ts";
import { usageSummary } from "../token-optimization/ledger.ts";
import { getGlobalMode, setGlobalMode } from "../token-optimization/budget-manager.ts";
import { cacheStats } from "../token-optimization/context-cache.ts";
import { compressionStats } from "../token-optimization/compressor.ts";
import { generateRecommendations, listRecommendations, getRecommendation, setRecommendationStatus } from "../token-optimization/recommendations.ts";

// fleet.ts / github.ts / actions.ts pull in `import "server-only"` — importing them at module scope
// would make this file un-importable under `node --test`. They are loaded lazily by the cases that
// actually reach the fleet/GitHub (identical behavior at runtime; Next bundles them the same way).
const fleetLib = () => import("../fleet.ts");
const githubLib = () => import("../github.ts");

export interface Reply {
  text: string;
  buttons?: Button[][];
}

// Read-only / approval-resolution verbs skip the permission layer; EVERY other (mutating) verb is enforced
// (audited + approval-gated) below — fail-closed, so a new mutating verb can't silently bypass.
// these produce no fleet mutation — they only render or park a pending approval (which is the real gate).
// `decompose` only PROPOSES a plan (a plan_signoff approval); nothing is created until you approve it.
// token reports (tokens/budget/savings/expensive/optimize/usage) only read the ledger; `approve_cost`
// resolves a pending approval — the approval itself is the real gate (same treatment as "decision").
const PHONE_READONLY = new Set([
  "unauthorized", "empty", "help", "unknown", "status", "decision", "new_task_button", "free_text", "decompose", "summary",
  "tokens", "budget", "savings", "expensive", "optimize", "usage", "approve_cost",
]);

function phoneSummary(plan: CommandPlan): string {
  switch (plan.kind) {
    case "fleet_mode": return `Set the fleet to ${plan.mode}`;
    case "breaker_reset": return "Reset the circuit breaker";
    case "create_task": return `Create task: ${plan.title}`;
    case "continue": return `Re-queue #${plan.issue} (re-triggers autonomous work)`;
    case "cancel": return `Cancel #${plan.issue}`;
    case "priority": return `Set #${plan.issue} priority → ${plan.level}`;
    case "set_token_mode": return `Set token optimization mode → ${plan.mode}`;
    case "recommendation_button": return `${plan.choice === "apply" ? "Apply" : "Dismiss"} optimization recommendation`;
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
    const { listFleetIssues } = await githubLib();
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
    const { listOpenPulls } = await githubLib();
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
  const { readStatus, readFleet } = await fleetLib();
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

// ── token optimization cards (short, honest: `~` / "estimate" whenever no actual usage was reported;
//    a $ figure is ONLY shown when actual_cost_usd is non-null) ──
const fmtNum = (n: number) => Math.round(n).toLocaleString("en-US");
const SEVEN_DAYS_AGO = () => new Date(Date.now() - 7 * 86400_000).toISOString();

function tokensReply(withCosts: boolean): Reply {
  const s = usageSummary(); // defaults to today
  const lines = [
    `🏃 runs: <b>${esc(s.runs)}</b>  ·  failed: <b>${esc(s.failed_runs)}</b>`,
    s.runs_with_actuals > 0
      ? `🪙 tokens: <b>${esc(fmtNum(s.actual_tokens))}</b> actual (${esc(s.runs_with_actuals)}/${esc(s.runs)} runs)  ·  ~${esc(fmtNum(s.est_tokens))} estimate`
      : `🪙 tokens: ~<b>${esc(fmtNum(s.est_tokens))}</b> <i>(estimate — no actual usage reported)</i>`,
    `🗑 wasted on failed runs: ~${esc(fmtNum(s.wasted_tokens_failed))}`,
    `♻️ cache hits: <b>${esc(s.cache_hits)}</b>  ·  🗜 compressed runs: <b>${esc(s.compression_runs)}</b>`,
  ];
  if (withCosts)
    lines.push(
      s.actual_cost_usd != null
        ? `💵 cost today: <b>$${esc(s.actual_cost_usd.toFixed(4))}</b> (actual)`
        : "💵 no real cost data — estimates only",
    );
  const top = s.by_agent.slice(0, 3);
  if (top.length) {
    lines.push("👤 <b>Top agents</b>");
    for (const a of top)
      lines.push(`• <b>${esc(redact(a.key))}</b> — ${a.is_actual_any ? "" : "~"}${esc(fmtNum(a.tokens))} tk · ${esc(a.runs)} runs${a.failed ? ` · ${esc(a.failed)} failed` : ""}`);
  }
  return { text: info("🪙 Tokens today", lines) };
}

function budgetReply(): Reply {
  const mode = getGlobalMode();
  const open = listPendingApprovals().filter((p) => p.kind === "escalation" && p.risk === "budget");
  const lines = [
    `🎛 mode: <b>${esc(mode)}</b>`,
    ...(open.length
      ? ["🔐 <b>Open budget approvals</b>", ...open.map((p) => `• <code>${esc(p.id.slice(0, 8))}</code> — ${esc(redact(p.summary))}`)]
      : ["🔐 no open budget approvals"]),
    `💡 <code>/setmode economy|balanced|high_quality</code>  ·  approve with <code>/approve_cost &lt;id&gt;</code>`,
  ];
  return { text: info("💰 Token budget", lines) };
}

function savingsReply(): Reply {
  const comp = compressionStats(SEVEN_DAYS_AGO());
  const cache = cacheStats();
  const lines = [
    `🗜 compression (7d): <b>${esc(fmtNum(comp.tokens_saved))}</b> tokens saved · ${esc(comp.count)} summaries`,
    comp.avg_ratio != null ? `📉 avg compression ratio: <b>${esc(comp.avg_ratio.toFixed(2))}</b>` : "",
    `⚠️ low-confidence compressions: <b>${esc(comp.low_confidence)}</b>`,
    cache.hit_rate != null
      ? `♻️ cache hit rate: <b>${esc(Math.round(cache.hit_rate))}%</b> (${esc(cache.hits)}/${esc(cache.hits + cache.misses)}) · ${esc(cache.entries)} entries` // hit_rate is already 0–100
      : "♻️ cache: no traffic yet",
  ];
  return { text: info("💚 Token savings (7 days)", lines) };
}

function expensiveReply(): Reply {
  const s = usageSummary(SEVEN_DAYS_AGO());
  const agentRow = (a: { key: string; runs: number; tokens: number; is_actual_any: boolean; failed: number }) =>
    `• <b>${esc(redact(a.key))}</b> — ${a.is_actual_any ? "" : "~"}${esc(fmtNum(a.tokens))} tk · ${esc(a.runs)} runs${a.failed ? ` · ${esc(a.failed)} failed` : ""}`;
  const lines = [
    "👤 <b>Top agents</b>",
    ...(s.by_agent.length ? s.by_agent.slice(0, 5).map(agentRow) : ["<i>no usage recorded</i>"]),
    "🗂 <b>Top workflows</b>",
    ...(s.by_workflow.length
      ? s.by_workflow.slice(0, 3).map((w) => `• <b>${esc(redact(w.key))}</b> — ~${esc(fmtNum(w.tokens))} tk · ${esc(w.runs)} runs`)
      : ["<i>no workflow usage recorded</i>"]),
    "<i>~ = estimate (no actual usage reported)</i>",
  ];
  return { text: info("💸 Most expensive (7 days)", lines) };
}

function optimizeReply(): Reply {
  generateRecommendations(); // rescan the last 7 days (idempotent per rule)
  const recs = listRecommendations("open").slice(0, 5);
  // one tap = the approval: numbered rows + an Apply/Dismiss button pair per recommendation. The tap
  // routes through the permission layer (audited) and only ever flips policy via the budget-manager.
  const buttons: Button[][] = recs.map((r, i) => [
    { text: `✅ Apply ${i + 1}`, data: `rec:${r.id}:apply` },
    { text: `✖️ Dismiss ${i + 1}`, data: `rec:${r.id}:dismiss` },
  ]);
  return {
    text: listCard(
      "🧠 <b>Optimization recommendations</b>",
      recs.map((r, i) => `<b>${i + 1}.</b> <b>${esc(redact(r.title))}</b>${r.impact ? ` — <i>${esc(redact(r.impact))}</i>` : ""}`),
      "no open recommendations — usage looks healthy",
    ),
    buttons: buttons.length ? buttons : undefined,
  };
}

/** What a one-tap "apply" concretely did — mirrors setRecommendationStatus's rule handling. */
function appliedNote(rule: string): string {
  if (rule.startsWith("policy.agent."))
    return `budget policy (balanced) set for <b>${esc(redact(rule.slice("policy.agent.".length)))}</b>`;
  if (rule.startsWith("route.downgrade."))
    return `economy policy set for <b>${esc(redact(rule.slice("route.downgrade.".length)))}</b> — the outcome router now prefers the proven cheaper model`;
  return "marked applied — no automatic policy change for this rule";
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
        const { readFleet, writeFleet } = await fleetLib();
        const cur = readFleet();
        writeFleet({ mode: plan.mode }, cur.rev, true);
        audit("fleet.mode", plan.mode);
        return { text: ok(`Fleet → <b>${esc(plan.mode)}</b>`) };
      } catch (e) {
        return { text: err(`Could not change mode: ${e instanceof Error ? e.message : "error"}`) };
      }
    }

    case "breaker_reset":
      (await fleetLib()).appendCommand({ cmd: "breaker-reset" });
      audit("fleet.breaker_reset");
      return { text: ok("Breaker reset requested.") };

    case "create_task": {
      try {
        const { createAgentTask } = await githubLib();
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

    case "decompose": {
      // the Manager proposes a decomposition (seeded from a default pipeline) and raises a plan_signoff
      // approval — the phone gets an "approve this plan?" card automatically. Nothing is built until approved.
      try {
        const { workItem, managerPlan } = proposeDecomposition({ title: plan.text, source: "phone", seed_template_id: "tpl_build_feature", created_by: actor });
        audit("manager.propose", `wi=${workItem.id} plan=${managerPlan.id}`);
        return { text: info("🗂 Plan proposed", [`<blockquote>${esc(plan.text)}</blockquote>`, "", `Broken into <b>${managerPlan.plan.subtasks.length}</b> subtasks — approve the plan I just sent to create the tasks + start the workflow.`]) };
      } catch (e) {
        return { text: err(`Could not plan: ${e instanceof Error ? e.message : "error"}`) };
      }
    }

    case "summary": {
      // the Communication Agent's latest team status — one voice, already HTML-safe (renderSummaryText escapes).
      try {
        const { generateSummary, renderSummaryText } = await import("../communication.ts");
        const s = generateSummary({ type: "live", created_by: actor });
        audit("comm.summary", "via /summary");
        return { text: renderSummaryText(s) };
      } catch (e) {
        return { text: err(`Could not build the summary: ${e instanceof Error ? e.message : "error"}`) };
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
        await (await githubLib()).requeueIssue(plan.issue);
        audit("task.continue", `#${plan.issue}`, plan.issue);
        return { text: ok(`#${esc(plan.issue)} re-queued (agent-ready).`) };
      } catch (e) {
        return { text: err(`Could not continue #${plan.issue}: ${e instanceof Error ? e.message : "error"}`) };
      }

    case "cancel":
      (await fleetLib()).appendCommand({ cmd: "cancel", issue: plan.issue });
      audit("task.cancel", `#${plan.issue}`, plan.issue);
      return { text: ok(`Cancel requested for #${esc(plan.issue)}.`) };

    case "priority":
      (await fleetLib()).prioritizeIssue(plan.issue, plan.level === "high");
      audit("task.priority", `#${plan.issue} ${plan.level}`, plan.issue);
      return { text: ok(`#${esc(plan.issue)} priority → <b>${esc(plan.level)}</b>.`) };

    // ── token optimization ──
    case "usage":
      return { text: warn(`Usage: ${plan.hint}`) };
    case "tokens":
      return tokensReply(plan.costs);
    case "budget":
      return budgetReply();
    case "savings":
      return savingsReply();
    case "expensive":
      return expensiveReply();
    case "optimize":
      return optimizeReply();

    case "set_token_mode": {
      // permission layer already ran above (medium risk → allowed + audited for the trusted operator);
      // setGlobalMode is the authoritative gate: "emergency" NEVER switches directly — it parks an approval.
      try {
        const r = setGlobalMode(plan.mode, "phone", "telegram");
        if (r.needs_approval) {
          audit("tokens.setmode", `${plan.mode} requested → approval ${r.approval_id ?? "?"}`);
          return {
            text: warn(`Emergency mode needs approval — created ${r.approval_id ? r.approval_id.slice(0, 8) : "?"}. Mode stays ${r.mode}.`),
            buttons: r.approval_id
              ? [[{ text: "✅ Approve", data: `apv:${r.approval_id}:approve` }, { text: "✖️ Reject", data: `apv:${r.approval_id}:reject` }]]
              : undefined,
          };
        }
        audit("tokens.setmode", r.mode);
        return { text: ok(`Token mode → ${r.mode}`) };
      } catch {
        return { text: warn("Usage: /setmode economy|balanced|high_quality|emergency") };
      }
    }

    case "recommendation_button": {
      // one-tap apply/dismiss from the /optimize card. Mutating → went through enforce() above
      // (medium risk, audited). Apply only ever writes policy through the validated budget-manager.
      const rec = getRecommendation(plan.id);
      if (!rec) return { text: err("That recommendation no longer exists.") };
      if (rec.status !== "open") return { text: warn(`Already ${rec.status}.`) };
      setRecommendationStatus(plan.id, plan.choice === "apply" ? "applied" : "dismissed", actor, "telegram");
      if (plan.choice === "dismiss") return { text: ok("Recommendation dismissed.") };
      return { text: info("✅ Recommendation applied", [`<b>${esc(redact(rec.title))}</b>`, appliedNote(rec.rule)]) };
    }

    case "approve_cost": {
      // resolve the pending budget escalation whose id starts with the given prefix (≥6 chars, enforced
      // by the router), then approve it through the exact same decide path the inline buttons use.
      const matches = listApprovals(200).filter(
        (a) => a.kind === "escalation" && a.risk === "budget" && a.id.toLowerCase().startsWith(plan.idPrefix),
      );
      const pending = matches.filter((a) => a.status === "pending");
      if (!pending.length)
        return { text: matches.length ? warn("That budget approval was already decided.") : err("No budget approval found for that id.") };
      if (pending.length > 1) return { text: warn("That id prefix matches several approvals — send more characters.") };
      audit("tokens.approve_cost", pending[0].id);
      return decideReply(pending[0].id, "approve", actor);
    }

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
    // `a` was fetched BEFORE deciding → a.status is the pre-decision status. decideApproval is idempotent, so
    // guard the side effects on the real pending→decided transition (a re-tapped inline button must not replay
    // the action / re-block the work item).
    const first = a.status === "pending";
    if (action === "pause") {
      const paused = decideApproval(id, "reject", { via: "telegram", by: actor, trusted: true, reason: "paused via phone" });
      // an escalation is a pure question — dismiss it, but never cancel the underlying issue's work.
      const cancelled = !!a.issue && a.kind !== "escalation";
      if (cancelled) (await fleetLib()).appendCommand({ cmd: "cancel", issue: a.issue! });
      if (first) { handlePlanRejection(paused, actor); handleWorkflowRejection(paused, actor); handleDecompositionRejection(paused, actor); } // a paused plan/step/decomposition → block + feedback
      return { text: ok(cancelled ? `Paused #${esc(a.issue!)} and dismissed the approval.` : "Dismissed the approval.") };
    }
    const decided = decideApproval(id, action, { via: "telegram", by: actor, trusted: true });
    if (action === "reject" && first) { handlePlanRejection(decided, actor); handleWorkflowRejection(decided, actor); handleDecompositionRejection(decided, actor); learnFromRejection(decided, actor); } // rejected plan/step/decomposition → block + feedback + persisted lesson for the agent
    if (action === "approve") {
      if (!first) return { text: warn("Already decided.") }; // idempotent re-approve: never re-run the action
      const { runApprovalAction } = await import("./actions.ts");
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
    const { createAgentTask } = await githubLib();
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
