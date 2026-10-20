import type { Role } from "./api/types";

// Client for the one-click sign-in endpoints (api/dev-auth.ts). Tokens are signed on the server,
// never in the browser. Saved people live in this browser's localStorage, on top of the built-in
// seed agents.

export interface SavedUser {
  role: Role;
  id: string;
  name: string;
}

export interface KnownCustomer {
  id: string;
  name: string;
  complaints: number;
  latest: string;
}

export interface UsersState {
  signing: boolean;
  tokenHours: number;
  users: SavedUser[];
}

/** The demo agents `npm run seed:issue-chat` creates. */
const BUILT_IN: SavedUser[] = [
  { role: "admin", id: "seed-admin-1", name: "Seed admin 1" },
  { role: "admin", id: "seed-admin-2", name: "Seed admin 2" },
  { role: "admin", id: "seed-admin-3", name: "Seed admin 3" },
];

const SAVED_KEY = "support-chat-saved-users";

/** Everyone saved in this browser, built-ins first unless removed. */
export function savedUsers(): SavedUser[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (raw) return JSON.parse(raw) as SavedUser[];
  } catch {
    /* storage unavailable or corrupt — fall back to the built-ins */
  }
  return BUILT_IN;
}

function writeSaved(users: SavedUser[]): SavedUser[] {
  try {
    localStorage.setItem(SAVED_KEY, JSON.stringify(users));
  } catch {
    /* not saved; the list still updates for this visit */
  }
  return users;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/dev-auth" + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the sign-in service.");
  }
  const json = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok || !json) throw new Error(json?.message ?? "The sign-in service isn't available on this deployment.");
  return json as T;
}

export const devAuth = {
  users: async (): Promise<UsersState> => ({
    ...(await call<{ signing: boolean; tokenHours: number }>("GET", "/status")),
    users: savedUsers(),
  }),
  save: async (u: SavedUser) => {
    const name = u.name.trim();
    if (!name || name === u.id) throw new Error("Give them a name.");
    const rest = savedUsers().filter((x) => !(x.role === u.role && x.id === u.id));
    return { users: writeSaved([...rest, { ...u, name }]) };
  },
  remove: async (u: SavedUser) => ({ users: writeSaved(savedUsers().filter((x) => !(x.role === u.role && x.id === u.id))) }),
  customers: () => call<{ customers: KnownCustomer[] }>("GET", "/customers"),
  token: (role: Role, id: string) => call<{ token: string; exp: number }>("POST", "/token", { role, id }),
};
