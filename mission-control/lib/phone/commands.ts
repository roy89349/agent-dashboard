// PURE command router: turns an inbound message/button into a validated PLAN. NO side effects, NO
// shell-out, NO fleet/github imports — so it is fully unit-testable. The executor (lib/phone/execute.ts)
// runs a plan through the existing validated lib/* services. Authorization is enforced here first:
// an unknown sender can never produce an actionable plan.
import type { PhoneProvider, IncomingMessage } from "./types";

export type CommandPlan =
  | { kind: "unauthorized" }
  | { kind: "empty" }
  | { kind: "help" }
  | { kind: "status"; what: "status" | "fleet" | "agents" | "tasks" | "decisions" | "prs" }
  | { kind: "fleet_mode"; mode: "running" | "paused" | "stopped"; needsApproval: boolean }
  | { kind: "breaker_reset" }
  | { kind: "create_task"; title: string; role: string | null }
  | { kind: "free_text"; text: string }
  | { kind: "continue"; issue: number }
  | { kind: "cancel"; issue: number }
  | { kind: "priority"; issue: number; level: "high" | "normal" | "low" }
  | { kind: "decision"; approvalId: string; action: "approve" | "reject" | "info" | "manager" | "pause" }
  | { kind: "new_task_button"; approvalId: string; choice: "create" | "frontend" | "backend" | "qa" | "manager" | "cancel" }
  | { kind: "unknown"; text: string };

// roles that have a dedicated /<role> shortcut (still config-driven downstream via label_scope)
const ROLE_COMMANDS = new Set([
  "manager", "frontend", "backend", "qa", "security", "devops",
  "documentation", "kpi", "communication", "data", "designer", "architect",
]);

function intArg(s: string): number | null {
  const m = s.trim().match(/#?(\d{1,7})/);
  return m ? parseInt(m[1], 10) : null;
}

/** Parse + authorize an inbound event into a plan. `provider` supplies verifySender + parse. */
export function routeCommand(provider: PhoneProvider, incoming: IncomingMessage): CommandPlan {
  if (!provider.verifySender(incoming.chatId)) return { kind: "unauthorized" };

  // ── button presses ──
  if (incoming.isCallback) {
    const data = incoming.callbackData ?? "";
    let m = data.match(/^apv:([0-9a-fA-F-]{8,}):(approve|reject|info|manager|pause)$/);
    if (m) return { kind: "decision", approvalId: m[1], action: m[2] as "approve" };
    m = data.match(/^new:([0-9a-fA-F-]{8,}):(create|frontend|backend|qa|manager|cancel)$/);
    if (m) return { kind: "new_task_button", approvalId: m[1], choice: m[2] as "create" };
    return { kind: "unknown", text: data };
  }

  // ── text / slash commands ──
  const { command, args, raw } = provider.parseIncomingCommand(incoming.text);
  if (command === null) {
    if (!raw) return { kind: "empty" };
    return { kind: "free_text", text: raw }; // non-command → manager confirm flow
  }
  switch (command) {
    case "help":
    case "start": // Telegram's default first command → welcome/help (use /resume to resume the fleet)
      return { kind: "help" };
    case "status":
    case "fleet":
    case "agents":
    case "tasks":
    case "decisions":
    case "prs":
      return { kind: "status", what: command };
    case "pause":
      return { kind: "fleet_mode", mode: "paused", needsApproval: false };
    case "resume":
      return { kind: "fleet_mode", mode: "running", needsApproval: false };
    case "stop":
      // needsApproval is now ADVISORY (button-UX hint only); lib/permissions.ts is authoritative — execute.ts
      // runs every mutating verb through enforce(), which gates a fleet stop as high-risk → approval.
      return { kind: "fleet_mode", mode: "stopped", needsApproval: true };
    case "breaker_reset":
      return { kind: "breaker_reset" };
    case "prompt":
    case "task":
    case "goal":
      return args ? { kind: "create_task", title: args, role: null } : { kind: "help" };
    case "ask":
      return args ? { kind: "free_text", text: args } : { kind: "help" };
    case "assign": {
      const parts = args.split(/\s+/);
      const role = (parts.shift() ?? "").toLowerCase();
      const rest = parts.join(" ").trim();
      if (!role || !rest) return { kind: "help" };
      return { kind: "create_task", title: rest, role };
    }
    case "continue": {
      const n = intArg(args);
      return n ? { kind: "continue", issue: n } : { kind: "help" };
    }
    case "cancel": {
      const n = intArg(args);
      return n ? { kind: "cancel", issue: n } : { kind: "help" };
    }
    case "priority": {
      const n = intArg(args);
      const lvl = /high/i.test(args) ? "high" : /low/i.test(args) ? "low" : /normal/i.test(args) ? "normal" : null;
      return n && lvl ? { kind: "priority", issue: n, level: lvl } : { kind: "help" };
    }
    default:
      if (ROLE_COMMANDS.has(command))
        return args ? { kind: "create_task", title: args, role: command } : { kind: "help" };
      return { kind: "unknown", text: raw };
  }
}

export const HELP_TEXT = [
  "Mission Control — phone commands:",
  "",
  "Status:  /status  /fleet  /agents  /tasks  /prs  /decisions",
  "Control: /pause  /resume  /stop  /breaker_reset",
  "Tasks:   /task <text>   /prompt <text>   /goal <text>",
  "Roles:   /assign <role> <text>   /frontend <text>   /backend <text>   /qa <text>   /security <text>   /manager <text>",
  "Work:    /continue <issue>   /cancel <issue>   /priority <issue> high|normal|low",
  "",
  "Or just send a normal message → I'll offer to make it a task.",
  "Approvals arrive with Approve / Reject / More info / Let manager decide / Pause buttons.",
  "",
  "Examples:",
  "  /task add a dark-mode toggle to the settings page",
  "  /frontend fix the mobile navbar overflow",
  "  /priority 42 high",
].join("\n");
