// Provider-agnostic phone command interface. The chat app is ONLY transport/UI; the backend stays
// the source of truth. One provider is implemented for the MVP (Telegram). To add WhatsApp later,
// implement the same PhoneProvider interface in lib/phone/whatsapp.ts and wire it in lib/phone/index.ts.
import type { Approval } from "../approvals";

export type PhoneProviderName = "telegram" | "whatsapp";

export interface PhoneResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** A normalized inbound event (a text message OR a button press), provider-agnostic. */
export interface IncomingMessage {
  chatId: string;
  text: string;
  isCallback: boolean;
  callbackData?: string;
  callbackQueryId?: string;
  messageId?: string | number;
}

export interface ParsedCommand {
  command: string | null; // slash command without the slash (lowercased), or null for free text
  args: string;
  raw: string;
}

/** One inline button. `data` is the callback payload (≤64 bytes on Telegram). `url` makes it a link. */
export interface Button {
  text: string;
  data?: string;
  url?: string;
}

export interface StatusSummary {
  online: boolean;
  mode: string;
  claiming: boolean;
  pauseReason: string | null;
  workers: number;
  prsToday: number;
  breakerTripped: boolean;
  pendingApprovals: number;
  slots: { issue: number | null; phase: string | null; title: string | null }[];
}

export interface PhoneProvider {
  readonly name: PhoneProviderName;
  /** True when the required env (token + allowed id) is present. Never throws. */
  isConfigured(): boolean;
  /** Only the configured allowed chat/user may run commands. */
  verifySender(chatId: string): boolean;
  /** Normalize a raw provider webhook body into an IncomingMessage, or null if irrelevant. */
  handleWebhook(body: unknown): IncomingMessage | null;
  parseIncomingCommand(text: string): ParsedCommand;

  sendMessage(text: string, opts?: { buttons?: Button[][]; chatId?: string }): Promise<PhoneResult>;
  /** OPTIONAL: send a photo (PNG bytes) with an HTML caption (caller pre-escapes) + inline buttons.
   *  Providers without photo support simply omit this. Never throws (same contract as sendMessage). */
  sendPhoto?(
    photo: Buffer | Blob,
    opts?: { caption?: string; buttons?: Button[][]; chatId?: string; filename?: string },
  ): Promise<PhoneResult>;
  sendApprovalRequest(a: Approval, opts?: { chatId?: string }): Promise<PhoneResult>;
  sendStatusUpdate(text: string, opts?: { chatId?: string }): Promise<PhoneResult>;
  answerCallback(callbackQueryId: string, text?: string): Promise<void>;

  formatDecisionMessage(a: Approval): { text: string; buttons: Button[][] };
  formatStatusMessage(s: StatusSummary): string;
}
