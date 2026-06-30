import { Badge, type Tone } from "@/components/ui/badge";
import type { Autonomy } from "@/lib/types";

const TONE: Record<Autonomy, Tone> = { suggest: "slate", review: "indigo", auto: "amber", full: "red" };
const LABEL: Record<Autonomy, string> = { suggest: "suggest", review: "review", auto: "auto", full: "auto-merge" };

export function AutonomyBadge({ level }: { level: Autonomy }) {
  return <Badge tone={TONE[level]}>{LABEL[level]}</Badge>;
}
