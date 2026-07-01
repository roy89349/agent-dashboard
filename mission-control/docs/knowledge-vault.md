# Knowledge Vault (the project brain)

Agents shouldn't work blind. The Knowledge Vault is a **secure, searchable metadata index** of project knowledge —
rules, coding standards, product vision, business goals, API docs, old decisions, customer requirements,
architecture notes, security rules and **team instructions** — linkable to teams/agents. It's additive on the
existing `/kennis` vault browser (which stays intact). **Security is the #1 rule**: secret files are never
indexed, every stored preview is redacted + secret-scrubbed, and access is restrictable per team/agent.

---

## What was built
- **`knowledge_items`** table + **`lib/knowledge-index.ts`** (the testable core; the Obsidian vault reader stays
  in `lib/knowledge.ts`, which re-exports the index). Model: `id · title · type · source_path · source_url ·
  tags · project_id · team_id · summary · content_preview · allowed_agents · safe_to_use · archived · indexed_at
  · created/updated_at`.
- Services: `addKnowledgeSource · listKnowledgeItems · getKnowledgeItem · searchKnowledge · updateKnowledgeItem ·
  archiveKnowledgeItem · validateKnowledgeSafety` (+ `knowledgeForAgent/Team`, `agentMayUse`, `scrubSecrets`).
- **6 default team instructions** seeded: use the existing code style · always run tests · no new dependency
  without approval · make small PRs · explain risky choices · use the Phone Command Interface for blockers.
- API: `GET/POST /api/knowledge/items`, `GET/PATCH/DELETE /api/knowledge/items/[id]`. UI: the **`/kennis`** page is
  now tabbed — **Project brain** (search · filters by type/team/tag/agent · detail drawer with the allowed-agents/
  team selector + safe-to-use flag · add a note · reindex) + the original **Vault browser**.
- Integration: the **Communication Agent's "ask the team"** now also consults the vault (safe, access-scoped) and
  cites knowledge with a link.

## How I add sources
- **Reindex the vault** — set `VAULT_DIR` (in `config.local.env` + `mission-control/.env.local`) to a markdown/
  Obsidian folder, then click **Reindex** (or `POST /api/knowledge/items {kind:"folder"}`). The folder is walked
  (bounded), `.md/.markdown/.txt` files are indexed; **secret files are skipped and never read into an item**.
- **A single file** — `POST /api/knowledge/items {kind:"file", source_path:"rules.md", type, team_id}` (path
  confined to the vault; a denied secret path is rejected).
- **A manual note** — the **Add** button (or `{kind:"manual", title, type, content, tags, team_id}`). Content is
  redacted + secret-scrubbed before it's stored.
- Metadata (type, tags, team, **allowed agents/roles**, safe flag) is editable in the detail drawer.

## How agents use knowledge
- `searchKnowledge(query, {agent_id, role, team_id})` and `knowledgeForAgent/Team` return only items the agent may
  use — **access is enforced server-side**: empty `allowed_agents` = every agent; otherwise the agent's id or
  role must be listed. **Unsafe (secret-flagged) items are excluded from search/agent access by default.**
- Agents consult it via `GET /api/knowledge/items?q=…&agent_id=…&role=…` (session **or** `X-Agent-Token`; a token
  caller without an agent identity only sees public, safe items). The Communication Agent already queries it.
- (Manager/decisions/workflows can call the same `knowledgeForTeam`/search API to attach required knowledge — the
  hooks are exposed; deeper wiring is a follow-up.)

## Security rules
- **Never indexed** (path deny-list): `.env*`, `*.pem/*.key/*.p12/*.pfx/*.crt/*.jks`, `id_rsa/…`, `.ssh/.aws/.gnupg`,
  `.npmrc/.netrc/.pgpass`, `credentials*`, `secrets*`, anything with `password/token/apikey` in the name, `*.sqlite/
  *.db/*.log`. Only `.md/.markdown/.txt` are indexable; everything else is skipped. Symlinks are not followed.
- **Content secret detection** (`hasSecretContent`): private keys, AWS/Google/GitHub/Slack/`sk-` keys, JWTs, and
  `key=value` secrets → the item is stored with **`safe_to_use=0`** and its preview **secret-scrubbed**
  (`scrubSecrets` = `redact()` + the secret patterns). The raw secret never lands in `content_preview`/`summary`.
- **Nothing sensitive to the phone**: previews use `redactPreview`; the Communication integration only searches
  **safe** items, so a flagged item never reaches a summary/phone.
- **Per-team/agent access**: `allowed_agents` + `team_id` scope who may use an item, enforced in the query layer.

## Tests / build
```bash
cd mission-control
node --test --experimental-sqlite lib/knowledge-index.test.ts   # secret paths never indexable, secret content
                                                                # flagged + scrubbed, folder walk skips .env/keys,
                                                                # traversal blocked, team instructions, search +
                                                                # access control, unsafe excluded, update/archive
node --test --experimental-sqlite lib/*.test.ts                 # full suite → 144 green
npm run build                                                   # typecheck + Turbopack build → clean
```
