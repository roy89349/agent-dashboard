# Visual PR Approval — shell half (sandbox screenshots → dashboard)

After the green gate passes **inside the sandbox**, the fleet captures screenshot(s) of the
*built* app and the host worker POSTs the first screenshot plus a diff summary to the Mission
Control dashboard right after the PR is created. You approve PRs by *looking at the app*, not
just the diff. (The dashboard side — `POST /api/fleet/pr-visual` and the UI — is documented with
mission-control.)

**Hard rules baked into the implementation:**

- **A build NEVER fails because of screenshots.** Every step is best-effort (`|| true`, guarded,
  `screenshot.cjs` always exits 0). Worst case you simply get a PR without a picture.
- **Sellable:** no external services, no API keys, no meters. Playwright-core + Chromium ship
  *inside* the sandbox image.
- **Isolation unchanged:** no new host mounts, no secrets in the container. Screenshots are
  written into the already-mounted worktree (`.fleet-screens/`); the dashboard token stays on
  the host.

---

## How it works

```
pipeline.sh (SANDBOX, after the green gate)                 worker.sh (HOST, after gh pr create)
  FLEET_SCREENSHOT=on?                                        .fleet-screens/*.png present?
  ├─ PORT=$SCREENSHOT_PORT  $SCREENSHOT_START_CMD  &          ├─ token = MC_WATCHDOG_TOKEN
  ├─ wait ≤$SCREENSHOT_WAIT_SEC for curl :$SCREENSHOT_PORT    │   (grepped from $MC_ENV_FILE on
  ├─ node /screenshot.cjs  <base-url> $SCREENSHOT_PATHS \     │    the HOST — never in the sandbox)
  │        /work/.fleet-screens        (full-page PNGs)       ├─ diffstat + changed-file list
  └─ kill the server            (ALL best-effort)             ├─ curl -F screenshot=@first.png …
                                                              │        $MC_URL/api/fleet/pr-visual
worker.sh keeps .fleet-screens OUT of the PR:                 └─ emit pr-visual sent/failed/skipped
  git add -A  →  git rm --cached .fleet-screens  →  gates → commit
```

Pieces:

| File | Role |
|---|---|
| `deploy/sandbox/Containerfile` | ships `playwright-core` (global) + its pinned Chromium at `/ms-playwright` |
| `deploy/sandbox/screenshot.cjs` | mounted ro into the container; full-page PNG per path; always exits 0 |
| `deploy/sandbox/pipeline.sh` | starts/stops the app server around `screenshot.cjs`, after the green gate |
| `deploy/sandbox/run-build.sh` | passes the `SCREENSHOT_*` env into the container, mounts `screenshot.cjs` |
| `worker.sh` | excludes `.fleet-screens` from the commit; POSTs PNG + diff summary post-PR |
| `lib.sh` (`mc_watchdog_token`) | host-only token read from `$MC_ENV_FILE` |

Why playwright-core's Chromium and not the Debian `chromium` package: playwright only guarantees
protocol compatibility with the exact browser build it ships, so
`npx playwright-core install --with-deps chromium` at image-build time is reproducible (pinned by
the resolved playwright-core version) and needs no `executablePath` plumbing; a distro chromium
drifts independently and can break the CDP contract. Browsers land in `/ms-playwright`
(`PLAYWRIGHT_BROWSERS_PATH`, world-readable) so the non-root runtime uid finds them on the
read-only container filesystem. Chromium runs with `chromiumSandbox:false` — the rootless podman
container has no privileges for Chromium's own sandbox; isolation comes from the container.

## Configuration (config.env — override in config.local.env)

| Variable | Default | Meaning |
|---|---|---|
| `FLEET_SCREENSHOT` | `off` | `on` = capture screenshots after the green gate (needs the playwright-enabled image) |
| `SCREENSHOT_PATHS` | `/` | comma-separated URL paths to capture; the **first** one is what gets POSTed |
| `SCREENSHOT_START_CMD` | `npm run start` | command that serves the BUILT app inside the sandbox (gets `PORT` in env) |
| `SCREENSHOT_PORT` | `3000` | port that command listens on |
| `SCREENSHOT_WAIT_SEC` | `25` | max seconds to wait for the app to respond |
| `MC_URL` | `http://127.0.0.1:3000` | where the dashboard listens |
| `MC_ENV_FILE` | `mission-control/.env.local` | host-side source of `MC_WATCHDOG_TOKEN` |

## Enabling it

```bash
# 1. rebuild the sandbox image (on the machine that runs the fleet — the VPS):
deploy/sandbox/build-image.sh

# 2. flip the flag in config.local.env:
FLEET_SCREENSHOT=on

# 3. (per project, if needed) set SCREENSHOT_START_CMD / SCREENSHOT_PORT / SCREENSHOT_PATHS
```

## Degradation behavior (every rung is non-fatal)

| Situation | Result |
|---|---|
| `FLEET_SCREENSHOT=off` (default) | nothing happens — pipeline and worker behave exactly as before |
| flag on, old image (no playwright) | pipeline logs a skip hint (`rebuild via build-image.sh`), build continues |
| app doesn't come up within `SCREENSHOT_WAIT_SEC` | pipeline logs the server log tail, skips, build continues |
| a path fails to render | `screenshot.cjs` warns, captures the rest, exits 0 |
| no PNG produced | worker emits `pr-visual {status:skipped, reason:no-screenshot}` |
| no `MC_WATCHDOG_TOKEN` in `$MC_ENV_FILE` | worker emits `pr-visual {status:skipped, reason:no-token}` |
| dashboard down / POST fails (30s cap) | worker emits `pr-visual {status:failed}` — PR is already open, task still succeeds |

Screenshots never land in the PR: `worker.sh` unstages `.fleet-screens` right after `git add -A`,
before the no-change check, the secret-gate and the commit; the leftover files are wiped with the
worktree at cleanup.

---

# Visual PR Approval — Dashboard half

> This is the DASHBOARD half of the feature. The shell/worker half is documented separately
> (`docs/visual-pr-approval.md`, written by the worker-side change); the orchestrator merges the two.

## What it does

Right after the fleet worker opens a PR, it POSTs a screenshot + PR metadata to Mission Control.
The dashboard then:

1. stores the screenshot at `$FLEET_DIR/data/screenshots/pr-<pr>.png` (file `0600`, dir `0700`, overwritten on re-POST),
2. derives a merge **risk** (`low|medium|high|critical`) from the changed file paths using the SAME
   path rules as the central permission layer (`detectRisk` with a `merge` action carrying the files —
   auth/session/secret/CI paths escalate to critical; a PR with no file list fail-closes to high),
3. creates **one deduped pending `merge` approval per PR** (a worker retry reuses the pending approval —
   no duplicate cards), with a redacted + compressed diff preview (≤ ~900 chars) and the reviewer
   verdict as advice; approving it runs the existing merge executor (`{type:"merge", pr}`, branch deleted),
4. pushes to Telegram: first the **photo** (caption: title + PR # + risk + verdict, HTML-escaped),
   then the **existing approval card** with Approve / Reject / More info / Manager / Pause buttons —
   one tap on the phone approves + merges.

If the phone is not configured, the approval is still created and the response carries `phone: "not_configured"`.

## Endpoint: `POST /api/fleet/pr-visual`

- Runtime: `nodejs`. Exempted from the session proxy (already listed in `proxy.ts` SELF_AUTHED).
- **Auth (fail-closed 401):** a dashboard session cookie OR header `X-Watchdog-Token: $MC_WATCHDOG_TOKEN`
  (the same self-auth pattern as `/api/fleet/watchdog`).
- **Body: `multipart/form-data`** with these field names (the exact contract the worker must send):

| field        | type            | required | notes |
|--------------|-----------------|----------|-------|
| `screenshot` | file (PNG)      | yes      | ≤ 5 MB (5 242 880 bytes); bigger → `413` |
| `pr`         | text (int)      | yes      | plain positive integer; anything else → `400` |
| `issue`      | text (int)      | no       | linked issue number |
| `title`      | text            | no       | PR title (used in the approval summary + photo caption) |
| `verdict`    | text            | no       | reviewer verdict line (e.g. `approve` / `caution: …`) |
| `diffstat`   | text            | no       | `git diff --stat` / short diff text; redacted + compressed into the approval preview |
| `files`      | text            | no       | newline-separated changed file paths (drives risk detection; omit ⇒ fail-closed high) |

Example (worker side):

```sh
curl -sS -X POST "$MC_URL/api/fleet/pr-visual" \
  -H "X-Watchdog-Token: $MC_WATCHDOG_TOKEN" \
  -F "screenshot=@/tmp/pr-41.png;type=image/png" \
  -F "pr=41" -F "issue=12" \
  -F "title=Add board filter" \
  -F "verdict=approve" \
  -F "diffstat=$(git diff --stat main...HEAD)" \
  -F "files=$(git diff --name-only main...HEAD)"
```

- **Response:** `{ ok: true, approval_id, risk, phone, created, approval }` where
  `phone` ∈ `sent | card_only | failed | skipped_duplicate | not_configured` and
  `created` is `false` when a pending merge approval for that PR already existed (deduped re-POST;
  nothing is re-sent to the phone).
- **Audit:** every accepted POST records `pr.visual` (actor `fleet-worker`, related PR, risk level).

## Endpoint: `GET /api/fleet/pr-visual?pr=<n>`

Streams the stored PNG (`image/png`, `cache-control: private, no-store`). **Session-authed ONLY** —
the watchdog token is intake-only and never grants read-back. `404` when no screenshot exists.

## Dashboard touch

`getBoard()` sets `hasScreenshot` on each card (a cheap `fs.existsSync` on the canonical path); the
board task card shows a small "📸 screenshot" link opening `GET /api/fleet/pr-visual?pr=<n>` when
the card has a PR and a stored screenshot.

## Provider addition

`PhoneProvider.sendPhoto` is a new **optional** method (other/future providers stay valid without it).
The Telegram implementation multipart-uploads to `sendPhoto` with an HTML caption (caller pre-escapes
via `esc()`), optional inline keyboard, and never throws (same `PhoneResult` contract as `sendMessage`).

## Files

- `lib/pr-visual.ts` — pure, testable logic (paths, size guard, risk, preview, deduped approval, caption)
- `lib/pr-visual.test.ts` — `node --test` suite (temp `FLEET_DIR`)
- `app/api/fleet/pr-visual/route.ts` — thin POST/GET route
- `lib/phone/types.ts`, `lib/phone/telegram.ts` — optional `sendPhoto`
- `lib/board.ts`, `lib/types.ts`, `components/task-card.tsx` — `hasScreenshot` flag + link
