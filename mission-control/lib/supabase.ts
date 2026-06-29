import "server-only";
import { createClient as createSb } from "@supabase/supabase-js";
import type { FleetTask } from "./types";

/**
 * Server-side Supabase read for the telemetry layer. Uses the ANON key of the
 * SEPARATE mission-control project (NEVER the production service-role key, NEVER
 * the production Supabase). RLS does not allow anon SELECT; we therefore read
 * server-side behind the mc_session cookie and give the browser no direct
 * Supabase access. This way telemetry never leaks publicly.
 */
function sb() {
  return createSb(
    process.env.SUPABASE_MC_URL!,
    process.env.SUPABASE_MC_ANON_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function getFleetTasks(): Promise<FleetTask[]> {
  // Telemetry is enrichment, not a source of truth: if the mission-control
  // Supabase project is not (yet) configured, the board works GitHub-only.
  try {
    if (!process.env.SUPABASE_MC_URL || !process.env.SUPABASE_MC_ANON_KEY) return [];
    const { data } = await sb()
      .from("fleet_tasks")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(200);
    return (data ?? []) as FleetTask[];
  } catch {
    return [];
  }
}
