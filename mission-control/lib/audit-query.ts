// Shared: build an AuditFilter from URL search params (used by the /api/audit routes). Kept tiny + pure.
import type { AuditFilter } from "./audit.ts";

export function filterFromParams(q: URLSearchParams): AuditFilter {
  const s = (k: string) => { const v = q.get(k); return v && v.trim() ? v.trim() : undefined; };
  const n = (k: string) => { const v = q.get(k); return v && Number.isFinite(Number(v)) ? Number(v) : undefined; };
  return {
    actor_id: s("actor_id"), actor_type: s("actor_type"), action: s("action"), risk_level: s("risk_level"),
    status: s("status"), source: s("source"), agent_id: s("agent_id"), work_item_id: s("work_item_id"),
    workflow_id: s("workflow_id"), approval_id: s("approval_id"), from: s("from"), to: s("to"), q: s("q"),
    limit: n("limit"), offset: n("offset"),
  };
}
