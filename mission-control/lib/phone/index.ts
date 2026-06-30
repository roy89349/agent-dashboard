import { telegramProvider } from "./telegram.ts";
import type { PhoneProvider, PhoneProviderName } from "./types";

export type * from "./types";

export function providerName(): PhoneProviderName {
  const p = (process.env.PHONE_COMMAND_PROVIDER ?? "telegram").trim().toLowerCase();
  return p === "whatsapp" ? "whatsapp" : "telegram";
}

/** The active provider, or null if the selected provider isn't implemented. Never throws. */
export function getProvider(): PhoneProvider | null {
  return providerName() === "telegram" ? telegramProvider : null; // whatsapp: not in this MVP
}

export function isPhoneConfigured(): boolean {
  const p = getProvider();
  return !!p && p.isConfigured();
}

export interface PhoneStatus {
  provider: PhoneProviderName;
  implemented: boolean;
  configured: boolean;
  setupError: string | null;
  webhookPath: string;
}

/** Non-secret status for the dashboard Config screen. Safe when nothing is configured. */
export function phoneStatus(): PhoneStatus {
  const name = providerName();
  const p = getProvider();
  const implemented = !!p;
  const configured = !!p && p.isConfigured();
  let setupError: string | null = null;
  if (!implemented)
    setupError = `provider '${name}' is not implemented in this build (MVP = telegram). Set PHONE_COMMAND_PROVIDER=telegram.`;
  else if (!configured)
    setupError = "set TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_CHAT_ID, then set the webhook (see docs/phone-command-interface.md)";
  return { provider: name, implemented, configured, setupError, webhookPath: `/api/integrations/${name}/webhook` };
}
