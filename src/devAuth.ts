import type { Role } from "./api/types";

// Client for the dev server's /dev-auth endpoints (see dev-auth.ts). Tokens are signed there,
// never in the browser.

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

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/dev-auth" + path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("Can't reach the dev server.");
  }
  const json = (await res.json().catch(() => null)) as { message?: string } | null;
  if (!res.ok || !json) {
    // A static host (no Vite dev/preview server) answers 404 or HTML here.
    throw new Error(json?.message ?? "Quick sign-in needs the app running with `npm run dev`.");
  }
  return json as T;
}

export const devAuth = {
  users: () => call<UsersState>("GET", "/users"),
  save: (u: SavedUser) => call<{ users: SavedUser[] }>("POST", "/users", u),
  remove: (u: SavedUser) =>
    call<{ users: SavedUser[] }>("DELETE", `/users/${u.role}/${encodeURIComponent(u.id)}`),
  customers: () => call<{ customers: KnownCustomer[] }>("GET", "/customers"),
  token: (role: Role, id: string) => call<{ token: string; exp: number }>("POST", "/token", { role, id }),
};
