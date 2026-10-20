# Support Chat — web frontend

A web client for the ondc-api support chat (`docs/issue-chat.md`, `docs/admin-chats.md`). It has two modes,
chosen at sign-in:

- **Customer**: lists my chats (filter by open/closed, general/complaint, complaint id), starts a chat (general
  or about a complaint), sends and retries messages, loads older history, marks messages read, rates a closed
  chat, and starts a new chat after one is closed. It checks `GET /chats/availability` and hides "start a chat"
  while support has new chats switched off.
- **Admin**: the inbox with every filter (status, assigned me/unassigned/admin id, needs reply, topic,
  complaint id, customer id, level, rated). It opens a chat by complaint or customer, with an optional first
  message, and can reply, mark read, close, show a customer's full history, show the "Seen" marker, and
  switch new chats on or off (`/admin/chat-settings`).

Live updates come from the `issue_chat` SSE event (`/stream/:clientId` for customers, `/admin/stream` for
admins). After a reconnect the app catches up with `messages?after=`. While the stream is down it polls every 15 s.

## Run

```bash
npm install
cp .env.example .env    # then set JWT_PRIVATE_KEY (and VITE_API_TARGET if the backend isn't on localhost:3000)
npm run dev             # http://localhost:5173
```

## Sign-in

Pick **Customer** or **Support agent**, then **Continue as guest** or click a person — no ids or tokens to paste.

- **Guests**: a guest customer gets an id like `guest-1a2b3c4d`, kept in this browser so they find their
  chats again; every guest agent shares `guest-admin`. They show up as "Guest customer" / "Guest agent".
- The session lasts for the browser tab only (sessionStorage): reloading keeps you signed in, but a new
  tab or a fresh visit starts at the sign-in screen.
- The UI never shows raw ids. Customer names come from their complaints (`created_by`) or the saved
  users list; agent names from the saved users list. Agents see each chat headed by the customer's name,
  customers see the complaint type ("Quality issue", "General question").

- The dev server (`dev-auth.ts`, a Vite plugin) signs the token with `JWT_PRIVATE_KEY` from `.env`, the
  same value as in `ondc-api/.env`, exactly the way the backend verifies it (HS256, `user.id` + `role`).
  The key has no `VITE_` prefix, so it never reaches the browser. Sign-ins last `DEV_TOKEN_HOURS` (8).
- **Saved users** live in `users.json` (gitignored; starts from `users.example.json`, which has
  `seed-admin-1..3`). Add or remove them on the sign-in screen.
- **Customers with complaints** are read live from `/admin/issues`, so after `npm run seed:issue-chat`
  the new demo customers show up by name without copying their ids. "Save" pins one to the saved list.
- Quick sign-in only works under `npm run dev` / `npm run preview`. Anywhere else, use
  "Paste a token instead" with a token from the backend Postman collection.

This is a development convenience: anyone who can reach the dev server can sign in as anyone. Don't
expose it beyond localhost, and don't deploy `dev-auth.ts` with a real production key.

The dev server proxies `/api` to the backend, so every call is same-origin. This matters because the
backend's CORS config only allows GET/POST, which would block the admin PATCH calls (close chat, chat
settings) if the app called the backend directly. In production, serve the built `dist/` behind the same
origin as the API, or add PATCH to the backend's CORS `methods`.
