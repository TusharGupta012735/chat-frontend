import { createHmac } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * One-click sign-in. Signs tokens with JWT_PRIVATE_KEY exactly like the backend verifies them
 * (HS256, key = base64-decode(JWT_PRIVATE_KEY), claims `user.id` + `role`). It runs on the server
 * only — as a Vercel function in production, mounted into the Vite dev server locally — so the key
 * never reaches the browser.
 *
 *   GET  /dev-auth/status     whether signing is configured
 *   GET  /dev-auth/customers  customers who raised complaints (read from the backend)
 *   POST /dev-auth/token      { role, id } → { token, exp }
 *
 * Anyone who can open the site can sign in as any customer or agent: it is a demo login.
 *
 * Self-contained on purpose (no relative imports), so Vercel can run it as-is.
 */

export const DEFAULT_API_TARGET = "https://ondc-api-chat.onrender.com";

type Role = "admin" | "customer";

export interface DevAuthOptions {
  /** Base64 HMAC key, the same JWT_PRIVATE_KEY ondc-api uses. */
  privateKey: string | undefined;
  /** Backend origin, for listing customers. */
  apiTarget: string;
  tokenHours: number;
}

/** Admin id used only for the read-only customer lookup. Not `flow-admin-*` (backend test cleanup). */
const LOOKUP_ADMIN = "dev-login";

export function optionsFromEnv(env: Record<string, string | undefined>): DevAuthOptions {
  return {
    privateKey: env.JWT_PRIVATE_KEY,
    apiTarget: (env.VITE_API_TARGET || DEFAULT_API_TARGET).replace(/\/+$/, ""),
    tokenHours: Number(env.DEV_TOKEN_HOURS) || 8,
  };
}

export function createHandler(opts: DevAuthOptions) {
  const key = opts.privateKey ? Buffer.from(opts.privateKey, "base64") : null;
  const sign = (role: Role, id: string) => {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + Math.round(opts.tokenHours * 3600);
    const payload = { sub: id, user: { id }, role: role === "admin" ? "ADMIN" : "USER", iat, exp };
    return { token: signHs256(payload, key!), exp };
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const route = routeOf(req.url ?? "/");

      if (route === "status" && req.method === "GET") {
        return send(res, 200, { signing: !!key, tokenHours: opts.tokenHours });
      }
      if (!key) return send(res, 503, { message: "One-click sign-in isn't set up: JWT_PRIVATE_KEY is missing on the server." });

      if (route === "customers" && req.method === "GET") {
        return send(res, 200, { customers: await fetchCustomers(opts.apiTarget, sign("admin", LOOKUP_ADMIN).token) });
      }

      if (route === "token" && req.method === "POST") {
        const body = (await readJson(req)) as { role?: unknown; id?: unknown };
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

/** Vercel entry point. vercel.json rewrites /dev-auth/<route> to /api/dev-auth?route=<route>. */
const vercelHandler = createHandler(optionsFromEnv(process.env));
export default vercelHandler;

/** "status" from /status, /dev-auth/status or /api/dev-auth?route=status. */
function routeOf(url: string): string {
  const u = new URL(url, "http://local");
  const fromQuery = u.searchParams.get("route");
  if (fromQuery) return fromQuery.replace(/^\/+|\/+$/g, "");
  return u.pathname.replace(/^\/(api\/)?(dev-auth\/?)?/, "").replace(/\/+$/, "");
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
      throw new Error(`Can't reach the backend at ${apiTarget}.`);
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

function readJson(req: IncomingMessage): Promise<unknown> {
  // Vercel may already have parsed the body; the Vite dev server hasn't.
  const parsed = (req as IncomingMessage & { body?: unknown }).body;
  if (parsed !== undefined) return Promise.resolve(typeof parsed === "string" ? JSON.parse(parsed || "{}") : parsed);
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
