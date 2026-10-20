import type { Role } from "./api/types";

export interface Session {
  role: Role;
  token: string;
  /** The token's `user.id` claim — the customer id, or the admin id. */
  userId: string;
  /** Seconds since epoch, if the token has `exp`. */
  exp?: number;
  /** Display name, when signed in from the saved-users list. */
  name?: string;
}

// The session lives in sessionStorage: a reload keeps you signed in, but a new tab or a fresh visit
// starts at the sign-in screen instead of silently reopening whoever signed in last.
const KEY = "support-chat-session";
const LAST_KEY = "support-chat-last-user";
const GUEST_KEY = "support-chat-guest-id";

/** Reads the JWT payload (base64url). No verification — the server does that. */
export function decodeToken(token: string): { userId: string; role?: string; exp?: number } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    const json = JSON.parse(decodeURIComponent(escape(atob(b64))));
    const userId = json?.user?.id;
    if (typeof userId !== "string" && typeof userId !== "number") return null;
    return { userId: String(userId), role: json.role, exp: json.exp };
  } catch {
    return null;
  }
}

export function loadSession(): Session | null {
  try {
    localStorage.removeItem(KEY); // sessions used to be kept here

    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    if (s.exp && s.exp * 1000 < Date.now()) return null;
    return s;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null) {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* storage unavailable — session lasts for this tab only */
  }
}

/** The last user picked on the sign-in screen, so it can be offered first next time. */
export function loadLastUser(): { role: Role; id: string } | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as { role: Role; id: string }) : null;
  } catch {
    return null;
  }
}

export function saveLastUser(u: { role: Role; id: string }) {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ role: u.role, id: u.id }));
  } catch {
    /* not important */
  }
}

/**
 * Guest ids. The guest customer id is kept per browser so a returning guest finds their chats;
 * all guest agents share one id. Both start with "guest-" so the UI can label them.
 */
export function guestId(role: Role): string {
  if (role === "admin") return "guest-admin";
  try {
    const existing = localStorage.getItem(GUEST_KEY);
    if (existing) return existing;
    const id = `guest-${crypto.randomUUID().slice(0, 8)}`;
    localStorage.setItem(GUEST_KEY, id);
    return id;
  } catch {
    return `guest-${crypto.randomUUID().slice(0, 8)}`;
  }
}
