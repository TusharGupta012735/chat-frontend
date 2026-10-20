# Authentication

## Purpose

Every buyer-facing route on this BAP requires a valid JWT — the same token/signing convention
issued by the existing login flow (`JWT_SECRET = Buffer.from(process.env.JWT_PRIVATE_KEY ?? "",
"base64")`, matching the Java `JwtUtils` service). Send it as an `Authorization: Bearer <jwt>`
header on normal HTTP requests. For the SSE stream (`GET /api/v1/stream/:clientId`), the browser
`EventSource` API cannot set custom headers, so the token must instead be passed as a
`?token=<jwt>` query param. There is no unauthenticated fallback in any environment — a
missing/invalid/expired token always fails closed.

## Related APIs

The following docs describe requests that require this auth contract:

- `select-sse-integration.md`
- `init.md`
- `confirm.md`
- `status.md`
- `track.md`
- `issue.md`
- `update.md`
- `order-history.md`
- `issue-chat.md` (customer) and `admin-chats.md` (admin)

## Request

**HTTP requests** (`POST`/`GET` JSON routes):

```
Authorization: Bearer <jwt>
```

**SSE requests** (`EventSource`, cannot set headers):

```
GET /api/v1/stream/:clientId?token=<jwt>
```

Both forms are accepted on every authenticated route — the query-param form is not limited to
admin or stream routes.

## Route auth table

**No auth required** — these are BPP/ONDC-registry callback routes or public catalog browsing;
they never carry a buyer JWT, so don't attach one:
- `/on_select`, `/on_init`, `/on_confirm`, `/on_status`, `/on_track`, `/on_cancel`, `/on_update`,
  `/on_issue`, `/on_issue_status`, `/on_recon`, `/recon`, `/on_search`
- `/catalog/*`, `POST /search`
- `/payment/callback`, `/payment/hdfc-webhook`, `/payment/razorpay-webhook`

**Buyer JWT required** (`Authorization: Bearer <jwt>` or `?token=`): `/select`, `/init`,
`/confirm`, `/status`, `/track`, `/orders/*`, `/issue/*` (non-webhook routes), `/update`,
`/cancel`, `/stream/:clientId`, `/chats/*`, and the JWT-protected `/payment/*` routes
(`razorpay/verify`, `status/:id`, `retry/:id`, `full-status/:id`).

**Admin JWT required** — not applicable to the buyer-app frontend; documented for completeness
only. Covers `/admin/*` and `POST /registry/lookup`.

## Token claims the API reads

| Claim | Meaning |
|---|---|
| `user.id` | The caller's id — the customer's user id, or the admin's id on `/admin/*` routes |
| `role` | `ADMIN` (or a configured admin role) unlocks `/admin/*`; anything else → `403` there |
| `sub` | The mobile number — not used as an id |

Admin status comes **only** from `role` in a validly signed token; there is no admin table lookup.
The frontend may decode the payload (base64url) to read its own `user.id` — e.g. for "my chats" in the
admin panel — but must never sign tokens itself. For local testing tokens, see
[`issue-chat-dev-setup.md`](./issue-chat-dev-setup.md).

## Error codes

| HTTP Status | Body | Frontend action |
|---|---|---|
| `401` | `{"error":"Unauthorized","message":"..."}` | Token missing, invalid, or expired — re-authenticate (refresh/re-login) and retry. |
| `403` | `{"error":"Forbidden","message":"ADMIN role required"}` | Buyer JWT used against an admin-only route — this indicates a routing/config bug on the frontend, not a token refresh issue. |

For the SSE stream specifically: if `GET /stream/:clientId?token=<jwt>` fails auth, the
`EventSource` connection will not open — treat this the same as a `401` and re-authenticate before
retrying the stream.

## Changelog

- 2026-10-19 — Added `/chats/*` to the buyer-JWT routes and a "Token claims the API reads" section
  (`user.id`, `role`, `sub`; admin = `role` claim only). Docs only — no auth change.
