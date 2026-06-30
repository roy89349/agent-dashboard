# Reviewer & Security agents

Two config-driven agents now run during a build, sourced from `control/agents.json` (see
[`agents-registry.md`](agents-registry.md)):

- **Reviewer** — the `qa` agent. Comments on the PR. **Advisory** (the PR is already open; it never blocks).
- **Security** — the `security` agent. Runs **before** commit/push. **Blocking** by default: a reject ends the task.

Both are additive and backward compatible: with no registry / no such agent, the reviewer falls back
to its built-in prompt + `REVIEW_MODEL`, and the security phase is simply skipped — the existing
issue → worker → Claude → PR flow is unchanged.

---

## Where they sit in `worker.sh`

```
sandbox build → stage → secret-gate(regex) → ★ SECURITY-GATE ★ → green-gate → commit → push → PR → ☆ REVIEWER ☆
```

- **Secret-gate** (unchanged, deterministic regex): rejects `.env`/`.github/workflows` files and any
  `SECRET_RE` match in the diff.
- **Security-gate** (new): a *semantic* check on the staged diff — catches what the regex can't.
- **Reviewer** (migrated): runs after the PR is opened.

## Security agent — what it checks

Reads ONLY the staged diff (analysis, no code execution) and flags:
secrets / API keys / credential exposure · `.env` / config / secret-file changes · auth/authz changes ·
added or changed dependencies (supply-chain) · database schema / migration changes · GitHub Actions / workflow changes.

It answers a verdict: **APPROVE**, **CAUTION**, or **REJECT** (+ up to 5 bullets).

### Verdict → action (`security_decision`)

| verdict | blocking agent | non-blocking agent |
|---|---|---|
| `approve` | continue | continue |
| `caution` | continue (logged) | continue |
| `reject` | **`fail()`** | continue (advisory, logged) |
| `unknown` (unparseable) | **`fail()`** | continue (treated as caution) |

`blocking` comes from the agent's `blocking` field in `agents.json` (the default `security` agent is
`blocking: true`). The model is the agent's `model_default`, with the usual opus gate (falls back to
`sonnet` unless `ALLOW_GLOBAL_OPUS=1`).

### On a blocking reject

The worker calls the **existing** `fail()` — no new code path, no new label writer:
- the issue gets `agent-failed` (via `fail()` only — same single-writer invariant as every other failure),
- a `failed` event is emitted → it counts as **breaker fuel** (`consecutive_fails`),
- the verdict is visible: a `security` event/state is emitted (with `{verdict, blocking}`) and
  `set_phase security` shows in the Workers lane; the board keeps the card in **building** while
  `agent-wip`, then moves it to **review** on `agent-failed`.

## Reviewer agent (config-driven)

- Gated by `REVIEW` (config or `control/fleet.json` `review` — backward compatible live on/off).
- Model = `qa` agent `model_default` (opus-gated) → else `REVIEW_MODEL`.
- Prompt = the `qa` agent's `system_prompt_ref` file if it exists (`$FLEET_DIR/<ref>`) → else the
  built-in reviewer prompt.
- Posts a PR comment titled with the agent's `name`; verdict parsed via `parse_verdict`
  (approve/caution/reject; unknown → `reviewed`) and emitted as `reviewed`.

## Robust verdict parsing (`parse_verdict`)

`approve | caution | reject | unknown`. Prefers line 1 (the verdict line — emoji `✅/⚠️/❌` or the word),
falls back to scanning the whole text, severity `reject > caution > approve`. Unrecognised → `unknown`.

## Config (in `control/agents.json`)

The default team already ships a `qa` agent (advisory reviewer) and a `security` agent
(`blocking: true`, `model_default: opus`). To change behaviour, edit the agents (later: via the
dashboard): set `blocking` on/off, change the model, or disable an agent to skip its phase.

> Note (gap): the reviewer/security agents run `claude -p` on the host with default tools (like the
> original reviewer). The only untrusted input is the diff text; a blocking reject can only be
> *bypassed* (not escalated), and the regex secret-gate + human PR review remain. Restricting their
> tools / sandboxing them is tracked in the build journal.

## Testing

```bash
# Deterministic: parse_verdict, security_decision, secret-gate on safe vs risk fixtures
bash tests/security-agent.test.sh

# Live (server): a safe issue runs through the security phase (verdict approve) and still opens a PR;
# a reject is exercised by security_decision + the shared fail() path (both tested above).
gh issue create --repo <owner>/<repo> --label agent-ready \
  --title "docs: security-phase smoke test" --body "Append one harmless line to README.md."
./supervisor.sh --once
```
