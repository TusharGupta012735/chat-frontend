import type { Chat, ChatStatus } from "./api/types";

/** Message ids are numeric strings; compare without losing precision. */
export function compareIds(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function maxId(a: string | null | undefined, b: string | null | undefined): string | null {
  if (!a) return b ?? null;
  if (!b) return a;
  return compareIds(a, b) >= 0 ? a : b;
}

/** Most recent activity first; chats with no message yet go last. */
export function sortChats(chats: Chat[]): Chat[] {
  return [...chats].sort((x, y) => {
    const a = x.last_message_at ?? "";
    const b = y.last_message_at ?? "";
    if (a === b) return y.created_at.localeCompare(x.created_at);
    if (!a) return 1;
    if (!b) return -1;
    return b.localeCompare(a);
  });
}

export const STATUS_LABEL: Record<ChatStatus, string> = {
  OPEN: "Open",
  AWAITING_AGENT: "Waiting for support",
  AWAITING_CUSTOMER: "Support replied",
  CLOSED: "Closed",
};

export const ADMIN_STATUS_LABEL: Record<ChatStatus, string> = {
  OPEN: "Open (no messages)",
  AWAITING_AGENT: "Needs reply",
  AWAITING_CUSTOMER: "Waiting on customer",
  CLOSED: "Closed",
};

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { day: "numeric", month: "short" }) +
    " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

/** Complaint category labels from docs/issue.md's dropdown table. */
const CATEGORY_LABELS: Record<string, string> = {
  ITEM_MISSING: "Missing items",
  ITEM_QUANTITY: "Quantity issue",
  WRONG_ITEM: "Item mismatch",
  ITEM_QUALITY: "Quality issue",
  ITEM_EXPIRED: "Expired item",
  ITEM_WRONGLY_RETURNED: "Incorrectly marked as returned",
  PACKAGING_ISSUE: "Packaging issue",
  DELIVERY_DELAY: "Delayed delivery",
  CANCEL_NO_RESPONSE: "Cancelled — no seller response",
};

export const CATEGORY_CODES = Object.keys(CATEGORY_LABELS);

/** Label for any stored category code, including ones not in the table. */
export function categoryLabel(code: string): string {
  const known = CATEGORY_LABELS[code];
  if (known) return known;
  const words = code.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** A real display name, not empty and not the user's id (seeded complaints store the id as `created_by`). */
export function looksLikeName(v: string | null | undefined, id?: string | null): v is string {
  const t = v?.trim();
  return !!t && t !== id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

export function humanize(v: string): string {
  const w = v.replace(/_/g, " ").toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
}
