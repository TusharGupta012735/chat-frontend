import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ApiError, adminApi, chatApi, customerApi, errorText, newClientMessageId } from "../api/client";
import type { Chat, ChatEvent, Message, Role } from "../api/types";
import { initials, useDirectory } from "../directory";
import { ADMIN_STATUS_LABEL, STATUS_LABEL, compareIds, formatDay, formatTime, humanize, maxId } from "../util";
import { Composer } from "./Composer";
import { RatingPrompt, RatingView } from "./Rating";

/** A message typed here that the server hasn't stored yet. */
interface Pending {
  client_message_id: string;
  body: string;
  state: "sending" | "failed";
  error?: string;
}

interface Props {
  role: Role;
  userId: string;
  chatId: string;
  newChatsEnabled: boolean;
  incoming: { seq: number; event: ChatEvent } | null;
  reconnectSeq: number;
  connected: boolean;
  onChatUpdate: (chat: Chat) => void;
  onNavigate: (chatId: string) => void;
  onLeave: (reason: string) => void;
  onChatUnavailable: () => void;
  onShowCustomerHistory: (customerId: string) => void;
}

const POLL_MS = 15_000;

export function ChatView(p: Props) {
  const isAdmin = p.role === "admin";
  const api = chatApi(p.role);
  const dir = useDirectory();

  const [chat, setChat] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMoreBefore, setHasMoreBefore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const preserveScroll = useRef<number | null>(null);
  const lastReadSent = useRef<string | null>(null);
  const chatRef = useRef<Chat | null>(null);
  chatRef.current = chat;
  const messagesRef = useRef<Message[]>([]);
  messagesRef.current = messages;
  const { onChatUpdate, onLeave, onChatUnavailable } = p;

  const applyChat = useCallback(
    (c: Chat) => {
      setChat(c);
      onChatUpdate(c);
    },
    [onChatUpdate],
  );

  /** Adds stored messages (deduped by id, kept oldest-first) and drops matching optimistic bubbles. */
  const mergeMessages = useCallback((incoming: Message[]) => {
    if (incoming.length === 0) return;
    setMessages((cur) => {
      const byId = new Map(cur.map((m) => [m.id, m]));
      for (const m of incoming) byId.set(m.id, m);
      return [...byId.values()].sort((a, b) => compareIds(a.id, b.id));
    });
    const cmids = new Set(incoming.map((m) => m.client_message_id).filter(Boolean));
    setPending((cur) => cur.filter((x) => !cmids.has(x.client_message_id)));
  }, []);

  const handleError = useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError) {
        if (err.code === "CHAT_NOT_FOUND") onLeave(errorText(err));
        if (err.code === "NOT_FOUND") onChatUnavailable();
      }
      return errorText(err);
    },
    [onLeave, onChatUnavailable],
  );

  // ── Load the chat whenever the selection changes ──────────────────────────
  const load = useCallback(async () => {
    try {
      const res = await api.get(p.chatId, 30);
      stickToBottom.current = true;
      setMessages(res.messages);
      setHasMoreBefore(res.has_more_before);
      applyChat(res.chat);
      setLoadError("");
    } catch (err) {
      setLoadError(handleError(err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.chatId, p.role]);

  useEffect(() => {
    setChat(null);
    setMessages([]);
    setPending([]);
    setDraft("");
    setNotice("");
    setConfirmClose(false);
    setLoadError("");
    lastReadSent.current = null;
    void load();
  }, [load]);

  /** Fetch everything newer than what's shown (after a reconnect, or while polling). */
  const catchUp = useCallback(async () => {
    const newest = messagesRef.current[messagesRef.current.length - 1]?.id;
    try {
      if (!newest) {
        await load();
        return;
      }
      let after = newest;
      for (let i = 0; i < 10; i++) {
        const page = await api.messagesAfter(p.chatId, after);
        mergeMessages(page.messages);
        if (!page.has_more || page.messages.length === 0) break;
        after = page.messages[page.messages.length - 1].id;
      }
      // The chat row (status, read markers) may also have moved on while we weren't listening.
      const fresh = await api.get(p.chatId, 1);
      applyChat(fresh.chat);
    } catch (err) {
      handleError(err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.chatId, p.role, load, mergeMessages, applyChat, handleError]);

  useEffect(() => {
    if (p.reconnectSeq > 0) void catchUp();
  }, [p.reconnectSeq, catchUp]);

  // While the live stream is down, poll so the screen doesn't go stale.
  useEffect(() => {
    if (p.connected) return;
    const t = window.setInterval(() => void catchUp(), POLL_MS);
    return () => window.clearInterval(t);
  }, [p.connected, catchUp]);

  // ── Live events ───────────────────────────────────────────────────────────
  useEffect(() => {
    const ev = p.incoming?.event;
    if (!ev || ev.chat.chat_id !== p.chatId) return;
    setChat(ev.chat);
    if (ev.message) mergeMessages([ev.message]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.incoming]);

  // ── Mark read: move the pointer to the newest message on screen ───────────
  useEffect(() => {
    const newest = messages[messages.length - 1]?.id;
    if (!chat || !newest) return;
    const pointer = maxId(chat.last_read_message_id, lastReadSent.current);
    if (pointer && compareIds(newest, pointer) <= 0) return;
    const send = () => {
      if (document.visibilityState !== "visible") return;
      lastReadSent.current = newest;
      api
        .markRead(chat.chat_id, newest)
        .then((r) => {
          const c = chatRef.current;
          if (c && c.chat_id === chat.chat_id) {
            applyChat({ ...c, unread_count: r.unread_count, last_read_message_id: maxId(c.last_read_message_id, newest) });
          }
        })
        .catch((err) => {
          if (err instanceof ApiError && err.code === "MESSAGE_NOT_FOUND") void load();
          else lastReadSent.current = null;
        });
    };
    send();
    document.addEventListener("visibilitychange", send);
    return () => document.removeEventListener("visibilitychange", send);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, chat?.chat_id, chat?.last_read_message_id]);

  // ── Scrolling ─────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (preserveScroll.current !== null) {
      el.scrollTop = el.scrollHeight - preserveScroll.current;
      preserveScroll.current = null;
    } else if (stickToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const loadOlder = async () => {
    const oldest = messages[0]?.id;
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await api.messagesBefore(p.chatId, oldest);
      const el = scrollRef.current;
      preserveScroll.current = el ? el.scrollHeight - el.scrollTop : null;
      mergeMessages(page.messages);
      setHasMoreBefore(page.has_more);
    } catch (err) {
      setNotice(handleError(err));
    } finally {
      setLoadingOlder(false);
    }
  };

  // ── Sending ───────────────────────────────────────────────────────────────
  const sendPending = async (item: Pending) => {
    setPending((cur) => {
      const rest = cur.filter((x) => x.client_message_id !== item.client_message_id);
      return [...rest, { ...item, state: "sending", error: undefined }];
    });
    stickToBottom.current = true;
    try {
      const res = await api.send(p.chatId, item.client_message_id, item.body);
      if (res.message) mergeMessages([res.message]);
      applyChat(res.chat);
    } catch (err) {
      if (err instanceof ApiError && err.code === "CHAT_CLOSED") {
        // Stale screen: switch to the closed state and keep what was typed.
        setPending((cur) => cur.filter((x) => x.client_message_id !== item.client_message_id));
        setDraft(item.body);
        setNotice(errorText(err));
        void load();
        return;
      }
      const msg = handleError(err);
      setPending((cur) =>
        cur.map((x) => (x.client_message_id === item.client_message_id ? { ...x, state: "failed", error: msg } : x)),
      );
    }
  };

  const send = (text: string) => {
    setNotice("");
    void sendPending({ client_message_id: newClientMessageId(), body: text, state: "sending" });
  };

  // ── Closed chat actions ───────────────────────────────────────────────────
  const startNewChat = async (text: string) => {
    if (!chat) return;
    setBusy(true);
    setNotice("");
    try {
      const res = isAdmin
        ? await adminApi.open(
            chat.issue_id ? { issue_id: chat.issue_id } : { customer_id: chat.customer_id ?? "" },
            text ? { clientMessageId: newClientMessageId(), text } : undefined,
          )
        : await customerApi.open(newClientMessageId(), text, chat.issue_id ?? undefined);
      setDraft("");
      onChatUpdate(res.chat);
      p.onNavigate(res.chat.chat_id);
    } catch (err) {
      setNotice(handleError(err));
      setDraft(text);
    } finally {
      setBusy(false);
    }
  };

  const closeChat = async () => {
    if (!chat) return;
    setBusy(true);
    try {
      const res = await adminApi.close(chat.chat_id);
      applyChat(res.chat);
      setConfirmClose(false);
    } catch (err) {
      setNotice(handleError(err));
    } finally {
      setBusy(false);
    }
  };

  const rate = async (stars: number, comment: string) => {
    if (!chat) return;
    try {
      const res = await customerApi.rate(chat.chat_id, stars, comment.trim() || undefined);
      applyChat(res.chat);
    } catch (err) {
      if (err instanceof ApiError && (err.code === "ALREADY_RATED" || err.code === "CHAT_NOT_CLOSED")) void load();
      throw new Error(handleError(err));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (loadError && !chat) {
    return (
      <section className="chat-pane">
        <div className="center-msg">
          <div className="banner banner-error">{loadError}</div>
          <button className="btn" onClick={() => void load()}>Try again</button>
        </div>
      </section>
    );
  }
  if (!chat) {
    return (
      <section className="chat-pane">
        <div className="center-msg muted">Loading chat…</div>
      </section>
    );
  }

  const lastAdminMsg = isAdmin ? [...messages].reverse().find((m) => m.sender_type === "ADMIN") : undefined;
  const seenId = chat.customer_last_read_message_id;
  const statusLabel = (isAdmin ? ADMIN_STATUS_LABEL : STATUS_LABEL)[chat.status];
  const title = dir.title(chat);
  const issue = dir.issue(chat.issue_id);

  return (
    <section className="chat-pane">
      <header className="chat-head">
        <span className={`avatar avatar-lg ${isAdmin ? "" : "avatar-topic"}`} aria-hidden>
          {isAdmin ? initials(title) : chat.issue_id ? "!" : "?"}
        </span>
        <div className="chat-head-main">
          <h2>{title}</h2>
          <div className="chat-meta">
            <span className={`status status-${chat.status}`}>{statusLabel}</span>
            {isAdmin && <span>{dir.topic(chat)}</span>}
            {issue?.summary && <span className="muted">“{issue.summary}”</span>}
            {chat.issue_status && <span className="muted">Complaint {humanize(chat.issue_status).toLowerCase()}</span>}
            {chat.issue_level === "GRIEVANCE" && <span className="tag tag-warn">Grievance</span>}
          </div>
          <div className="chat-meta muted">
            <span>
              Started {formatTime(chat.created_at)} by {chat.opened_by_type === "ADMIN" ? (isAdmin ? dir.agentName(chat.opened_by_id) : "support") : isAdmin ? "the customer" : "you"}
            </span>
            {isAdmin && (
              <span>
                {chat.assigned_to_id ? `Assigned to ${dir.agentName(chat.assigned_to_id)}` : "Unassigned — first reply takes it"}
              </span>
            )}
            {isAdmin && chat.closed_by_id && <span>Closed by {dir.agentName(chat.closed_by_id)}</span>}
          </div>
        </div>
        {isAdmin && (
          <div className="chat-head-actions">
            {chat.customer_id && (
              <button className="btn btn-subtle btn-sm" onClick={() => p.onShowCustomerHistory(chat.customer_id!)}>
                All chats with {title.split(" ")[0]}
              </button>
            )}
            {chat.status !== "CLOSED" &&
              (confirmClose ? (
                <span className="confirm">
                  <span className="small">Close this chat?</span>
                  <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => void closeChat()}>Close</button>
                  <button className="btn btn-subtle btn-sm" onClick={() => setConfirmClose(false)}>Cancel</button>
                </span>
              ) : (
                <button className="btn btn-danger-outline btn-sm" onClick={() => setConfirmClose(true)}>Close chat</button>
              ))}
          </div>
        )}
      </header>

      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        {hasMoreBefore && (
          <div className="older">
            <button className="btn btn-ghost" disabled={loadingOlder} onClick={() => void loadOlder()}>
              {loadingOlder ? "Loading…" : "Load earlier messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && pending.length === 0 && (
          <div className="center-msg muted">
            {isAdmin ? "No messages yet. Write the first one below." : "No messages yet."}
          </div>
        )}
        {messages.map((m, i) => {
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
          const mine = isAdmin ? m.sender_type === "ADMIN" : m.is_mine;
          const who = isAdmin
            ? m.sender_type === "USER"
              ? title
              : dir.agentName(m.sender_id)
            : m.is_mine
              ? "You"
              : m.sender_name ?? "Support";
          return (
            <div key={m.id}>
              {newDay && <div className="day-sep">{formatDay(m.created_at)}</div>}
              <div className={`bubble-row ${mine ? "mine" : "theirs"}`}>
                <div className={`bubble ${isAdmin && mine && m.sender_id !== p.userId ? "bubble-colleague" : ""}`}>
                  <div className="bubble-who">{who}</div>
                  <div className="bubble-body">{m.body}</div>
                  <div className="bubble-time">
                    {formatTime(m.created_at)}
                    {isAdmin && m.id === lastAdminMsg?.id && seenId && compareIds(seenId, m.id) >= 0 && " · Seen"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {pending.map((x) => (
          <div key={x.client_message_id} className="bubble-row mine">
            <div className={`bubble pending ${x.state}`}>
              <div className="bubble-who">You</div>
              <div className="bubble-body">{x.body}</div>
              <div className="bubble-time">
                {x.state === "sending" ? (
                  "Sending…"
                ) : (
                  <>
                    <span className="fail">Not sent: {x.error}</span>{" "}
                    <button className="link" onClick={() => void sendPending(x)}>Retry</button>{" "}
                    <button
                      className="link"
                      onClick={() => setPending((cur) => cur.filter((y) => y.client_message_id !== x.client_message_id))}
                    >
                      Discard
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {chat.status === "CLOSED" && (
          <div className="day-sep">Chat closed {formatTime(chat.closed_at)}</div>
        )}
      </div>

      {notice && (
        <div className="banner banner-warn chat-notice">
          {notice}
          <button className="link" onClick={() => setNotice("")}>Dismiss</button>
        </div>
      )}

      {chat.can_send ? (
        <Composer key={chat.chat_id} initial={draft} onSend={send} placeholder="Type your message…" />
      ) : (
        <div className="closed-panel">
          {chat.rating ? (
            <RatingView rating={chat.rating} who={isAdmin ? "The customer" : "You"} />
          ) : !isAdmin && chat.can_rate ? (
            <RatingPrompt onSubmit={rate} />
          ) : (
            isAdmin && <div className="muted">The customer hasn't rated this chat.</div>
          )}
          {isAdmin || p.newChatsEnabled ? (
            <div className="new-chat-after-close">
              <div className="muted">
                {isAdmin
                  ? "This chat is closed. To talk to the customer again, start a new chat (message optional)."
                  : "This chat is closed. Need more help? Start a new chat."}
              </div>
              <Composer
                key={`new-${chat.chat_id}`}
                initial={draft}
                onSend={(t) => void startNewChat(t)}
                allowEmpty={isAdmin}
                clearOnSend={false}
                busy={busy}
                buttonLabel="Start a new chat"
                placeholder={isAdmin ? "Optional first message…" : "Type your message…"}
              />
            </div>
          ) : (
            <div className="muted">Support chat isn't taking new conversations right now.</div>
          )}
        </div>
      )}
    </section>
  );
}
