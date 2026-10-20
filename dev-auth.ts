import { createHmac } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import type { Connect, Plugin } from "vite";

/**
 * Local sign-in for development. Runs inside the Vite dev/preview server (Node), never in the
 * browser: it signs tokens with JWT_PRIVATE_KEY from .env exactly like the backend verifies them
 * (HS256, key = base64-decode(JWT_PRIVATE_KEY), claims `user.id` + `role`).
 *
 *   GET    /dev-auth/users              saved users + whether signing is configured
 *   POST   /dev-auth/users              { role, id, name } — add or rename a saved user
 *   DELETE /dev-auth/users/:role/:id    forget a saved user
 *   GET    /dev-auth/customers          customers who raised complaints (read from the backend)
 *   POST   /dev-auth/token              { role, id } → { token, exp }
 */

export type DevRole = "admin" | "customer";
export interface DevUser {
  role: DevRole;
  id: string;
  name: string;
}

interface Options {
  /** Base64 HMAC key, the same JWT_PRIVATE_KEY ondc-api uses. */
  privateKey: string | undefined;
  /** Backend origin, for listing customers. */
  apiTarget: string;
  tokenHours: number;
}

const USERS_FILE = resolve("users.json");
const EXAMPLE_FILE = resolve("users.example.json");
/** Admin id used only for the read-only customer lookup. Not `flow-admin-*` (backend test cleanup). */
const LOOKUP_ADMIN = "dev-login";

export function devAuth(opts: Options): Plugin {
  const key = opts.privateKey ? Buffer.from(opts.privateKey, "base64") : null;
  const handler = createHandler(key, opts);
  return {
    name: "dev-auth",
    configureServer: (server) => void server.middlewares.use("/dev-auth", handler),
    configurePreviewServer: (server) => void server.middlewares.use("/dev-auth", handler),
  };
}

function createHandler(key: Buffer | null, opts: Options): Connect.NextHandleFunction {
  const sign = (role: DevRole, id: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Math.round(opts.tokenHours * 3600);
    const payload = { sub: id, user: { id }, role: role === "admin" ? "ADMIN" : "USER", iat, exp };
    return { token: signHs256(payload, key!), exp };
  };

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://local");
      const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);

      if (parts[0] === "users" && parts.length === 1 && req.method === "GET") {
        return send(res, 200, {
          signing: !!key,
          tokenHours: opts.tokenHours,
          users: readUsers(),
        });
      }

      if (parts[0] === "users" && parts.length === 1 && req.method === "POST") {
        const body = await readJson(req);
        const user = validUser(body);
        if (!user) return send(res, 400, { message: "Give a role (admin or customer), an id without spaces, and a name (not the id)." });
        const users = readUsers().filter((u) => !(u.role === user.role && u.id === user.id));
        users.push(user);
        writeUsers(users);
        return send(res, 200, { users });
      }

      if (parts[0] === "users" && parts.length === 3 && req.method === "DELETE") {
        const users = readUsers().filter((u) => !(u.role === parts[1] && u.id === parts[2]));
        writeUsers(users);
        return send(res, 200, { users });
      }

      if (!key) return send(res, 503, { message: "JWT_PRIVATE_KEY is not set in chat-frontend/.env." });

      if (parts[0] === "customers" && req.method === "GET") {
        return send(res, 200, { customers: await fetchCustomers(opts.apiTarget, sign("admin", LOOKUP_ADMIN).token) });
      }

      if (parts[0] === "token" && req.method === "POST") {
        const body = (await readJson(req)) as Partial<DevUser>;
        if ((body.role !== "admin" && body.role !== "customer") || typeof body.id !== "string" || !body.id.trim()) {
          return send(res, 400, { message: "role and id are required." });
        }
        return send(res, 200, sign(body.role, body.id.trim()));
      }

      send(res, 404, { message: "Not found" });
    } catch (err) {
      send(res, 500, { message: err instanceof Error ? err.message : String(err) });
    }
  };
}

function signHs256(payload: object, key: Buffer): string {
  const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString("base64url");
  const head = `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}`;
  return `${head}.${createHmac("sha256", key).update(head).digest("base64url")}`;
}

/**
 * Customers are the `source_id`s on complaints; there is no customer list endpoint. `created_by` is
 * normally the buyer's name, but seeded complaints store the user id there — then the name comes
 * from the complaint's CONSUMER actor, which only the detail endpoint returns.
 */
async function fetchCustomers(apiTarget: string, adminToken: string) {
  const seen = new Map<string, { id: string; name: string; complaints: number; latest: string; issueId: string }>();
  for (let page = 1; page <= 5; page++) {
    let res: Response;
    try {
      res = await fetch(`${apiTarget}/api/v1/admin/issues?limit=100&page=${page}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    } catch {
      throw new Error(`Can't reach the backend at ${apiTarget}. Is ondc-api running?`);
    }
    if (!res.ok) throw new Error(`Backend answered ${res.status} when listing complaints.`);
    const json = (await res.json()) as {
      issues: { issue_id: string; source_id: string | null; created_by: string | null; created_at: string }[];
      pagination: { total: number; limit: number };
    };
    for (const i of json.issues) {
      if (!i.source_id) continue;
      const row = seen.get(i.source_id) ?? { id: i.source_id, name: "", complaints: 0, latest: i.created_at, issueId: i.issue_id };
      row.complaints++;
      if (!row.name && looksLikeName(i.created_by, i.source_id)) row.name = i.created_by!.trim();
      if (i.created_at > row.latest) row.latest = i.created_at;
      seen.set(i.source_id, row);
    }
    if (page * json.pagination.limit >= json.pagination.total) break;
  }
  const unnamed = [...seen.values()].filter((c) => !c.name).slice(0, 50);
  await Promise.all(
    unnamed.map(async (c) => {
      try {
        const res = await fetch(`${apiTarget}/api/v1/admin/issues/${encodeURIComponent(c.issueId)}`, {
          headers: { Authorization: `Bearer ${adminToken}` },
        });
        if (!res.ok) return;
        const { issue } = (await res.json()) as { issue: { actors?: { actor_type: string; info?: { person?: { name?: string } } }[] } };
        const name = issue.actors?.find((a) => a.actor_type === "CONSUMER")?.info?.person?.name;
        if (looksLikeName(name, c.id)) c.name = name!.trim();
      } catch {
        /* stays unnamed */
      }
    }),
  );
  return [...seen.values()]
    .map(({ issueId: _, ...c }) => c)
    .sort((a, b) => (a.name || "~").localeCompare(b.name || "~"));
}

/** A real display name, not empty and not the user's id (or any other UUID). */
function looksLikeName(v: string | null | undefined, id: string): boolean {
  const t = v?.trim();
  return !!t && t !== id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t);
}

function readUsers(): DevUser[] {
  const file = existsSync(USERS_FILE) ? USERS_FILE : existsSync(EXAMPLE_FILE) ? EXAMPLE_FILE : null;
  if (!file) return [];
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  return Array.isArray(parsed) ? parsed.map(validUser).filter((u): u is DevUser => !!u) : [];
}

function writeUsers(users: DevUser[]) {
  writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + "\n");
}

function validUser(v: unknown): DevUser | null {
  const u = v as Partial<DevUser> | null;
  if (!u || (u.role !== "admin" && u.role !== "customer")) return null;
  const id = typeof u.id === "string" ? u.id.trim() : "";
  if (!id || id.length > 128 || /\s/.test(id)) return null;
  const name = typeof u.name === "string" && looksLikeName(u.name, id) ? u.name.trim().slice(0, 80) : "";
  if (!name) return null;
  return { role: u.role, id, name };
}

function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        ok(data ? JSON.parse(data) : {});
      } catch {
        fail(new Error("Body must be JSON."));
      }
    });
    req.on("error", fail);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}
