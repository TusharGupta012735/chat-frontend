import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, adminApi, chatApi, configureClient, customerApi, errorText } from "./api/client";
import { emptyFilters, type Availability, type Chat, type ChatEvent, type ChatFilters, type ChatSettings } from "./api/types";
import { AdminNewChat } from "./components/AdminNewChat";
import { ChatView } from "./components/ChatView";
import { Login } from "./components/Login";
import { NewChat } from "./components/NewChat";
import { Sidebar } from "./components/Sidebar";
import { DirectoryProvider, useDirectory } from "./directory";
import { useEventStream } from "./hooks/useEventStream";
import { loadSession, saveSession, type Session } from "./session";
import { sortChats } from "./util";

export default function App() {
  const [session, setSession] = useState<Session | null>(() => loadSession());
  const [notice, setNotice] = useState("");

  const logout = useCallback((why = "") => {
    saveSession(null);
    setSession(null);
    setNotice(why);
  }, []);

  if (!session) {
    return (
      <Login
        notice={notice}
        onLogin={(s) => {
          saveSession(s);
          setNotice("");
          setSession(s);
        }}
      />
    );
  }
  return (
    <DirectoryProvider key={session.token} session={session}>
      <ChatApp session={session} onLogout={logout} />
    </DirectoryProvider>
  );
}

const PAGE_SIZE = 20;

/** Does this chat belong in the list under the current filters? Mirrors the server's filtering. */
function matches(c: Chat, f: ChatFilters, session: Session): boolean {
  if (f.linked === "general" && c.issue_id) return false;
  if (f.linked === "issue" && !c.issue_id) return false;
  if (f.issue_id.trim() && c.issue_id !== f.issue_id.trim()) return false;
  if (session.role === "customer") {
    if (f.status === "active" && c.status === "CLOSED") return false;
    if (f.status === "closed" && c.status !== "CLOSED") return false;
    return true;
  }
  if (f.status) {
    if (!f.status.split(",").includes(c.status)) return false;
  } else if (!f.rated && c.status === "CLOSED") return false;
  if (f.rated === "true" && !(c.status === "CLOSED" && c.rating)) return false;
  if (f.rated === "false" && !(c.status === "CLOSED" && !c.rating)) return false;
  if (f.customer_id.trim() && c.customer_id !== f.customer_id.trim()) return false;
  if (f.issue_level && c.issue_level !== f.issue_level) return false;
  const a = f.assigned.trim();
  if (a === "me" && c.assigned_to_id !== session.userId) return false;
  if (a === "unassigned" && c.assigned_to_id) return false;
  if (a && a !== "me" && a !== "unassigned" && c.assigned_to_id !== a) return false;
  if (f.unread_only && !(c.unread_count > 0 && c.last_message_sender === "USER")) return false;
  return true;
}

function ChatApp({ session, onLogout }: { session: Session; onLogout: (why?: string) => void }) {
  const isAdmin = session.role === "admin";
  configureClient(session.token, () => onLogout("Your session has expired. Please sign in again."));
  const api = chatApi(session.role);
  const dir = useDirectory();

  const [chats, setChats] = useState<Chat[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ChatFilters>(emptyFilters);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const [banner, setBanner] = useState("");

  const [availability, setAvailability] = useState<Availability | null>(null);
  const [settings, setSettings] = useState<ChatSettings | null>(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [unreadTotal, setUnreadTotal] = useState(0);

  const [incoming, setIncoming] = useState<{ seq: number; event: ChatEvent } | null>(null);
  const [reconnectSeq, setReconnectSeq] = useState(0);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const listSeq = useRef(0);

  // ── Feature availability ──────────────────────────────────────────────────
  const checkAvailability = useCallback(async () => {
    try {
      if (isAdmin) setSettings(await adminApi.getSettings());
      else setAvailability(await customerApi.availability());
    } catch (err) {
      setBanner(errorText(err));
    }
  }, [isAdmin]);

  useEffect(() => {
    void checkAvailability();
    const onVisible = () => document.visibilityState === "visible" && void checkAvailability();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [checkAvailability]);

  const chatEnabled = isAdmin ? settings?.env_enabled !== false : availability?.enabled !== false;
  const newChatsEnabled = isAdmin ? true : availability?.new_chats_enabled ?? false;

  // ── Unread badge ─────────────────────────────────────────────────────────
  // Customer: sum the first page of active chats (there is no unread endpoint).
  // Admin: count of chats that need a reply.
  const refreshUnread = useCallback(async () => {
    try {
      if (isAdmin) {
        const r = await api.list({ ...emptyFilters, unread_only: true }, 1, 1);
        setUnreadTotal(r.pagination.total);
      } else {
        const r = await api.list({ ...emptyFilters, status: "active" }, 1, 50);
        setUnreadTotal(r.data.reduce((n, c) => n + c.unread_count, 0));
      }
    } catch {
      /* badge is best-effort */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    document.title = unreadTotal > 0 ? `(${unreadTotal}) Support Chat` : "Support Chat";
  }, [unreadTotal]);

  // ── Chat list ────────────────────────────────────────────────────────────
  const loadList = useCallback(
    async (pageNo: number, append: boolean) => {
      const seq = ++listSeq.current;
      setListLoading(true);
      try {
        const res = await api.list(filtersRef.current, pageNo, PAGE_SIZE);
        if (seq !== listSeq.current) return;
        setChats((cur) => {
          if (!append) return res.data;
          const ids = new Set(cur.map((c) => c.chat_id));
          return [...cur, ...res.data.filter((c) => !ids.has(c.chat_id))];
        });
        setTotal(res.pagination.total);
        setPage(pageNo);
        setListError("");
      } catch (err) {
        if (seq !== listSeq.current) return;
        setListError(errorText(err));
        if (err instanceof ApiError && err.code === "NOT_FOUND") void checkAvailability();
      } finally {
        if (seq === listSeq.current) setListLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isAdmin, checkAvailability],
  );

  const refreshAll = useCallback(() => {
    void loadList(1, false);
    void refreshUnread();
  }, [loadList, refreshUnread]);

  // Debounce filter changes so typing an id doesn't fire a request per key.
  useEffect(() => {
    if (!chatEnabled) return;
    const t = window.setTimeout(() => void loadList(1, false), 300);
    return () => window.clearTimeout(t);
  }, [filters, chatEnabled, loadList]);

  useEffect(() => {
    if (chatEnabled) void refreshUnread();
  }, [chatEnabled, refreshUnread]);

  const chatsRef = useRef(chats);
  chatsRef.current = chats;

  // Pick up names for customers/complaints that appeared after the directory loaded.
  const { noteChats } = dir;
  useEffect(() => noteChats(chats), [chats, noteChats]);

  /** Put the latest version of a chat into the list (or take it out if it no longer matches). */
  const upsertChat = useCallback(
    (c: Chat) => {
      const present = chatsRef.current.some((x) => x.chat_id === c.chat_id);
      const fits = matches(c, filtersRef.current, session);
      if (fits && !present) setTotal((t) => t + 1);
      if (!fits && present) setTotal((t) => Math.max(0, t - 1));
      setChats((cur) => {
        const rest = cur.filter((x) => x.chat_id !== c.chat_id);
        return fits ? sortChats([c, ...rest]) : rest;
      });
    },
    [session],
  );

  const onChatUpdate = useCallback(
    (c: Chat) => {
      upsertChat(c);
      void refreshUnread();
    },
    [upsertChat, refreshUnread],
  );

  // ── Live stream ──────────────────────────────────────────────────────────
  const seq = useRef(0);
  const connected = useEventStream(
    session.role,
    session.token,
    (event) => {
      upsertChat(event.chat);
      setIncoming({ seq: ++seq.current, event });
      void refreshUnread();
    },
    () => {
      refreshAll();
      setReconnectSeq((n) => n + 1);
    },
  );

  // ── Admin: new-chats switch ──────────────────────────────────────────────
  const toggleNewChats = async (v: boolean) => {
    setSettingsBusy(true);
    try {
      setSettings(await adminApi.setSettings(v));
    } catch (err) {
      setBanner(errorText(err));
    } finally {
      setSettingsBusy(false);
    }
  };

  const showCustomerHistory = (customerId: string) => {
    setFilters({ ...emptyFilters, customer_id: customerId, status: "OPEN,AWAITING_AGENT,AWAITING_CUSTOMER,CLOSED" });
  };

  if (!chatEnabled) {
    return (
      <div className="login">
        <div className="login-card">
          <h1>Support chat is unavailable</h1>
          <p>
            {isAdmin
              ? "Support chat is disabled by server configuration (ISSUE_CHAT_ENABLED)."
              : "Support chat isn't available right now."}
          </p>
          <div className="filter-buttons">
            <button className="btn btn-primary" onClick={() => void checkAvailability()}>Check again</button>
            <button className="btn btn-secondary" onClick={() => onLogout()}>Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        role={session.role}
        userId={session.userId}
        userName={session.name}
        chats={chats}
        total={total}
        loading={listLoading}
        error={listError}
        filters={filters}
        onFilters={setFilters}
        selectedId={selected}
        onSelect={setSelected}
        onNew={() => {
          void checkAvailability();
          setSelected("new");
        }}
        canStartNew={newChatsEnabled}
        onLoadMore={() => void loadList(page + 1, true)}
        onRefresh={refreshAll}
        unreadTotal={unreadTotal}
        connected={connected}
        onLogout={() => onLogout()}
        settings={settings}
        onToggleNewChats={(v) => void toggleNewChats(v)}
        settingsBusy={settingsBusy}
      />
      <main className="main">
        {banner && (
          <div className="banner banner-error top-banner">
            {banner}
            <button className="link" onClick={() => setBanner("")}>Dismiss</button>
          </div>
        )}
        {selected === "new" && isAdmin ? (
          <AdminNewChat
            onCreated={(c) => {
              onChatUpdate(c);
              setSelected(c.chat_id);
            }}
            onOpenChat={setSelected}
            onCancel={() => setSelected(null)}
          />
        ) : selected === "new" ? (
          <NewChat
            newChatsEnabled={newChatsEnabled}
            onCreated={(c) => {
              onChatUpdate(c);
              setSelected(c.chat_id);
            }}
            onCancel={() => setSelected(null)}
          />
        ) : selected ? (
          <ChatView
            key={selected}
            role={session.role}
            userId={session.userId}
            chatId={selected}
            newChatsEnabled={newChatsEnabled}
            incoming={incoming}
            reconnectSeq={reconnectSeq}
            connected={connected}
            onChatUpdate={onChatUpdate}
            onNavigate={setSelected}
            onLeave={(why) => {
              setSelected(null);
              setBanner(why);
              refreshAll();
            }}
            onChatUnavailable={() => void checkAvailability()}
            onShowCustomerHistory={showCustomerHistory}
          />
        ) : (
          <div className="center-msg">
            <div className="empty-art" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </div>
            <div className="empty-title">{chats.length > 0 ? "Pick a conversation" : isAdmin ? "No chats here" : "No chats yet"}</div>
            <div className="muted small">
              {chats.length > 0 ? "Choose a chat from the list to read and reply." : isAdmin ? "Try another tab, or start a new chat." : "Start a chat and our support team will help you."}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
