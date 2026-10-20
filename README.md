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
cp .env.example .env    # set JWT_PRIVATE_KEY (same value as the backend)
npm run dev             # http://localhost:5173
```

The backend defaults to `https://ondc-api-chat.onrender.com`; set `VITE_API_TARGET` in `.env` to use a
local one (e.g. `http://localhost:3000`).

## Deploy (Vercel)

Import the GitHub repo into Vercel — the framework, build command and output folder come from
`vercel.json`. Add one environment variable, **`JWT_PRIVATE_KEY`** (same value as the backend), then
deploy. Every push to `main` redeploys.

`vercel.json` proxies `/api/v1/*` to the Render backend (same-origin, so the backend's CORS doesn't
matter) and routes `/dev-auth/*` to the sign-in function in `api/dev-auth.ts`. If the backend URL
changes, edit it there.

## Sign-in

Pick **Customer** or **Support agent**, then **Continue as guest** or click a person — no ids or tokens to paste.

- **Guests**: a guest customer gets an id like `guest-1a2b3c4d`, kept in this browser so they find their
  chats again; every guest agent shares `guest-admin`. They show up as "Guest customer" / "Guest agent".
- The session lasts for the browser tab only (sessionStorage): reloading keeps you signed in, but a new
  tab or a fresh visit starts at the sign-in screen.
- The UI never shows raw ids. Customer names come from their complaints (`created_by`) or the saved
  users list; agent names from the saved users list. Agents see each chat headed by the customer's name,
  customers see the complaint type ("Quality issue", "General question").
- **Saved people** are kept in each browser (localStorage); the seed agents `seed-admin-1..3` are built in.
- **Customers with complaints** are read live from `/admin/issues`, so after `npm run seed:issue-chat`
  the new demo customers show up by name without copying their ids.
- Sign-in tokens are signed on the server by `api/dev-auth.ts` (a Vercel function in production,
  mounted into the Vite server locally) with `JWT_PRIVATE_KEY`, exactly the way the backend verifies them.
  The key never reaches the browser. "Paste a token instead" still works under More options.

This is a demo login: anyone who can open the site can sign in as any customer or support agent,
and gets a real token for the backend. Don't use it with a backend that holds real customer data.
