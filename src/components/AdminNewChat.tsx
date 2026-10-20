import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminApi, adminIssuesApi, chatApi, errorText, newClientMessageId } from "../api/client";
import {
  emptyFilters,
  type AdminIssue,
  type AdminIssueDetail,
  type Chat,
  type IssueLevelAll,
  type IssueStatus,
} from "../api/types";
import { useDirectory } from "../directory";
import { ADMIN_STATUS_LABEL, CATEGORY_CODES, categoryLabel, formatTime, humanize, looksLikeName } from "../util";
import { Composer } from "./Composer";

interface Props {
  onCreated: (chat: Chat) => void;
  onOpenChat: (chatId: string) => void;
  onCancel: () => void;
}

type Mode = "complaint" | "customer";

const PAGE = 50;
const ALL_CHAT_STATUSES = "OPEN,AWAITING_AGENT,AWAITING_CUSTOMER,CLOSED";

/**
 * Admin: pick a complaint, or a customer who has raised complaints, and open a chat about it.
 * The complaint list follows igm-ui's "All issues" page: status tiles that double as filters,
 * a search box, and cards with a status strip.
 */
export function AdminNewChat({ onCreated, onOpenChat, onCancel }: Props) {
  const [mode, setMode] = useState<Mode>("complaint");
  const [issueId, setIssueId] = useState<string | null>(null);
  const [customer, setCustomer] = useState<{ id: string; name: string | null } | null>(null);

  return (
    <section className="chat-pane">
      <header className="chat-head">
        <div className="chat-head-main">
          <h2>New chat</h2>
          <div className="tabs tabs-sm" role="tablist">
            <button role="tab" aria-selected={mode === "complaint"} className={mode === "complaint" ? "on" : ""} onClick={() => setMode("complaint")}>
              By complaint
            </button>
            <button role="tab" aria-selected={mode === "customer"} className={mode === "customer" ? "on" : ""} onClick={() => setMode("customer")}>
              By customer
            </button>
          </div>
        </div>
        <div className="chat-head-actions">
          <button className="btn btn-subtle btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </header>

      <div className="picker">
        {mode === "complaint" ? (
          <>
            <ComplaintList selected={issueId} onSelect={setIssueId} />
            <div className="picker-detail">
              {issueId ? (
                <ComplaintPanel
                  key={issueId}
                  issueId={issueId}
                  onCreated={onCreated}
                  onOpenChat={onOpenChat}
                  onPickCustomer={(id, name) => {
                    setCustomer({ id, name });
                    setMode("customer");
                  }}
                />
              ) : (
                <div className="center-msg muted">Choose a complaint from the list to chat with the customer about it.</div>
              )}
            </div>
          </>
        ) : (
          <>
            <CustomerList selected={customer?.id ?? null} onSelect={(id, name) => setCustomer({ id, name })} />
            <div className="picker-detail">
              {customer ? (
                <CustomerPanel key={customer.id} customerId={customer.id} name={customer.name} onCreated={onCreated} onOpenChat={onOpenChat} />
              ) : (
                <div className="center-msg muted">Choose a customer from the list.</div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

// ── Complaints ──────────────────────────────────────────────────────────────

const STATUS_TILES: { key: IssueStatus | ""; label: string }[] = [
  { key: "", label: "All" },
  { key: "OPEN", label: "Open" },
  { key: "PROCESSING", label: "Processing" },
  { key: "RESOLVED", label: "Resolved" },
  { key: "CLOSED", label: "Closed" },
];

function ComplaintList({ selected, onSelect }: { selected: string | null; onSelect: (id: string) => void }) {
  const [status, setStatus] = useState<IssueStatus | "">("");
  const [level, setLevel] = useState<IssueLevelAll | "">("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [issues, setIssues] = useState<AdminIssue[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const seq = useRef(0);

  const load = useCallback(
    async (pageNo: number) => {
      const my = ++seq.current;
      setLoading(true);
      try {
        const res = await adminIssuesApi.list({ status, level, category_code: category, search, page: pageNo, limit: PAGE });
        if (my !== seq.current) return;
        setIssues((cur) => (pageNo === 1 ? res.issues : [...cur, ...res.issues]));
        setTotal(res.pagination.total);
        setPage(pageNo);
        setError("");
      } catch (err) {
        if (my === seq.current) setError(errorText(err));
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [status, level, category, search],
  );

  useEffect(() => {
    const t = window.setTimeout(() => void load(1), 300);
    return () => window.clearTimeout(t);
  }, [load]);

  // Tile counts are real totals (limit=1, read pagination.total), under the other filters.
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      for (const tile of STATUS_TILES) {
        adminIssuesApi
          .list({ status: tile.key, level, category_code: category, search, limit: 1 })
          .then((r) => live && setCounts((c) => ({ ...c, [tile.key]: r.pagination.total })))
          .catch(() => live && setCounts((c) => ({ ...c, [tile.key]: null })));
      }
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [level, category, search]);

  return (
    <div className="picker-list">
      <div className="tiles">
        {STATUS_TILES.map((t) => (
          <button key={t.key || "all"} aria-pressed={status === t.key} className={`tile ${status === t.key ? "on" : ""}`} onClick={() => setStatus(t.key)}>
            <span className="tile-label">{t.label}</span>
            <span className="tile-num">{counts[t.key] ?? "–"}</span>
          </button>
        ))}
      </div>
      <input
        type="search"
        className="search"
        placeholder="Search complaints…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search complaints"
      />
      <div className="picker-filters">
        <select value={level} onChange={(e) => setLevel(e.target.value as IssueLevelAll | "")} aria-label="Level">
          <option value="">Any level</option>
          <option value="ISSUE">Issue</option>
          <option value="GRIEVANCE">Grievance</option>
          <option value="DISPUTE">Dispute</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          {CATEGORY_CODES.map((c) => (
            <option key={c} value={c}>{categoryLabel(c)}</option>
          ))}
        </select>
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <ul className="cards">
        {issues.map((i) => (
          <li key={i.issue_id}>
            <IssueCard issue={i} selected={i.issue_id === selected} onClick={() => onSelect(i.issue_id)} />
          </li>
        ))}
        {!loading && !error && issues.length === 0 && <li className="empty">No complaints match. Try another search or filter.</li>}
      </ul>
      <div className="sidebar-foot">
        {loading ? (
          <span className="muted">Loading…</span>
        ) : issues.length < total ? (
          <button className="btn btn-ghost btn-block" onClick={() => void load(page + 1)}>
            Load more ({total - issues.length} more)
          </button>
        ) : (
          total > 0 && <span className="muted small">{total} complaint{total === 1 ? "" : "s"}</span>
        )}
      </div>
    </div>
  );
}

function IssueCard({ issue, selected, onClick }: { issue: AdminIssue; selected: boolean; onClick: () => void }) {
  const dir = useDirectory();
  const open = issue.status !== "CLOSED";
  const strip = !open ? "strip-closed" : issue.level !== "ISSUE" ? "strip-warn" : "strip-open";
  return (
    <button className={`card ${strip} ${selected ? "selected" : ""} ${open ? "" : "dim"}`} onClick={onClick} aria-pressed={selected}>
      <div className="card-top">
        <span className="card-title">{categoryLabel(issue.category_code)}</span>
        <span className="row-time">{formatTime(issue.created_at)}</span>
      </div>
      {issue.descriptor?.short_desc && <div className="card-meta">{issue.descriptor.short_desc}</div>}
      <div className="row-tags">
        <span className={`tag issue-${issue.status}`}>{humanize(issue.status)}</span>
        {issue.level !== "ISSUE" && <span className="tag tag-warn">{humanize(issue.level)}</span>}
        <span className="tag">{dir.customerName(issue.source_id)}</span>
      </div>
    </button>
  );
}

function ComplaintPanel({
  issueId,
  onCreated,
  onOpenChat,
  onPickCustomer,
}: {
  issueId: string;
  onCreated: (c: Chat) => void;
  onOpenChat: (id: string) => void;
  onPickCustomer: (id: string, name: string | null) => void;
}) {
  const [issue, setIssue] = useState<AdminIssueDetail | null>(null);
  const dir = useDirectory();
  const [chat, setChat] = useState<Chat | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { issue } = await adminIssuesApi.detail(issueId);
        if (!live) return;
        setIssue(issue);
        if (issue.chat_id) {
          const res = await chatApi("admin").get(issue.chat_id, 1);
          if (live) setChat(res.chat);
        }
      } catch (err) {
        if (live) setError(errorText(err));
      }
    })();
    return () => {
      live = false;
    };
  }, [issueId]);

  if (error) return <div className="banner banner-error">{error}</div>;
  if (!issue) return <div className="center-msg muted">Loading complaint…</div>;

  const consumer = issue.actors?.find((a) => a.actor_type === "CONSUMER");
  const actorName = consumer?.info?.person?.name;
  const name = looksLikeName(actorName, issue.source_id) ? actorName : dir.customerName(issue.source_id);
  const phone = consumer?.info?.contact?.phone;
  const activeChat = chat && chat.status !== "CLOSED" ? chat : null;

  return (
    <div className="detail">
      <h3>{categoryLabel(issue.category_code)}</h3>
      <dl className="facts">
        <dt>Status</dt><dd>{humanize(issue.status)} · {humanize(issue.level)}</dd>
        <dt>Raised</dt><dd>{formatTime(issue.created_at)}</dd>
        <dt>Customer</dt>
        <dd>
          {name}
          {phone && <span className="muted"> · {phone}</span>}
          {issue.source_id && (
            <>
              <br />
              <button className="link" onClick={() => onPickCustomer(issue.source_id!, name)}>
                See all of their complaints and chats
              </button>
            </>
          )}
        </dd>
      </dl>
      {(issue.descriptor?.long_desc || issue.descriptor?.short_desc) && (
        <blockquote className="desc">{issue.descriptor.long_desc || issue.descriptor.short_desc}</blockquote>
      )}

      {activeChat ? (
        <div className="existing">
          <div>
            This complaint already has an open chat ({ADMIN_STATUS_LABEL[activeChat.status].toLowerCase()}).
            {activeChat.last_message_preview && <div className="muted">Last: “{activeChat.last_message_preview}”</div>}
          </div>
          <button className="btn btn-primary" onClick={() => onOpenChat(activeChat.chat_id)}>Go to the chat</button>
        </div>
      ) : (
        <>
          {chat && (
            <div className="existing">
              <span className="muted">The last chat about this complaint was closed {formatTime(chat.closed_at)}.</span>
              <button className="btn btn-ghost" onClick={() => onOpenChat(chat.chat_id)}>View it</button>
            </div>
          )}
          {!issue.source_id && <div className="banner banner-warn">This complaint has no customer linked, so a chat can't be opened.</div>}
          <OpenChatForm target={{ issue_id: issue.issue_id }} disabled={!issue.source_id} onCreated={onCreated} />
        </>
      )}
    </div>
  );
}

// ── Customers ───────────────────────────────────────────────────────────────

interface CustomerRow {
  id: string;
  name: string | null;
  complaints: number;
  open: number;
  latest: string;
}

/**
 * There is no customer list endpoint, so customers are collected from the complaints list
 * (`source_id` = the customer's user id, the same id chats use as `customer_id`).
 */
function CustomerList({ selected, onSelect }: { selected: string | null; onSelect: (id: string, name: string | null) => void }) {
  const [issues, setIssues] = useState<AdminIssue[]>([]);
  const dir = useDirectory();
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const loadPage = useCallback(async (pageNo: number) => {
    setLoading(true);
    try {
      const res = await adminIssuesApi.list({ page: pageNo, limit: 100 });
      setIssues((cur) => (pageNo === 1 ? res.issues : [...cur, ...res.issues]));
      setTotal(res.pagination.total);
      setPage(pageNo);
      setError("");
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPage(1);
  }, [loadPage]);

  const customers = useMemo(() => {
    const map = new Map<string, CustomerRow>();
    for (const i of issues) {
      if (!i.source_id) continue;
      const row = map.get(i.source_id) ?? { id: i.source_id, name: null, complaints: 0, open: 0, latest: i.created_at };
      row.complaints++;
      if (i.status !== "CLOSED") row.open++;
      if (!row.name) row.name = dir.customerName(i.source_id);
      if (i.created_at > row.latest) row.latest = i.created_at;
      map.set(i.source_id, row);
    }
    const q = query.trim().toLowerCase();
    return [...map.values()]
      .filter((c) => !q || (c.name ?? "").toLowerCase().includes(q))
      .sort((a, b) => b.latest.localeCompare(a.latest));
  }, [issues, query, dir]);

  return (
    <div className="picker-list">
      <input
        type="search"
        className="search"
        placeholder="Search customers…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search customers"
      />
      <div className="muted small">
        Customers who raised complaints, most recent first.
      </div>

      {error && <div className="banner banner-error">{error}</div>}

      <ul className="cards">
        {customers.map((c) => (
          <li key={c.id}>
            <button
              className={`card ${c.open ? "strip-open" : "strip-closed"} ${c.id === selected ? "selected" : ""}`}
              aria-pressed={c.id === selected}
              onClick={() => onSelect(c.id, c.name)}
            >
              <div className="card-top">
                <span className="card-title">{c.name ?? "Unnamed customer"}</span>
                <span className="row-time">{formatTime(c.latest)}</span>
              </div>
              <div className="row-tags">
                <span className="tag">{c.complaints} complaint{c.complaints === 1 ? "" : "s"}</span>
                {c.open > 0 && <span className="tag issue-OPEN">{c.open} not closed</span>}
              </div>
            </button>
          </li>
        ))}
        {!loading && !error && customers.length === 0 && <li className="empty">No customers found.</li>}
      </ul>
      <div className="sidebar-foot">
        {loading ? (
          <span className="muted">Loading…</span>
        ) : (
          issues.length < total && (
            <button className="btn btn-ghost btn-block" onClick={() => void loadPage(page + 1)}>
              Scan older complaints for more customers
            </button>
          )
        )}
      </div>
    </div>
  );
}

function CustomerPanel({
  customerId,
  name,
  onCreated,
  onOpenChat,
}: {
  customerId: string;
  name: string | null;
  onCreated: (c: Chat) => void;
  onOpenChat: (id: string) => void;
}) {
  const [issues, setIssues] = useState<AdminIssue[] | null>(null);
  const [chats, setChats] = useState<Chat[] | null>(null);
  const dir = useDirectory();
  const [topic, setTopic] = useState<string>(""); // "" = general chat, else an issue_id
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    Promise.all([
      adminIssuesApi.list({ source_id: customerId, limit: 100 }),
      chatApi("admin").list({ ...emptyFilters, customer_id: customerId, status: ALL_CHAT_STATUSES }, 1, 50),
    ])
      .then(([i, c]) => {
        if (!live) return;
        setIssues(i.issues);
        setChats(c.data);
      })
      .catch((err) => live && setError(errorText(err)));
    return () => {
      live = false;
    };
  }, [customerId]);

  const displayName = looksLikeName(name, customerId) ? name : dir.customerName(customerId);
  const openChatFor = (issueId: string) =>
    chats?.find((c) => c.status !== "CLOSED" && (issueId ? c.issue_id === issueId : !c.issue_id));
  const existing = chats ? openChatFor(topic) : undefined;
  const activeCount = chats?.filter((c) => c.status !== "CLOSED").length ?? 0;

  return (
    <div className="detail">
      <h3>{displayName}</h3>
      {error && <div className="banner banner-error">{error}</div>}

      <h4>Their chats</h4>
      {chats === null ? (
        <div className="muted">Loading…</div>
      ) : chats.length === 0 ? (
        <div className="muted">No chats yet.</div>
      ) : (
        <ul className="mini-list">
          {chats.map((c) => (
            <li key={c.chat_id}>
              <button className="mini-row" onClick={() => onOpenChat(c.chat_id)}>
                <span>{dir.topic(c)}</span>
                <span className={`status status-${c.status}`}>{ADMIN_STATUS_LABEL[c.status]}</span>
                <span className="row-time">{formatTime(c.last_message_at ?? c.created_at)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <h4>Start or continue a chat about</h4>
      <div className="topic-list" role="radiogroup">
        <label className={`topic ${topic === "" ? "on" : ""}`}>
          <input type="radio" checked={topic === ""} onChange={() => setTopic("")} />
          <span>
            <strong>General support</strong>
            {openChatFor("") && <span className="muted small"> · has an open chat</span>}
          </span>
        </label>
        {issues === null ? (
          <div className="muted">Loading complaints…</div>
        ) : (
          issues.map((i) => (
            <label key={i.issue_id} className={`topic ${topic === i.issue_id ? "on" : ""}`}>
              <input type="radio" checked={topic === i.issue_id} onChange={() => setTopic(i.issue_id)} />
              <span>
                <strong>{categoryLabel(i.category_code)}</strong> <span className="muted small">raised {formatTime(i.created_at)}</span>
                <span className="muted small"> · {humanize(i.status)}{i.level !== "ISSUE" ? ` · ${humanize(i.level)}` : ""}
                  {openChatFor(i.issue_id) && " · has an open chat"}</span>
              </span>
            </label>
          ))
        )}
      </div>

      {existing ? (
        <div className="existing">
          <span>There's already an open chat on this topic.</span>
          <button className="btn btn-primary" onClick={() => onOpenChat(existing.chat_id)}>Go to the chat</button>
        </div>
      ) : (
        <>
          {activeCount >= 5 && (
            <div className="banner banner-warn">This customer already has 5 open chats — opening another will be refused.</div>
          )}
          <OpenChatForm key={topic} target={topic ? { issue_id: topic } : { customer_id: customerId }} onCreated={onCreated} />
        </>
      )}
    </div>
  );
}

// ── Shared ──────────────────────────────────────────────────────────────────

function OpenChatForm({
  target,
  disabled,
  onCreated,
}: {
  target: { issue_id: string } | { customer_id: string };
  disabled?: boolean;
  onCreated: (c: Chat) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (text: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await adminApi.open(target, text ? { clientMessageId: newClientMessageId(), text } : undefined);
      onCreated(res.chat);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="open-form">
      <div className="muted small">
        The first message is optional. Without one the chat stays unassigned and the customer isn't notified.
      </div>
      {error && <div className="banner banner-error">{error}</div>}
      <Composer
        onSend={(t) => void submit(t)}
        allowEmpty
        clearOnSend={false}
        busy={busy}
        disabled={disabled}
        buttonLabel="Open chat"
        placeholder="Optional first message…"
      />
    </div>
  );
}
