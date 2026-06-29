import "server-only";

/**
 * Getekende sessie met iat + TTL (geen statische HMAC-constante).
 * Cookie = base64url(payload).hex(hmac). Verloopt; revoceerbaar door
 * MC_SESSION_SECRET te roteren. Edge-runtime-compatibel (Web Crypto).
 */
const TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 dagen

async function hmacHex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function b64url(s: string): string {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s: string): string {
  return atob(s.replace(/-/g, "+").replace(/_/g, "/"));
}

export async function mintSession(secret: string): Promise<string> {
  const payload = JSON.stringify({ iat: Date.now() });
  const p = b64url(payload);
  const sig = await hmacHex(p, secret);
  return `${p}.${sig}`;
}

export async function verifySession(
  cookie: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!cookie || !cookie.includes(".")) return false;
  const [p, sig] = cookie.split(".");
  const expected = await hmacHex(p, secret);
  if (sig !== expected) return false;
  try {
    const { iat } = JSON.parse(unb64url(p));
    return typeof iat === "number" && Date.now() - iat < TTL_MS;
  } catch {
    return false;
  }
}
