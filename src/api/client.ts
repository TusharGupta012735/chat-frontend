import type {
  AdminIssueDetail,
  AdminIssueList,
  Availability,
  ChatAndMessage,
  ChatFilters,
  ChatList,
  ChatSettings,
  ChatWithMessages,
  Chat,
  IssueQuery,
  MessagePage,
  MyIssue,
  Role,
} from "./types";

const API = "/api/v1";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: { field: string; issue: string }[],
  ) {
    super(message);
  }
}

/** Friendly text for every documented error code. */
const FRIENDLY: Record<string, string> = {
  VALIDATION_ERROR: "Please check your input.",
  CHAT_NOT_FOUND: "This chat could not be found.",
  ISSUE_NOT_FOUND: "Complaint not found.",
  CUSTOMER_NOT_FOUND: "Customer not found.",
  MESSAGE_NOT_FOUND: "Read marker was out of date — reloading the chat.",
  NOT_FOUND: "Support chat is switched off on this server.",
  CHAT_CLOSED: "This chat has been closed.",
  TOO_MANY_ACTIVE_CHATS: "There are already 5 open chats. Please continue one of the open chats.",
  NEW_CHATS_DISABLED: "Support chat isn't taking new conversations right now.",
  CHAT_NOT_CLOSED: "A chat can only be rated after support closes it.",
  ALREADY_RATED: "This chat has already been rated.",
  RATE_LIMITED: "You're sending messages too fast. Please wait a moment and try again.",
  ISSUE_OR_CUSTOMER_REQUIRED: "Enter exactly one of complaint id or customer id.",
  ISSUE_HAS_NO_CUSTOMER: "This complaint has no customer to chat with.",
  Unauthorized: "Your session has expired. Please sign in again.",
  Forbidden: "This token doesn't have admin access.",
};

export function errorText(err: unknown): string {
  if (err instanceof ApiError) {
    const base = FRIENDLY[err.code] ?? err.message;
    const detail = err.details?.map((d) => `${d.field}: ${d.issue}`).join("; ");
    return detail ? `${base} (${detail})` : base;
  }
  return err instanceof Error ? err.message : String(err);
}

let token = "";
let onUnauthorized: () => void = () => {};

export function configureClient(t: string, unauthorized: () => void) {
  token = t;
  onUnauthorized = unauthorized;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "Can't reach the server. Check your connection.");
  }
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const code = json?.error ?? (res.status === 401 ? "Unauthorized" : `HTTP_${res.status}`);
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, code, json?.message ?? json?.error ?? res.statusText, json?.details);
  }
  return json as T;
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === false) continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export function newClientMessageId(): string {
  return crypto.randomUUID();
}

/** Routes that exist on both sides with the same shape, under /chats or /admin/chats. */
export function chatApi(role: Role) {
  const base = role === "admin" ? "/admin/chats" : "/chats";
  return {
    list(f: ChatFilters, page: number, limit = 20) {
      const params =
        role === "admin"
          ? {
              status: f.status,
              assigned: f.assigned.trim(),
              unread_only: f.unread_only,
              linked: f.linked,
              issue_id: f.issue_id.trim(),
              customer_id: f.customer_id.trim(),
              issue_level: f.issue_level,
              rated: f.rated,
            }
          : { status: f.status, linked: f.linked, issue_id: f.issue_id.trim() };
      return request<ChatList>("GET", base + qs({ ...params, page, limit }));
    },
    get(chatId: string, limit = 30) {
      return request<ChatWithMessages>("GET", `${base}/${chatId}${qs({ limit })}`);
    },
    messagesAfter(chatId: string, after: string, limit = 100) {
      return request<MessagePage>("GET", `${base}/${chatId}/messages${qs({ after, limit })}`);
    },
    messagesBefore(chatId: string, before: string, limit = 50) {
      return request<MessagePage>("GET", `${base}/${chatId}/messages${qs({ before, limit })}`);
    },
    send(chatId: string, clientMessageId: string, text: string) {
      return request<ChatAndMessage>("POST", `${base}/${chatId}/messages`, {
        client_message_id: clientMessageId,
        body: text,
      });
    },
    markRead(chatId: string, lastReadMessageId: string) {
      return request<{ unread_count: number }>("POST", `${base}/${chatId}/read`, {
        last_read_message_id: lastReadMessageId,
      });
    },
  };
}

export const customerApi = {
  availability: () => request<Availability>("GET", "/chats/availability"),
  /** The signed-in customer's own complaints (docs/issue.md, hard-fetch). */
  myIssues: () => request<{ issues: MyIssue[] }>("GET", "/issue/my?limit=100"),
  open: (clientMessageId: string, text: string, issueId?: string) =>
    request<ChatAndMessage>("POST", "/chats", {
      client_message_id: clientMessageId,
      body: text,
      ...(issueId ? { issue_id: issueId } : {}),
    }),
  rate: (chatId: string, stars: number, comment?: string) =>
    request<{ chat: Chat }>("POST", `/chats/${chatId}/rating`, {
      stars,
      ...(comment ? { comment } : {}),
    }),
};

export const adminApi = {
  open: (target: { issue_id: string } | { customer_id: string }, message?: { clientMessageId: string; text: string }) =>
    request<ChatAndMessage>("POST", "/admin/chats", {
      ...target,
      ...(message ? { client_message_id: message.clientMessageId, body: message.text } : {}),
    }),
  close: (chatId: string) => request<{ chat: Chat }>("PATCH", `/admin/chats/${chatId}`, { status: "CLOSED" }),
  getSettings: () => request<ChatSettings>("GET", "/admin/chat-settings"),
  setSettings: (newChatsEnabled: boolean) =>
    request<ChatSettings>("PATCH", "/admin/chat-settings", { new_chats_enabled: newChatsEnabled }),
};

export const adminIssuesApi = {
  list: (q: IssueQuery) =>
    request<AdminIssueList>("GET", "/admin/issues" + qs({ ...q, search: q.search?.trim(), source_id: q.source_id?.trim() })),
  detail: (issueId: string) =>
    request<{ issue: AdminIssueDetail }>("GET", `/admin/issues/${encodeURIComponent(issueId)}`),
};

export function streamUrl(role: Role, clientId: string): string {
  const path = role === "admin" ? "/admin/stream" : `/stream/${clientId}`;
  return `${API}${path}?token=${encodeURIComponent(token)}`;
}
