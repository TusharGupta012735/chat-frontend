// Shapes from docs/issue-chat.md (customer) and docs/admin-chats.md (admin).

export type Role = "customer" | "admin";

export type ChatStatus = "OPEN" | "AWAITING_AGENT" | "AWAITING_CUSTOMER" | "CLOSED";
export type SenderType = "USER" | "ADMIN";
export type IssueLevel = "ISSUE" | "GRIEVANCE";

export interface Rating {
  stars: number;
  comment: string | null;
  rated_at: string;
}

export interface Chat {
  chat_id: string;
  issue_id: string | null;
  order_id: string | null;
  issue_status: string | null;
  opened_by_type: SenderType;
  status: ChatStatus;
  can_send: boolean;
  /** Customer view only. */
  can_rate?: boolean;
  unread_count: number;
  last_read_message_id: string | null;
  last_message_id: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_sender: SenderType | null;
  closed_at: string | null;
  rating: Rating | null;
  created_at: string;
  // Admin view only.
  customer_id?: string;
  opened_by_id?: string;
  assigned_to_id?: string | null;
  closed_by_id?: string | null;
  issue_level?: IssueLevel | null;
  customer_last_read_message_id?: string | null;
}

export interface Message {
  id: string;
  chat_id: string;
  sender_type: SenderType;
  sender_name: string | null;
  is_mine: boolean;
  body: string;
  attachments: unknown[];
  client_message_id: string | null;
  created_at: string;
  /** Admin view only. */
  sender_id?: string;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
}

export interface ChatList {
  data: Chat[];
  pagination: Pagination;
}

export interface ChatWithMessages {
  chat: Chat;
  messages: Message[];
  has_more_before: boolean;
}

export interface MessagePage {
  messages: Message[];
  has_more: boolean;
}

export interface ChatAndMessage {
  chat: Chat;
  message: Message | null;
}

export interface Availability {
  enabled: boolean;
  new_chats_enabled: boolean;
}

export interface ChatSettings {
  new_chats_enabled: boolean;
  env_enabled: boolean;
  new_chats_allowed: boolean;
  updated_by: string | null;
  updated_at: string | null;
}

export type ChatEventType =
  | "CHAT_OPENED"
  | "MESSAGE_CREATED"
  | "CHAT_READ"
  | "CHAT_CLOSED"
  | "CHAT_RATED";

export interface ChatEvent {
  type: ChatEventType;
  chat: Chat;
  message: Message | null;
  actor: { type: SenderType; id?: string };
  occurred_at: string;
}

/** Filters for the sidebar list. Customer uses a subset; admin uses all. */
export interface ChatFilters {
  // customer: "" | "active" | "closed"; admin: comma-separated statuses ("" = server default)
  status: string;
  linked: "" | "general" | "issue";
  issue_id: string;
  // admin only
  assigned: string;
  unread_only: boolean;
  customer_id: string;
  issue_level: "" | IssueLevel;
  rated: "" | "true" | "false";
}

export const emptyFilters: ChatFilters = {
  status: "",
  linked: "",
  issue_id: "",
  assigned: "",
  unread_only: false,
  customer_id: "",
  issue_level: "",
  rated: "",
};

// Admin complaints (docs/admin-issues.md) — only the fields this app uses.

export type IssueStatus = "OPEN" | "PROCESSING" | "RESOLVED" | "CLOSED";
export type IssueLevelAll = "ISSUE" | "GRIEVANCE" | "DISPUTE";

export interface AdminIssue {
  issue_id: string;
  order_id: string;
  transaction_id: string;
  bpp_id: string;
  status: IssueStatus;
  level: IssueLevelAll;
  category_code: string;
  descriptor: { code: string; short_desc: string | null; long_desc?: string | null } | null;
  source_id: string | null;
  created_by: string | null;
  action_count: number;
  created_at: string;
  updated_at: string;
}

export interface AdminIssueList {
  issues: AdminIssue[];
  pagination: Pagination;
}

export interface IssueActor {
  actor_id: string;
  actor_type: string;
  info?: { person?: { name?: string }; contact?: { phone?: string; email?: string }; org?: { name?: string } };
}

export interface AdminIssueDetail extends AdminIssue {
  actors: IssueActor[];
  chat_id: string | null;
}

export interface IssueQuery {
  status?: IssueStatus | "";
  level?: IssueLevelAll | "";
  category_code?: string;
  source_id?: string;
  search?: string;
  page?: number;
  limit?: number;
}

/** A customer's own complaint from GET /issue/my (camelCase there). Only the fields this app uses. */
export interface MyIssue {
  issueId: string;
  status: IssueStatus;
  level: IssueLevelAll;
  categoryCode: string;
  descriptorShortDesc: string | null;
  createdAt: string;
}
