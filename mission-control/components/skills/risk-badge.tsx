import { ShieldCheck, Shield, ShieldAlert, AlertOctagon } from "lucide-react";
import { Badge, type Tone } from "@/components/ui/badge";
import type { SkillRisk } from "@/lib/types";

const RISK: Record<SkillRisk, { tone: Tone; icon: typeof Shield }> = {
  low: { tone: "emerald", icon: ShieldCheck },
  medium: { tone: "amber", icon: Shield },
  high: { tone: "red", icon: ShieldAlert },
  critical: { tone: "rose", icon: AlertOctagon },
};

export function RiskBadge({ risk }: { risk: SkillRisk }) {
  const r = RISK[risk] ?? RISK.low;
  const Icon = r.icon;
  return (
    <Badge tone={r.tone}>
      <Icon className="size-3" /> {risk}
    </Badge>
  );
}
