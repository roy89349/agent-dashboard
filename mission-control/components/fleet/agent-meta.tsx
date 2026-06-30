"use client";
// Shared "who-does-what" visuals for the board cards + worker lanes: an initials avatar coloured by
// role, a role chip, a team badge, a risk badge and a waiting-for-approval badge. All render nothing
// when the metadata is absent, so old cards/slots keep their previous look.
import { ShieldAlert, ShieldCheck, ShieldQuestion, Clock3 } from "lucide-react";
import { Badge, BADGE_TONE, type Tone } from "@/components/ui/badge";
import { roleTone, teamTone, initials } from "@/lib/team";

export function AgentAvatar({ name, role, className = "" }: { name?: string | null; role?: string | null; className?: string }) {
  return (
    <span
      title={name ?? role ?? undefined}
      className={`grid size-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${BADGE_TONE[roleTone(role)]} ${className}`}
    >
      {initials(name ?? role)}
    </span>
  );
}

export function RoleChip({ role }: { role?: string | null }) {
  if (!role) return null;
  return (
    <Badge tone={roleTone(role)} className="capitalize">
      {role}
    </Badge>
  );
}

export function TeamBadge({ teamId, teamName }: { teamId?: string | null; teamName?: string | null }) {
  if (!teamName) return null;
  return <Badge tone={teamTone(teamId)}>{teamName}</Badge>;
}

export function RiskBadge({ level }: { level?: string | null }) {
  if (!level || level === "none") return null;
  const tone: Tone = level === "high" ? "red" : level === "low" ? "emerald" : "amber";
  const Icon = level === "high" ? ShieldAlert : level === "low" ? ShieldCheck : ShieldQuestion;
  return (
    <Badge tone={tone}>
      <Icon className="size-3" /> {level} risk
    </Badge>
  );
}

export function WaitingBadge() {
  return (
    <Badge tone="amber">
      <Clock3 className="size-3" /> waiting approval
    </Badge>
  );
}

/** Avatar + role chip (+ optional team badge) on one line. Renders null with no role/agent. */
export function AgentIdentity({
  role, agentName, teamId, teamName, showTeam = true,
}: {
  role?: string | null; agentName?: string | null; teamId?: string | null; teamName?: string | null; showTeam?: boolean;
}) {
  if (!role && !agentName) return null;
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <AgentAvatar name={agentName} role={role} />
      <RoleChip role={role} />
      {showTeam && <TeamBadge teamId={teamId} teamName={teamName} />}
    </div>
  );
}
