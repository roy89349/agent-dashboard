// Central secret-redaction for anything that leaves the server (phone messages, approval previews,
// audit log). Mirrors redact() in lib/fleet.ts and SECRET_RE in lib.sh — keep the three in sync.
// Pure (no node/server imports) so it can run anywhere, including tests.

export function redact(s: string): string {
  let r = s;
  r = r.replace(/sk-ant-[A-Za-z0-9_-]{8,}/g, "«REDACTED-anthropic»");
  r = r.replace(/github_pat_[A-Za-z0-9_]{20,}/g, "«REDACTED-github-pat»");
  r = r.replace(/\bgh[opsu]_[A-Za-z0-9]{8,}\b/g, "«REDACTED-github»");
  r = r.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi, "«REDACTED-url-credential»@");
  r = r.replace(/\bAKIA[0-9A-Z]{16}\b/g, "«REDACTED-aws»");
  r = r.replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, "«REDACTED-jwt»");
  r = r.replace(
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "«REDACTED-private-key»",
  );
  r = r.replace(/^.*(TIKTOK_CLIENT_SECRET|SUPABASE_SERVICE_ROLE|service_role).*$/gm, "«REDACTED-line»");
  return r;
}

/** Redact + clamp to a phone-safe length. Never send full sensitive diffs to a chat app. */
export function redactPreview(s: string, maxLen = 900): string {
  const r = redact(s);
  return r.length > maxLen ? r.slice(0, maxLen) + "\n… (truncated — open the dashboard for the full diff)" : r;
}
