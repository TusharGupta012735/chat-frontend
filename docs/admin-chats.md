# Admin Panel — Support Chats

**Audience**: Admin panel frontend developer.

## Purpose

The support team's side of the customer support chat: an inbox of every chat, opening a chat with a
customer (about one of their complaints, or in general), replying, marking chats read, and closing them.
Customers then rate the help they got; the rating shows up here.

- The **first admin to send a message** in a chat is assigned to it; later admins don't take it over.
- **Closing** ends the chat only — the complaint itself is not changed. Closed is final: the customer's
  next message starts a new chat.
- Customers see every admin as **"Support"**.
- Live updates arrive on the existing `/admin/stream`. When no admin has the panel open, a short alert
  email goes to the support inbox instead.

Media attachments are not supported yet (`attachments` is ignored; messages return `attachments: []`).

---

## Related APIs

- [`issue-chat.md`](./issue-chat.md) — the customer side of the same chat (shapes, rules).
- [`admin-issues.md`](./admin-issues.md) — complaint list/detail; the detail now carries `chat_id`.
- [`admin-orders.md`](./admin-orders.md) — order views; `GET /admin/stream` (the panel's existing live feed) also carries `order_update` / `payment_update`.

---

## Authentication

Same as every `/admin/*` route: `Authorization: Bearer <admin jwt>` (role `ADMIN` or a configured admin
role); `?token=` works for the stream. Missing/invalid → `401`, wrong role → `403`. Admins see every chat.

**Your admin id** is the token's `user.id` claim — there is no separate admin lookup. It is what appears
as `assigned_to_id`, `closed_by_id`, `opened_by_id` and a message's `sender_id`, and what `assigned=me`
filters on. Decode the JWT payload (base64url, no verification needed on the client) to read it, and
compare it with `sender_id` to tell your own messages from other admins'.

---

## Request

All paths are under `/api/v1`. Message ids are **strings**.

### Inbox

```
GET /api/v1/admin/chats
```

```bash
curl "https://<host>/api/v1/admin/chats?status=AWAITING_AGENT&assigned=unassigned&page=1&limit=20" \
  -H "Authorization: Bearer <admin jwt>"
```

| Query | Values |
|---|---|
| `status` | comma-separated `OPEN,AWAITING_AGENT,AWAITING_CUSTOMER,CLOSED`. **Default: everything except `CLOSED`** (no default when `rated` is used) |
| `assigned` | `me` \| `unassigned` \| `<admin id>` |
| `unread_only` | `true` → the customer wrote last and no admin has read it yet ("needs reply") |
| `linked` | `issue` (about a complaint) \| `general` |
| `issue_id`, `customer_id` | exact match |
| `issue_level` | `ISSUE` \| `GRIEVANCE` (linked chats) |
| `rated` | `true` (closed + rated) \| `false` (closed, not rated) |
| `page`, `limit` | default `1`, `20` (max `100`) |

Sorted by most recent activity; chats with no message yet go last.

### Open (or continue) a chat with a customer

```
POST /api/v1/admin/chats
```

Send **exactly one** of `issue_id` / `customer_id`. The message is optional.

```bash
curl -X POST "https://<host>/api/v1/admin/chats" \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{ "issue_id": "IGM260423a3f9b2c1", "client_message_id": "…", "body": "Hi, I'\''m looking into your complaint." }'
```

| Field | Notes |
|---|---|
| `issue_id` | A complaint; the customer is the one who raised it. Uses the complaint's open chat if there is one |
| `customer_id` | A customer's user id; uses their open general chat if there is one |
| `body`, `client_message_id` | Optional pair (rules as for sending). With a message: you are assigned and the customer is notified. Without: status `OPEN`, unassigned, customer not notified |

`201` = new chat, `200` = existing open chat. Response: `{ chat, message | null }`.

### Chat, messages, send, read

```
GET  /api/v1/admin/chats/:chat_id?limit=30            → { chat, messages (oldest first), has_more_before }
GET  /api/v1/admin/chats/:chat_id/messages?after=<id>  → newer (catch up after reconnect)
GET  /api/v1/admin/chats/:chat_id/messages?before=<id> → older history
POST /api/v1/admin/chats/:chat_id/messages             { "client_message_id": "…", "body": "…" }
POST /api/v1/admin/chats/:chat_id/read                 { "last_read_message_id": "1043" }
```

- `limit`: chat default `30`, messages default `50`, max `100`. Exactly one of `after` / `before`.
- Send: `body` 1–4000 chars; `client_message_id` 8–64 chars (UUID), reuse it to retry safely (`200` on replay).
- Read: the read marker is shared by the whole team — any admin reading clears the badge for all.

### Close

```
PATCH /api/v1/admin/chats/:chat_id
```

```json
{ "status": "CLOSED" }
```

Only `CLOSED` is accepted. Closing an already-closed chat returns `200` with the original `closed_at`.

**There is no reopen.** To talk to the customer again, `POST /admin/chats` with the same `issue_id` (or
`customer_id` for a general chat) — it creates a new chat, since the closed one no longer counts as open
(admins can do this even while new chats are switched off for customers).
Likewise, the customer's next message after close starts a new chat on their side. Closed chats don't
count toward the customer's 5-open-chats limit. To show a customer's full history, use
`GET /admin/chats?customer_id=<id>&status=OPEN,AWAITING_AGENT,AWAITING_CUSTOMER,CLOSED`.

### New chats on/off

```
GET   /api/v1/admin/chat-settings
PATCH /api/v1/admin/chat-settings
```

```bash
curl -X PATCH "https://<host>/api/v1/admin/chat-settings" \
  -H "Authorization: Bearer <admin jwt>" -H "Content-Type: application/json" \
  -d '{ "new_chats_enabled": false }'
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `new_chats_enabled` | boolean | yes | `false` = customers can't **start** a chat (admins still can); `true` = back on. Sets the value (sending the same value twice is fine) |

Response (both calls):

```json
{
  "new_chats_enabled": false,
  "env_enabled": true,
  "new_chats_allowed": false,
  "updated_by": "seed-admin-1",
  "updated_at": "2026-10-19T09:12:44.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `new_chats_enabled` | boolean | The switch. `true` until someone turns it off |
| `env_enabled` | boolean | Chat is switched on for this server at deploy level. `false` → the whole chat feature is off whatever the switch says (every `/admin/chats` and customer chat route answers 404) — show "disabled by server configuration" and disable the switch |
| `new_chats_allowed` | boolean | Whether customers can actually start a chat right now (`env_enabled && new_chats_enabled`) — use this for the status badge |
| `updated_by`, `updated_at` | string \| null | Last change; `null` if never changed |

While new chats are **off**:
- **Ongoing chats carry on as normal** for customers and admins: inbox, reply, read, close, rating, live
  events and customer pushes all keep working.
- **Customers** can't start a chat (`409 NEW_CHATS_DISABLED` on their side).
- **You can still start chats** with `POST /admin/chats` — by complaint or by customer — exactly as when the
  switch is on. The customer can reply in a chat you opened, since it's then an ongoing chat.
- The change applies immediately. These two routes work even when `env_enabled` is `false`.

---

## Response

### `Chat` (admin view)

Every field of the customer view (see [`issue-chat.md`](./issue-chat.md#chat)) except `can_rate`, plus:

| Field | Type | Notes |
|---|---|---|
| `customer_id` | string | The customer |
| `opened_by_id` | string | Who started it (customer or admin id) |
| `assigned_to_id` | string \| null | Admin who first replied |
| `closed_by_id` | string \| null | Admin who closed it |
| `issue_level` | `ISSUE` \| `GRIEVANCE` \| null | Of the linked complaint |
| `customer_last_read_message_id` | string | For a "seen" marker on the last admin message |
| `unread_count` | int | Customer messages after the team's read marker |
| `last_read_message_id` | string | The team's read marker |
| `rating` | object \| null | `{ stars, comment, rated_at }` |

```json
{
  "chat_id": "8c1f2a4e-…", "issue_id": "IGM260423a3f9b2c1", "order_id": "od260910a1b2c3d4",
  "issue_status": "PROCESSING", "issue_level": "ISSUE", "opened_by_type": "USER",
  "customer_id": "0b6c…", "opened_by_id": "0b6c…", "assigned_to_id": "admin-42", "closed_by_id": null,
  "status": "AWAITING_AGENT", "can_send": true, "unread_count": 2,
  "last_read_message_id": "1040", "customer_last_read_message_id": "1041",
  "last_message_id": "1043", "last_message_at": "2026-10-15T10:06:10.000Z",
  "last_message_preview": "Here is the photo", "last_message_sender": "USER",
  "closed_at": null, "rating": null, "created_at": "2026-10-15T10:00:00.000Z"
}
```

### `Message` (admin view)

Same as the customer view plus `sender_id` (which admin / the customer). `is_mine` is `true` for every
`ADMIN` message (team view) — compare `sender_id` with your own id to tell your messages apart.

### Lists

`GET /admin/chats` → `{ "data": [Chat], "pagination": { "page", "limit", "total" } }`.

---

## SSE events

On the existing `GET /api/v1/admin/stream`, event name **`issue_chat`**, sent to **every** connected admin tab:

```json
{
  "type": "MESSAGE_CREATED",
  "chat": { "…": "full admin Chat" },
  "message": { "…": "Message, or null" },
  "actor": { "type": "USER", "id": "0b6c…" },
  "occurred_at": "2026-10-15T10:06:10.000Z"
}
```

| `type` | When | Panel action |
|---|---|---|
| `CHAT_OPENED` | A customer or an admin started a chat | Add the row to the inbox |
| `MESSAGE_CREATED` | Anyone sent a message (customers **and** admins, including your own — de-dupe by `message.id`) | Append to the open chat; update the row and re-sort by `last_message_at`. An admin's first message also carries the new `assigned_to_id` |
| `CHAT_READ` | A customer or an admin marked read | Update the row's badge / "seen" marker |
| `CHAT_CLOSED` | An admin closed it | Move the row to Closed |
| `CHAT_RATED` | The customer rated it | Show the rating |

`chat` is complete, so rows can be updated without another request. `actor.id` tells a tab whether the
action was its own. After a reconnect, re-fetch the inbox and call `…/messages?after=<highest id shown>`
for the open chat.

```js
const es = new EventSource(`/api/v1/admin/stream?token=${adminJwt}`);
es.addEventListener("issue_chat", (e) => applyChatEvent(JSON.parse(e.data)));
```

---

## Error codes

| HTTP | `error` | When | Frontend action |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad body / cursor / filter / close status (`details` names the field) | Fix the request |
| 400 | `ISSUE_OR_CUSTOMER_REQUIRED` | Open with neither or both of `issue_id` / `customer_id` | Fix the request |
| 404 | `CHAT_NOT_FOUND` | Unknown chat id | Show "chat not found" |
| 404 | `ISSUE_NOT_FOUND` | Unknown complaint | Show "complaint not found" |
| 404 | `CUSTOMER_NOT_FOUND` | Unknown or deleted customer | Show "customer not found" |
| 404 | `MESSAGE_NOT_FOUND` | Read pointer not in this chat | Re-fetch the chat |
| 404 | `NOT_FOUND` | Support chat is switched off on the server (`env_enabled: false`; not the admin switch) | Hide the chats section; `/admin/chat-settings` still answers |
| 409 | `CHAT_CLOSED` | Sending to a closed chat | Disable input |
| 409 | `TOO_MANY_ACTIVE_CHATS` | The customer already has 5 open chats | Ask to continue an existing chat |
| 422 | `ISSUE_HAS_NO_CUSTOMER` | The complaint has no customer to chat with | Show the reason |
| 429 | `RATE_LIMITED` | > 20 messages a minute in one chat | Back off |
| 401 / 403 | `Unauthorized` / `Forbidden` | Missing/invalid token, or non-admin role | Redirect to admin login |

---

## Changelog

- 2026-10-19 — Created (ISSUE-CHAT-01): inbox, open by complaint or customer, messages, read, close, live
  `issue_chat` events on `/admin/stream`. Media attachments not yet supported.
- 2026-10-19 — Documented where the admin id comes from (JWT `user.id`) and that closed chats can't be
  reopened (open a new one with `POST /admin/chats`). Docs only — no API change. Demo data:
  [`issue-chat-dev-setup.md`](./issue-chat-dev-setup.md).
- 2026-10-19 — New `GET` / `PATCH /admin/chat-settings` (`{ new_chats_enabled }`): stop/allow starting new
  chats by customers without a deploy; ongoing chats and admin opens are unaffected. Additive.
