import "server-only";
import type { GitHubIssue, GitHubPull } from "./types";

const REPO = process.env.GITHUB_REPO ?? ""; // owner/repo — set per install (setup.sh / .env.local)
const TOKEN = process.env.GITHUB_TOKEN ?? ""; // fine-grained PAT: Contents/Issues/PR write. NO admin/merge/workflow.
const API = "https://api.github.com";

function gh(path: string, init: RequestInit = {}) {
  return fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

const FLEET_LABELS = ["agent-ready", "agent-wip", "agent-done", "agent-failed"];

export async function listFleetIssues(): Promise<GitHubIssue[]> {
  const res = await gh(
    `/repos/${REPO}/issues?state=all&per_page=100&sort=updated&direction=desc`,
  );
  if (!res.ok) throw new Error(`GitHub issues ${res.status}`);
  const raw = (await res.json()) as any[];
  return raw
    .filter((i) => !i.pull_request)
    .map((i) => ({
      number: i.number,
      title: i.title,
      body: i.body,
      labels: (i.labels ?? []).map((l: any) => (typeof l === "string" ? l : l.name)),
      html_url: i.html_url,
      created_at: i.created_at,
      state: i.state,
    }))
    .filter((i) => i.labels.some((l: string) => FLEET_LABELS.includes(l)));
}

export async function listOpenPulls(): Promise<GitHubPull[]> {
  const res = await gh(`/repos/${REPO}/pulls?state=open&per_page=100`);
  if (!res.ok) throw new Error(`GitHub pulls ${res.status}`);
  const raw = (await res.json()) as any[];
  return raw.map((p) => {
    const m = (p.body ?? "").match(/closes\s+#(\d+)/i);
    return {
      number: p.number,
      issue: m ? Number(m[1]) : null,
      title: p.title,
      html_url: p.html_url,
      head: p.head?.ref ?? "",
      draft: !!p.draft,
      created_at: p.created_at,
    };
  });
}

/** Taakintake: NL-tekst -> issue met label agent-ready (+ optionele extra labels, bv. een rol). */
export async function createAgentTask(input: {
  title: string;
  body?: string;
  labels?: string[];
  source?: string;
}): Promise<{ number: number; url: string }> {
  const labels = ["agent-ready", ...(input.labels ?? [])]
    .map((l) => String(l).trim())
    .filter((l) => /^[A-Za-z0-9 ._-]{1,50}$/.test(l)) // safe label names only
    .filter((l, i, a) => a.indexOf(l) === i)
    .slice(0, 8);
  const res = await gh(`/repos/${REPO}/issues`, {
    method: "POST",
    body: JSON.stringify({
      title: input.title.trim().slice(0, 240),
      body:
        (input.body?.trim() ? input.body.trim() + "\n\n" : "") +
        `— Created via Mission Control${input.source ? ` (${input.source})` : ""}.`,
      labels,
    }),
  });
  if (!res.ok) throw new Error(`GitHub create issue ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { number: j.number, url: j.html_url };
}

/** Opnieuw proberen na fail/cancel: relabel agent-failed|agent-cancelled → agent-ready. */
export async function requeueIssue(issue: number): Promise<void> {
  await gh(`/repos/${REPO}/issues/${issue}/labels/agent-failed`, { method: "DELETE" }).catch(() => {});
  await gh(`/repos/${REPO}/issues/${issue}/labels/agent-cancelled`, { method: "DELETE" }).catch(() => {});
  const res = await gh(`/repos/${REPO}/issues/${issue}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: ["agent-ready"] }),
  });
  if (!res.ok) throw new Error(`requeue ${res.status}: ${await res.text()}`);
}

/** Withdraw a pending (not-yet-claimed) task: remove agent-ready, set agent-cancelled. */
export async function cancelQueuedIssue(issue: number): Promise<void> {
  await gh(`/repos/${REPO}/issues/${issue}/labels/agent-ready`, { method: "DELETE" }).catch(() => {});
  const res = await gh(`/repos/${REPO}/issues/${issue}/labels`, {
    method: "POST",
    body: JSON.stringify({ labels: ["agent-cancelled"] }),
  });
  if (!res.ok) throw new Error(`cancel-queued ${res.status}: ${await res.text()}`);
}

/** One-click squash-merge. Enige merge-pad; agents mergen nooit. main is protected. */
export async function mergePull(
  prNumber: number,
  opts: { deleteBranch?: boolean } = {},
): Promise<{ merged: boolean; message: string }> {
  const res = await gh(`/repos/${REPO}/pulls/${prNumber}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash" }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { merged: false, message: j.message ?? `merge ${res.status}` };
  if (opts.deleteBranch) {
    const pr = await gh(`/repos/${REPO}/pulls/${prNumber}`).then((r) => r.json());
    const ref = pr?.head?.ref;
    if (ref)
      await gh(`/repos/${REPO}/git/refs/heads/${ref}`, { method: "DELETE" }).catch(() => {});
  }
  return { merged: true, message: j.message ?? "merged" };
}
