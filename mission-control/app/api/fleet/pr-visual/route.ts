import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import fs from "node:fs";
import { verifySession } from "@/lib/session";
import { recordAudit } from "@/lib/db";
import { publicApproval } from "@/lib/approvals";
import {
  MAX_SCREENSHOT_BYTES,
  parsePrNumber,
  parseFileList,
  saveScreenshot,
  screenshotPath,
  ensureMergeApproval,
  photoCaption,
} from "@/lib/pr-visual";
import { getProvider, isPhoneConfigured } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Visual PR approval intake: the fleet worker POSTs (multipart) a screenshot + PR metadata right
// after opening a PR. We store the PNG, derive risk from the changed files via the permission-layer
// path rules, create ONE deduped merge approval, and push photo + approval card to the phone.
// Auth (same pattern as /api/fleet/watchdog, fail-closed): a dashboard session OR the internal
// X-Watchdog-Token (MC_WATCHDOG_TOKEN) so the shell worker can call it without a browser session.
async function tokenOrSession(req: Request): Promise<boolean> {
  const tok = (process.env.MC_WATCHDOG_TOKEN ?? "").trim();
  if (tok && req.headers.get("x-watchdog-token") === tok) return true;
  return sessionOnly();
}
async function sessionOnly(): Promise<boolean> {
  const c = await cookies();
  return verifySession(c.get("mc_session")?.value, process.env.MC_SESSION_SECRET!);
}
const bad = (status: number, error: string) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  if (!(await tokenOrSession(req))) return bad(401, "unauthorized");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad(400, "expected multipart/form-data");
  }

  const pr = parsePrNumber(form.get("pr"));
  if (!pr) return bad(400, "pr (positive integer) required");
  const shot = form.get("screenshot");
  if (!(shot instanceof Blob) || shot.size === 0) return bad(400, "screenshot (PNG file) required");
  if (shot.size > MAX_SCREENSHOT_BYTES) return bad(413, `screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes`);

  const issue = parsePrNumber(form.get("issue")); // same strict int parse; null when absent/invalid
  const title = typeof form.get("title") === "string" ? String(form.get("title")).slice(0, 300) : null;
  const verdict = typeof form.get("verdict") === "string" ? String(form.get("verdict")).slice(0, 200) : null;
  const diffstat = typeof form.get("diffstat") === "string" ? String(form.get("diffstat")).slice(0, 200_000) : null;
  const files = parseFileList(typeof form.get("files") === "string" ? String(form.get("files")) : "");

  const png = Buffer.from(await shot.arrayBuffer());
  try {
    saveScreenshot(pr, png); // overwrite on re-POST; 0600 file / 0700 dir
  } catch (e) {
    return bad(500, e instanceof Error ? e.message : "could not store screenshot");
  }

  const input = { pr, issue, title, verdict, diffstat, files };
  const { approval, created, risk } = ensureMergeApproval(input);

  // Phone push: PHOTO first, then the EXISTING approval card (Approve/Reject buttons live there).
  // Only on a NEWLY created approval — a deduped re-POST must not spam duplicate cards.
  let phone = "not_configured";
  if (isPhoneConfigured()) {
    if (created) {
      const p = getProvider()!;
      const photoRes = p.sendPhoto
        ? await p.sendPhoto(png, { caption: photoCaption(input, risk), filename: `pr-${pr}.png` })
        : { ok: false as const, error: "provider has no sendPhoto" };
      const cardRes = await p.sendApprovalRequest(approval);
      phone = photoRes.ok && cardRes.ok ? "sent" : cardRes.ok ? "card_only" : "failed";
    } else {
      phone = "skipped_duplicate";
    }
  }

  recordAudit({
    via: "api",
    actor: "fleet-worker",
    action: "pr.visual",
    kind: "merge",
    approval_id: approval.id,
    issue: issue ?? approval.issue,
    detail: `PR #${pr} screenshot received · risk=${risk} · approval ${created ? "created" : "reused"} · phone=${phone}`,
    status: "pending_approval",
    risk_level: risk,
    target_type: "approval",
    related_pr: pr,
  });

  return NextResponse.json({
    ok: true,
    approval_id: approval.id,
    risk,
    phone,
    created,
    approval: publicApproval(approval),
  });
}

// Serve the stored screenshot to the dashboard. SESSION-authed ONLY — never the worker token
// (the token is for machine intake, not for reading artifacts back out).
export async function GET(req: Request) {
  if (!(await sessionOnly())) return bad(401, "unauthorized");
  const pr = parsePrNumber(new URL(req.url).searchParams.get("pr"));
  if (!pr) return bad(400, "pr (positive integer) required");
  let buf: Buffer;
  try {
    buf = fs.readFileSync(screenshotPath(pr));
  } catch {
    return bad(404, "no screenshot for this PR");
  }
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "content-type": "image/png",
      "content-length": String(buf.length),
      "cache-control": "private, no-store",
    },
  });
}
