# Support Chat — Demo Data & Test Tokens (frontend development)

**Audience**: Buyer-app and admin-panel frontend developers building the support-chat screens against
the **test** environment. Not for production.

## Purpose

The test environment can be filled with realistic demo customers, complaints and chats, so every chat
screen and state can be built without creating data by hand. This page lists what exists, which
scenario each covers, and how to get tokens to act as a demo customer or a demo admin.

API contracts: [`issue-chat.md`](./issue-chat.md) (customer), [`admin-chats.md`](./admin-chats.md)
(admin), [`authentication.md`](./authentication.md) (tokens).

---

## Getting the data

The backend team (re)creates it with one command (`npm run seed:issue-chat`); ask them to run it. Each
run **replaces** the previous demo data — ids change, and any chat you created as a demo customer is
removed. The command prints the demo customers' `user_id`s; you can also find them in the admin inbox
(`customer_id` on any row).

## Tokens

Tokens are minted by the backend Postman collection (it holds the signing key — **never put that key
or a minting step in frontend code**). Ask the backend team for a pair, or use the collection yourself:

| You want to act as | Set in Postman | Use |
|---|---|---|
| A demo customer | `customerId` = a demo `user_id`, then clear `tokenExp` | `accessToken` |
| A demo admin | `adminId` = `seed-admin-1` (or `-2`, `-3`), then clear `tokenExp` | `adminAccessToken` |

Tokens last **1 hour**. Paste them wherever your app reads its token in dev. The admin id is the token's
`user.id`, so `assigned=me` shows the chats of whichever `seed-admin-N` you picked. Demo admins are named
`seed-admin-1..3` unless the backend team seeded with your own id.

> Don't use an admin id starting with `flow-admin-` — the backend test cleanup deletes every chat such
> an admin touched.

---

## What exists

**10 demo customers** (Aarav Sharma, Ananya Iyer, Rohan Mehta, Priya Nair, Kabir Singh, Ishita Reddy,
Vihaan Gupta, Meera Joshi, Arjun Rao, Sanya Kapoor; mobiles `9999900001`–`9999900010`). Each has
**10 delivered orders**, **1 complaint per order** (every user-facing complaint category, statuses
`OPEN` → `CLOSED`, some at `GRIEVANCE` level) and **11 chats**:

| # | Chat | `status` | Linked | What to build/test with it |
|---|---|---|---|---|
| 1 | Customer wrote last, support hasn't read it | `AWAITING_AGENT` | complaint | Admin inbox `unread_only=true`, unread badge for admins |
| 2 | Customer wrote last, support has read it | `AWAITING_AGENT` | complaint | "Seen" state, no admin badge |
| 3 | Support replied, customer hasn't read it | `AWAITING_CUSTOMER` | complaint (`GRIEVANCE`) | Customer unread badge, `issue_level=GRIEVANCE` filter |
| 4 | Support opened it, no messages yet | `OPEN` | complaint | Empty chat screen, unassigned row (`assigned=unassigned`) |
| 5 | Closed, rated 5★ with comment | `CLOSED` | complaint | Rating display |
| 6 | Closed, rated 4★ without comment | `CLOSED` | complaint | Rating without comment |
| 7 | Closed, rated 2★ with comment | `CLOSED` | complaint | Low-rating display |
| 8 | Closed, not rated | `CLOSED` | complaint | Rating prompt (`can_rate: true`), "Start a new chat", `rated=false` |
| 9 | Closed, not rated | `CLOSED` | complaint (`GRIEVANCE`) | Same, on a grievance |
| 10 | Active general chat | `AWAITING_AGENT` or `AWAITING_CUSTOMER` (alternates by customer) | general | The customer's "Support" conversation |
| 11 | 40-message closed general chat, rated 4★ | `CLOSED` | general | Scroll-up paging (`before=`, `has_more_before`), `linked=general` timeline with a divider |

Plus **one complaint with no chat** per customer — for the "Chat with support" entry point on a
complaint (`POST /chats` with its `issue_id` → `201`).

Which complaint/order gets which chat differs per customer, and chats are assigned across
`seed-admin-1..3`, so every admin has a mix.

## Scenarios worth testing

| Scenario | How |
|---|---|
| 5-open-chats limit | Any demo customer already has 5 open chats → `POST /chats` for a new topic returns `409 TOO_MANY_ACTIVE_CHATS` |
| Start a new chat after close | As admin, close the customer's open general chat (`PATCH /admin/chats/:chat_id` `{ "status": "CLOSED" }`), then as the customer `POST /chats` without `issue_id` → `201`, new chat |
| Sending to a closed chat | `POST /chats/:chat_id/messages` on chat 8 → `409 CHAT_CLOSED` |
| Rate | `POST /chats/:chat_id/rating` on chat 8 → returns the rated chat; again → `409 ALREADY_RATED` |
| Live events | Open the customer stream and the admin stream, then send from one side — see `issue_chat` events in [`issue-chat.md`](./issue-chat.md#sse-events) |
| New chats switched off | As admin, `PATCH /admin/chat-settings` `{ "new_chats_enabled": false }` → customer `GET /chats/availability` → `new_chats_enabled: false`; sending in an open chat still works; after closing a chat, `POST /chats` for a new one → `409 NEW_CHATS_DISABLED`. Admin `POST /admin/chats` still opens new chats. **Turn it back on when done** — it affects every tester on the environment |

## Limits of the demo data

- **No attachments** — send media through the API if needed (not supported yet anyway).
- **Orders are display-only**: the demo `order_id`s (`SEED-…`) and complaints exist for the chat screens,
  but order screens (order history/detail, status, tracking) may not load them. Don't build order flows
  on this data.
- **No real login**: demo customers can't log in through the app (their numbers are fake) — use minted
  tokens.
- **No push notifications**: demo customers have no devices, so offline pushes go nowhere; use the
  live stream.

---

## Changelog

- 2026-10-19 — Created: demo data contents per customer, scenario map, test tokens, limits.
- 2026-10-19 — Added the "new chats switched off" scenario (admin switch).
