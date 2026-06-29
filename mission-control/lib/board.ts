import "server-only";
import { listFleetIssues, listOpenPulls } from "./github";
import { getFleetTasks } from "./supabase";
import { deriveColumn, type BoardCard } from "./types";

/** Board snapshot: GitHub decides which cards exist + the column;
 *  Supabase enriches with live phase/model/verdict. GitHub wins when in doubt. */
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

  return issues
    .filter((i) => i.state === "open" || i.labels.includes("agent-done"))
    .map((i): BoardCard => {
      const t = taskByIssue.get(i.number) ?? null;
      const pr = prByIssue.get(i.number) ?? null;
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
      };
    });
}
