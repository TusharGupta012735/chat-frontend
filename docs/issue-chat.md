# Support Chat — Customer App

**Audience**: Buyer-app frontend developer.

## Purpose

A chat between the customer and our support team, inside the app. The customer can start a chat about
anything (a **general** chat) or about one of their complaints (a **linked** chat); support can also start
a chat with the customer. Support replies, and closes the chat when done; the customer can then rate the
help they got (1–5 stars + an optional comment).

The chat is only between the customer and our support team. Nothing is sent to the seller, and closing a
chat does **not** close the complaint (see [`issue.md`](./issue.md) for complaints).

What the customer sees:
- **One support conversation at a time per topic.** While a general chat is open, every new message goes
  into it. Once support closes it, the next message starts a new chat. A complaint has at most one open
  chat at a time.
- **At most 5 open chats** in total.
- Messages arrive **live** on the app's existing event stream; when the app isn't connected, a push
  notification is sent instead.

Media attachments are **not supported yet** (any `attachments` sent are ignored; every message returns
`attachments: []`).

---

## Chat lifecycle

```
            customer sends                      support replies
 (new) ──────────────────────▶ AWAITING_AGENT ◀──────────────────▶ AWAITING_CUSTOMER
   │                                  ▲            customer sends          │
   │ support opens without a message  │ customer sends                     │
   └──────────────▶ OPEN ─────────────┘                                    │
                     │ support sends ─────────────────────────────────────▶│
                     │                                                     │
                     └──────────── support closes (from any state) ────────┴──▶ CLOSED (final)
```

- **Only support closes a chat.** There is no close button for the customer, and **no reopen** — not for
  the customer, not for support. A `CLOSED` chat stays readable forever (history + rating).
- **Continuing after close = a new chat.** Send the customer's message with `POST /chats`:
  - general chat → omit `issue_id`; a new general chat is created (`201`).
  - complaint chat → send the same `issue_id`; a new chat for that complaint is created (`201`).
  The closed chat is untouched, so it can still be rated. This is a **new** chat, so it needs
  `new_chats_enabled: true` (see [Is chat available?](#is-chat-available)) — otherwise `409 NEW_CHATS_DISABLED`.
- **Closed chats don't count** toward the 5-open-chats limit.

**Closed chat screen** (`can_send: false`):

1. Replace the input with a "Start a new chat" button (keep the history visible above it). Hide the button
   while `new_chats_enabled` is `false`.
2. If `can_rate: true`, show the rating prompt first; rating is optional and doesn't block a new chat.
3. On tap, either open a fresh compose screen or send the typed text straight to `POST /chats` (with the
   chat's `issue_id`, if any), then navigate to the returned `chat.chat_id`.
4. If a send on a stale screen comes back `409 CHAT_CLOSED`, switch to this state and offer the same button,
   keeping the typed text.

**Finding chats later**

| Need | Call |
|---|---|
| "Support" timeline (all general chats, newest first) | `GET /chats?linked=general` — draw a divider at each closed chat |
| A complaint's chats (at most one not `CLOSED`; sorted by most recent activity) | `GET /chats?issue_id=<issue_id>` |
| Open chats for a badge / list | `GET /chats?status=active` |

---

## Related APIs

- [`issue.md`](./issue.md) — raising and tracking complaints; a chat can be linked to one with `issue_id`.
- [`authentication.md`](./authentication.md) — the JWT used below.
- [`select-sse-integration.md`](./select-sse-integration.md) — the same `GET /api/v1/stream/:clientId`
  connection carries the chat events below.

---

## Authentication

Every request: `Authorization: Bearer <customer jwt>`. Missing/invalid token → `401`. A customer only ever
sees their own chats — any other chat id answers `404 CHAT_NOT_FOUND`.

---

## Request

All paths are under `/api/v1`. Message ids are **strings**.

### Is chat available?

```
GET /api/v1/chats/availability
```

```bash
curl "https://<host>/api/v1/chats/availability" -H "Authorization: Bearer <jwt>"
```

```json
{ "enabled": true, "new_chats_enabled": false }
```

Always `200` (with a valid token).

| Field | Meaning | App |
|---|---|---|
| `enabled` | Support chat exists on this server. `false` → every other `/chats` route answers `404 NOT_FOUND` | Hide everything chat-related |
| `new_chats_enabled` | A **new** chat can be started right now. Support can switch this off at any time | `false` → hide/disable "Start a chat" / "Chat about this complaint" / "Start a new chat" on a closed chat. **Keep showing the chat list and every open chat** — they work exactly as before (send, read, rate, live events, pushes) |

- Call it on app start / resume and before showing a "start a chat" button.
- Continuing an open chat is never blocked: `POST /chats` that lands in the customer's **open** general chat
  (or the complaint's open chat) still works. Only a call that would **create** a chat gets
  `409 NEW_CHATS_DISABLED` — show "Support chat isn't taking new conversations right now" and keep the
  typed text.
- Turning it back on needs nothing special.

### Open or continue a chat

```
POST /api/v1/chats
```

```bash
curl -X POST "https://<host>/api/v1/chats" \
  -H "Authorization: Bearer <jwt>" -H "Content-Type: application/json" \
  -d '{ "client_message_id": "2b0b5f0e-6c1e-4a53-9a43-6a2f4f0f8a11", "body": "Hi, my refund hasn'\''t arrived yet." }'
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `body` | string | yes | 1–4000 characters after trimming |
| `client_message_id` | string | yes | 8–64 chars; generate a UUID per message. **Reuse it when retrying** the same message — the server stores it once |
| `issue_id` | string | no | One of the customer's complaints → linked chat. Omit for a general chat |

- No `issue_id`: goes into the customer's open general chat if there is one (`200`), otherwise starts one (`201`).
- With `issue_id`: goes into that complaint's open chat if there is one (`200`), otherwise starts one (`201`).
- `201` = new chat, `200` = existing chat (or a retried message). Same response shape either way.

### List my chats

```
GET /api/v1/chats?status=active&page=1&limit=20
```

| Query | Values |
|---|---|
| `status` | `active` (not closed) \| `closed` \| omit for all |
| `linked` | `general` \| `issue` \| omit for all. `linked=general` lets the app show all general chats as one "Support" timeline with a divider at each closed chat |
| `issue_id` | only chats about this complaint |
| `page`, `limit` | default `1`, `20` (max `50`) |

Sorted by most recent activity. Each row carries its own `unread_count` (sum the first page for a badge —
there is no separate unread endpoint).

### Open a chat screen

```
GET /api/v1/chats/:chat_id?limit=30
```

Returns the chat plus its newest messages (oldest first). `limit` max `100`.

### Load more / catch up

```
GET /api/v1/chats/:chat_id/messages?after=<message id>      # newer messages (use after a reconnect)
GET /api/v1/chats/:chat_id/messages?before=<message id>     # older history (scroll up)
```

Send exactly one of `after` / `before`. `limit` default `50`, max `100`.

### Send a message

```
POST /api/v1/chats/:chat_id/messages
```

Body: `{ "client_message_id": "…", "body": "…" }` (same rules as above). `201` = sent, `200` = this
`client_message_id` was already stored (safe retry).

### Mark as read

```
POST /api/v1/chats/:chat_id/read
```

```json
{ "last_read_message_id": "1043" }
```

Send the id of the newest message on screen. The pointer only moves forward. Response: `{ "unread_count": 0 }`.

### Rate a closed chat

```
POST /api/v1/chats/:chat_id/rating
```

```json
{ "stars": 4, "comment": "Quick and helpful" }
```

`stars` 1–5 (required), `comment` ≤ 1000 chars (optional). Once per chat, only after support closed it.

---

## Response

### `POST /chats` and `POST /chats/:chat_id/messages`

```json
{
  "chat": { "…": "Chat (below)" },
  "message": { "…": "Message (below)" }
}
```

### `GET /chats`

```json
{ "data": [ { "…": "Chat" } ], "pagination": { "page": 1, "limit": 20, "total": 3 } }
```

### `GET /chats/:chat_id`

```json
{ "chat": { "…": "Chat" }, "messages": [ { "…": "Message" } ], "has_more_before": true }
```

### `GET /chats/:chat_id/messages`

```json
{ "messages": [ { "…": "Message" } ], "has_more": false }
```

### `POST /chats/:chat_id/read` → `{ "unread_count": 0 }` · `POST /chats/:chat_id/rating` → `{ "chat": { … } }`

### `Chat`

```json
{
  "chat_id": "8c1f2a4e-…",
  "issue_id": "IGM260423a3f9b2c1",
  "order_id": "od260910a1b2c3d4",
  "issue_status": "PROCESSING",
  "opened_by_type": "USER",
  "status": "AWAITING_CUSTOMER",
  "can_send": true,
  "can_rate": false,
  "unread_count": 1,
  "last_read_message_id": "1040",
  "last_message_id": "1043",
  "last_message_at": "2026-10-15T10:06:10.000Z",
  "last_message_preview": "Could you share a photo of the bill?",
  "last_message_sender": "ADMIN",
  "closed_at": null,
  "rating": null,
  "created_at": "2026-10-15T10:00:00.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `chat_id` | string | Use in every `/chats/:chat_id` call |
| `issue_id`, `order_id`, `issue_status` | string \| null | The linked complaint, its order and its current status; all `null` for a general chat |
| `opened_by_type` | `USER` \| `ADMIN` | Who started the chat |
| `status` | `OPEN` \| `AWAITING_AGENT` \| `AWAITING_CUSTOMER` \| `CLOSED` | `AWAITING_AGENT` = waiting for support; `AWAITING_CUSTOMER` = support replied; `OPEN` = support opened it, no message yet; `CLOSED` = final |
| `can_send` | boolean | `false` once closed — disable the input |
| `can_rate` | boolean | Show the rating prompt |
| `unread_count` | int | Support messages after the customer's read pointer |
| `last_read_message_id` | string | The customer's read pointer |
| `last_message_*` | | Preview for the chat list (`last_message_preview` ≤ 140 chars) |
| `closed_at` | string \| null | ISO time |
| `rating` | object \| null | `{ stars, comment, rated_at }` once rated |

### `Message`

```json
{
  "id": "1043",
  "chat_id": "8c1f2a4e-…",
  "sender_type": "ADMIN",
  "sender_name": "Support",
  "is_mine": false,
  "body": "Could you share a photo of the bill?",
  "attachments": [],
  "client_message_id": "7d3c…",
  "created_at": "2026-10-15T10:06:10.000Z"
}
```

| Field | Type | Notes |
|---|---|---|
| `id` | string | Ordering + paging cursor |
| `sender_type` | `USER` \| `ADMIN` | `USER` = the customer |
| `sender_name` | string \| null | `"Support"` for every support message; `null` for the customer's own |
| `is_mine` | boolean | Render on the right |
| `attachments` | array | Always `[]` for now |
| `client_message_id` | string | Match an optimistic bubble to the stored message |

---

## SSE events

Delivered on the app's existing stream, `GET /api/v1/stream/:clientId` (opened with the customer's JWT —
`Authorization` header or `?token=`), as event name **`issue_chat`**:

```json
{
  "type": "MESSAGE_CREATED",
  "chat": { "…": "full Chat, as above" },
  "message": { "…": "Message, or null" },
  "actor": { "type": "ADMIN" },
  "occurred_at": "2026-10-15T10:06:10.000Z"
}
```

| `type` | When | What the app does |
|---|---|---|
| `MESSAGE_CREATED` | Support sent a message | Append `message` if that chat is open (skip if its `id` is already shown); update the chat row from `chat` |
| `CHAT_OPENED` | Support started a chat with a message | Add the chat to the list; show the message |
| `CHAT_CLOSED` | Support closed the chat | Disable the input (`can_send: false`); show the rating prompt (`can_rate: true`) |

The customer's own messages are **not** echoed (the REST response already has them). `chat` is complete,
so the list row and the open chat can be updated without another request.

**Reconnect / app resume:** events are best-effort. After the stream reconnects, call
`GET /chats/:chat_id/messages?after=<highest id shown>` for the open chat and refresh the list. While the
stream is down and a chat is on screen, poll that call every ~15 s.

## Push notifications (app not connected)

| Trigger | Title | `data.type` |
|---|---|---|
| Support sent a message (or started a chat with one) | "Support sent you a message" | `issue_chat_message` |
| Support closed the chat | "Your support chat was closed. How did we do?" | `issue_chat_closed` |

`data` = `{ type, chat_id, issue_id, message_id? }` (all strings; `issue_id` is `""` for a general chat).
On tap, open `chat_id`. At most one message push per chat per minute.

---

## Error codes

Body: `{ "error": "<CODE>", "message": "…", "details"?: [{ "field", "issue" }] }`.

| HTTP | `error` | When | Frontend action |
|---|---|---|---|
| 400 | `VALIDATION_ERROR` | Empty/too-long body, bad `client_message_id`, bad cursor, bad rating | Fix the input; `details` names the field |
| 404 | `CHAT_NOT_FOUND` | Unknown chat, or not this customer's | Leave the chat screen |
| 404 | `ISSUE_NOT_FOUND` | `issue_id` isn't one of this customer's complaints | Show "complaint not found" |
| 404 | `MESSAGE_NOT_FOUND` | Read pointer not in this chat | Re-fetch the chat |
| 404 | `NOT_FOUND` | Support chat is switched off on the server (`enabled: false`) — every route except `/chats/availability` | Hide the chat entry points |
| 409 | `CHAT_CLOSED` | Sending to a closed chat | Disable input, show the rating prompt; a new message must go via `POST /chats` (new chat) |
| 409 | `TOO_MANY_ACTIVE_CHATS` | Would be a 6th open chat | Point the customer to their open chats |
| 409 | `NEW_CHATS_DISABLED` | `POST /chats` would start a new chat while support has new chats switched off (`new_chats_enabled: false`). Open chats are unaffected | Say chat isn't taking new conversations right now; keep the typed text; point to open chats |
| 409 | `CHAT_NOT_CLOSED` | Rating before close | Hide the rating prompt |
| 409 | `ALREADY_RATED` | Second rating | Hide the rating prompt |
| 429 | `RATE_LIMITED` | > 20 messages a minute in one chat | Back off, retry later |
| 401 | `Unauthorized` | Token missing/expired | Re-login |

---

## Changelog

- 2026-10-19 — Created (ISSUE-CHAT-01): general + complaint-linked support chats, live events on the
  existing stream, push notifications when offline, rating after close. Media attachments not yet supported.
- 2026-10-19 — Added "Chat lifecycle": status flow, no reopen (a new chat via `POST /chats` continues a
  closed one), closed-chat screen recipe, how to list history. Docs only — no API change. Demo data for
  building this screen: [`issue-chat-dev-setup.md`](./issue-chat-dev-setup.md).
- 2026-10-19 — New `GET /chats/availability` → `{ enabled, new_chats_enabled }`. Support can now stop **new**
  chats: `POST /chats` that would create one → `409 NEW_CHATS_DISABLED`; open chats keep working (send, read,
  rate, events, pushes). Additive — existing calls unchanged.
