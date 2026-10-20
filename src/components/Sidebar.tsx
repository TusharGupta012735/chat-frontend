import { useState } from "react";
import type { Chat, ChatFilters, ChatSettings, Role } from "../api/types";
import { initials, useDirectory } from "../directory";
import { ADMIN_STATUS_LABEL, STATUS_LABEL, formatTime } from "../util";

interface Props {
  role: Role;
  userId: string;
  userName?: string;
  chats: Chat[];
  total: number;
  loading: boolean;
  error: string;
  filters: ChatFilters;
  onFilters: (f: ChatFilters) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  canStartNew: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  unreadTotal: number;
  connected: boolean;
  onLogout: () => void;
  settings?: ChatSettings | null;
  onToggleNewChats?: (v: boolean) => void;
  settingsBusy?: boolean;
}

/** Tabs set the "where is it in the workflow" filters; the Filters panel narrows within a tab. */
type Tab = { key: string; label: string; apply: Partial<ChatFilters> };

const BASE: Partial<ChatFilters> = { status: "", assigned: "", unread_only: false };
const ADMIN_TABS: Tab[] = [
  { key: "inbox", label: "Inbox", apply: BASE },
  { key: "reply", label: "Needs reply", apply: { ...BASE, unread_only: true } },
  { key: "mine", label: "Mine", apply: { ...BASE, assigned: "me" } },
  { key: "unassigned", label: "Unassigned", apply: { ...BASE, assigned: "unassigned" } },
  { key: "closed", label: "Closed", apply: { ...BASE, status: "CLOSED" } },
];
const CUSTOMER_TABS: Tab[] = [
  { key: "all", label: "All", apply: { status: "" } },
  { key: "open", label: "Open", apply: { status: "active" } },
  { key: "closed", label: "Closed", apply: { status: "closed" } },
];

function activeTab(tabs: Tab[], f: ChatFilters): string | null {
  const hit = tabs.find((t) => Object.entries(t.apply).every(([k, v]) => f[k as keyof ChatFilters] === v));
  return hit?.key ?? null;
}

export function Sidebar(p: Props) {
  const dir = useDirectory();
  const isAdmin = p.role === "admin";
  const [showFilters, setShowFilters] = useState(false);
  const set = (patch: Partial<ChatFilters>) => p.onFilters({ ...p.filters, ...patch });
  const tabs = isAdmin ? ADMIN_TABS : CUSTOMER_TABS;
  const tab = activeTab(tabs, p.filters);
  const extra = extraFilterCount(p.filters, isAdmin);
  const me = p.userName ?? (isAdmin ? "Support agent" : "Customer");
  const agentAssigned = isAdmin && !["", "me", "unassigned"].includes(p.filters.assigned.trim()) ? p.filters.assigned.trim() : "";

  return (
    <aside className="sidebar">
      <header className="sidebar-head">
        <span className="avatar avatar-me" aria-hidden>{initials(me)}</span>
        <div className="who">
          <div className="who-name">{me}</div>
          <div className="who-sub">
            <span className={`dot ${p.connected ? "dot-on" : "dot-off"}`} />
            {p.connected ? "Online" : "Reconnecting…"} · {isAdmin ? "Support agent" : "Customer"}
          </div>
        </div>
        <button className="btn btn-subtle btn-sm" onClick={p.onLogout}>Sign out</button>
      </header>

      {isAdmin && p.settings && (
        <div className="settings-box">
          {p.settings.env_enabled ? (
            <label className="toggle" title={p.settings.updated_at ? `Changed by ${dir.agentName(p.settings.updated_by)} · ${formatTime(p.settings.updated_at)}` : ""}>
              <span>New chats from customers</span>
              <input
                type="checkbox"
                role="switch"
                checked={p.settings.new_chats_enabled}
                disabled={p.settingsBusy}
                onChange={(e) => p.onToggleNewChats?.(e.target.checked)}
              />
              <span className="toggle-track" aria-hidden />
            </label>
          ) : (
            <div className="banner banner-warn">Support chat is disabled by server configuration.</div>
          )}
        </div>
      )}

      <div className="sidebar-actions">
        <button
          className="btn btn-primary btn-block"
          onClick={p.onNew}
          disabled={!p.canStartNew}
          title={p.canStartNew ? "" : "Support isn't taking new conversations right now"}
        >
          {isAdmin ? "+ New chat" : "+ Start a chat"}
        </button>
        {!p.canStartNew && !isAdmin && <div className="muted small">Support isn't taking new chats right now. Open chats still work.</div>}
      </div>

      <div className="list-head">
        <div className="tabs tabs-sm" role="tablist">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? "on" : ""} onClick={() => set(t.apply)}>
              {t.label}
              {t.key === "reply" && p.unreadTotal > 0 && <span className="count">{p.unreadTotal}</span>}
            </button>
          ))}
        </div>
        <div className="list-tools">
          <button className={`btn btn-subtle btn-sm ${showFilters || extra ? "is-on" : ""}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
            Filters{extra > 0 && ` · ${extra}`}
          </button>
          <button className="btn btn-subtle btn-sm" onClick={p.onRefresh} title="Refresh">Refresh</button>
        </div>
      </div>

      {showFilters && (
        <div className="filters-body">
          <label className="field">
            <span>Topic</span>
            <select className="input" value={p.filters.linked} onChange={(e) => set({ linked: e.target.value as ChatFilters["linked"], issue_id: "" })}>
              <option value="">Any topic</option>
              <option value="general">General questions</option>
              <option value="issue">About a complaint</option>
            </select>
          </label>
          {isAdmin ? (
            <>
              <label className="field">
                <span>Customer</span>
                <select className="input" value={p.filters.customer_id} onChange={(e) => set({ customer_id: e.target.value })}>
                  <option value="">Any customer</option>
                  {p.filters.customer_id && !dir.customers.some((c) => c.id === p.filters.customer_id) && (
                    <option value={p.filters.customer_id}>{dir.customerName(p.filters.customer_id)}</option>
                  )}
                  {dir.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              {dir.agents.length > 0 && (
                <label className="field">
                  <span>Assigned agent</span>
                  <select className="input" value={agentAssigned} onChange={(e) => set({ assigned: e.target.value })}>
                    <option value="">Any</option>
                    {dir.agents.filter((a) => a.id !== p.userId).map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="field-row">
                <label className="field">
                  <span>Level</span>
                  <select className="input" value={p.filters.issue_level} onChange={(e) => set({ issue_level: e.target.value as ChatFilters["issue_level"] })}>
                    <option value="">Any</option>
                    <option value="ISSUE">Issue</option>
                    <option value="GRIEVANCE">Grievance</option>
                  </select>
                </label>
                <label className="field">
                  <span>Rating</span>
                  <select className="input" value={p.filters.rated} onChange={(e) => set({ rated: e.target.value as ChatFilters["rated"] })}>
                    <option value="">Any</option>
                    <option value="true">Rated</option>
                    <option value="false">Not rated</option>
                  </select>
                </label>
              </div>
            </>
          ) : (
            dir.issues.length > 0 && (
              <label className="field">
                <span>Complaint</span>
                <select className="input" value={p.filters.issue_id} onChange={(e) => set({ issue_id: e.target.value, linked: e.target.value ? "issue" : p.filters.linked })}>
                  <option value="">Any complaint</option>
                  {dir.issues.map((i) => (
                    <option key={i.issueId} value={i.issueId}>{i.label} · {formatTime(i.createdAt)}</option>
                  ))}
                </select>
              </label>
            )
          )}
          {extra > 0 && (
            <button
              className="btn btn-subtle btn-sm"
              onClick={() => set({ linked: "", issue_id: "", customer_id: "", issue_level: "", rated: "", ...(agentAssigned ? { assigned: "" } : {}) })}
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {p.error && <div className="banner banner-error sidebar-msg">{p.error}</div>}

      <ul className="chat-list" role="listbox" aria-label="Chats">
        {p.chats.map((c, i) => {
          const prev = p.chats[i - 1];
          // In the customer's general timeline, mark where earlier conversations start.
          const divider = !isAdmin && p.filters.linked === "general" && prev && prev.status !== "CLOSED" && c.status === "CLOSED";
          const title = dir.title(c);
          const selected = c.chat_id === p.selectedId;
          const needsReply = isAdmin && c.status === "AWAITING_AGENT";
          return (
            <li key={c.chat_id}>
              {divider && <div className="list-divider">Earlier conversations</div>}
              <button
                role="option"
                aria-selected={selected}
                className={`chat-row ${selected ? "selected" : ""} ${c.status === "CLOSED" ? "closed" : ""}`}
                onClick={() => p.onSelect(c.chat_id)}
              >
                <span className={`avatar ${isAdmin ? "" : "avatar-topic"}`} aria-hidden>
                  {isAdmin ? initials(title) : c.issue_id ? "!" : "?"}
                </span>
                <span className="row-body">
                  <span className="row-top">
                    <span className="row-title">{title}</span>
                    <span className="row-time">{formatTime(c.last_message_at ?? c.created_at)}</span>
                  </span>
                  {isAdmin && <span className="row-topic">{dir.topic(c)}</span>}
                  <span className="row-mid">
                    <span className={`row-preview ${c.unread_count > 0 ? "unread" : ""}`}>
                      {c.last_message_preview
                        ? `${c.last_message_sender === (isAdmin ? "ADMIN" : "USER") ? "You: " : ""}${c.last_message_preview}`
                        : "No messages yet"}
                    </span>
                    {c.unread_count > 0 && <span className="badge">{c.unread_count}</span>}
                  </span>
                  <span className="row-tags">
                    <span className={`status status-${c.status} ${needsReply ? "status-hot" : ""}`}>
                      {(isAdmin ? ADMIN_STATUS_LABEL : STATUS_LABEL)[c.status]}
                    </span>
                    {c.issue_level === "GRIEVANCE" && <span className="tag tag-warn">Grievance</span>}
                    {isAdmin && c.status !== "CLOSED" && (
                      <span className="tag">{c.assigned_to_id ? dir.agentName(c.assigned_to_id) : "Unassigned"}</span>
                    )}
                    {c.rating && <span className="tag tag-star">{"★".repeat(c.rating.stars)}</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
        {!p.loading && p.chats.length === 0 && !p.error && <li className="empty">Nothing here.</li>}
      </ul>

      <div className="sidebar-foot">
        {p.loading ? (
          <span className="muted small">Loading…</span>
        ) : p.chats.length < p.total ? (
          <button className="btn btn-subtle btn-sm btn-block" onClick={p.onLoadMore}>
            Load {Math.min(20, p.total - p.chats.length)} more
          </button>
        ) : (
          p.total > 0 && <span className="muted small">{p.total} chat{p.total === 1 ? "" : "s"}</span>
        )}
      </div>
    </aside>
  );
}

function extraFilterCount(f: ChatFilters, isAdmin: boolean): number {
  const agent = isAdmin && !["", "me", "unassigned"].includes(f.assigned.trim());
  return [f.linked, f.issue_id, f.customer_id, f.issue_level, f.rated].filter(Boolean).length + (agent ? 1 : 0);
}
