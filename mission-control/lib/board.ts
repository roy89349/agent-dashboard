import "server-only";
import { listFleetIssues, listOpenPulls } from "./github";
import { getFleetTasks } from "./supabase";
import { readStatus } from "./fleet";
import { listPendingApprovals } from "./approvals";
import { riskLevel } from "./approvals-view";
import { screenshotExists } from "./pr-visual";
import { teamForRole } from "./team";
import { deriveColumn, type BoardCard } from "./types";

/** Board snapshot: GitHub decides which cards exist + the column; Supabase enriches with live
 *  phase/model/verdict; the live slot adds who-does-what (agent/role/team); a pending approval marks
 *  the card as waiting + its risk. GitHub wins when in doubt; every enrichment is fail-soft. */
export async function getBoard(): Promise<BoardCard[]> {
  // Fail-soft: the board is enrichment. If GitHub is unreachable/misconfigured,
  // the dashboard must NOT crash — live control works without GitHub. Empty board.
  const [issues, pulls, tasks] = await Promise.all([
    listFleetIssues().catch(() => []),
    listOpenPulls().catch(() => []),
    getFleetTasks(),
  ]);

  const taskByIssue = new Map(tasks.map((t) => [t.issue, t]));
  const prByIssue = new Map(
    pulls.filter((p) => p.issue != null).map((p) => [p.issue!, p]),
  );
  // who-does-what comes from the live slot (the actual running agent); approvals add waiting + risk.
  const slotByIssue = new Map(
    (readStatus()?.slots ?? []).filter((s) => s.issue != null).map((s) => [s.issue as number, s]),
  );
  let pendByIssue = new Map<number, { kind: string; risk: string | null }>();
  try {
    pendByIssue = new Map(
      listPendingApprovals().filter((a) => a.issue != null).map((a) => [a.issue as number, { kind: a.kind, risk: a.risk }]),
    );
  } catch {
    /* approvals store unavailable → no waiting flags, cards still render */
  }

  return issues
    .filter((i) => i.state === "open" || i.labels.includes("agent-done"))
    .map((i): BoardCard => {
      const t = taskByIssue.get(i.number) ?? null;
      const pr = prByIssue.get(i.number) ?? null;
      const slot = slotByIssue.get(i.number);
      const pend = pendByIssue.get(i.number);
      const role = slot?.role ?? null;
      const team = teamForRole(role);
      return {
        issue: i.number,
        title: i.title,
        column: deriveColumn(i.labels, t?.state ?? null, !!pr),
        labels: i.labels,
        issueUrl: i.html_url,
        state: t?.state ?? null,
        model: t?.model ?? null,
        branch: t?.branch ?? pr?.head ?? null,
        prUrl: t?.pr_url ?? pr?.html_url ?? null,
        prNumber: pr?.number ?? null,
        reviewVerdict: t?.review_verdict ?? null,
        error: t?.error ?? null,
        updatedAt: t?.updated_at ?? i.created_at,
        role,
        agentId: slot?.agent_id ?? null,
        agentName: slot?.agent_name ?? null,
        teamId: team?.id ?? null,
        teamName: team?.name ?? null,
        riskLevel: pend ? riskLevel(pend) : null,
        awaitingApproval: !!pend,
        hasScreenshot: pr ? screenshotExists(pr.number) : false,
      };
    });
}
