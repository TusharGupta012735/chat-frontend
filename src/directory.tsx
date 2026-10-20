import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { adminIssuesApi, customerApi } from "./api/client";
import type { Chat, IssueStatus } from "./api/types";
import { savedUsers } from "./devAuth";
import type { Session } from "./session";
import { categoryLabel, looksLikeName } from "./util";

/**
 * Turns ids into words, so the UI never shows a raw id. Chats only carry ids; names come from
 * complaints (`created_by` per `source_id`) and the saved sign-in users. Customers see their own
 * complaints (GET /issue/my) so their chats can be labelled by complaint type.
 */

export interface IssueInfo {
  issueId: string;
  label: string;
  status: IssueStatus;
  createdAt: string;
  customerId?: string;
  summary?: string | null;
}

export interface Person {
  id: string;
  name: string;
}

export interface Directory {
  customerName: (id: string | null | undefined) => string;
  agentName: (id: string | null | undefined) => string;
  issue: (id: string | null | undefined) => IssueInfo | undefined;
  /** What a chat is about: the complaint type, or "General question". */
  topic: (chat: Chat) => string;
  /** The chat's heading: the customer's name for agents, the topic for customers. */
  title: (chat: Chat) => string;
  customers: Person[];
  agents: Person[];
  issues: IssueInfo[];
  /** Reload if any of these chats mention someone or something we can't name yet. */
  noteChats: (chats: Chat[]) => void;
}

const Ctx = createContext<Directory | null>(null);

export function useDirectory(): Directory {
  const d = useContext(Ctx);
  if (!d) throw new Error("useDirectory outside DirectoryProvider");
  return d;
}

const RELOAD_GAP_MS = 30_000;

export function isGuest(id: string | null | undefined) {
  return !!id && id.startsWith("guest-");
}

export function DirectoryProvider({ session, children }: { session: Session; children: ReactNode }) {
  const isAdmin = session.role === "admin";
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [agents, setAgents] = useState<Map<string, string>>(new Map());
  const [issues, setIssues] = useState<Map<string, IssueInfo>>(new Map());
  const lastLoad = useRef(0);
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (loading.current) return;
    loading.current = true;
    lastLoad.current = Date.now();
    try {
      const saved = savedUsers();
      setAgents(new Map(saved.filter((u) => u.role === "admin").map((u) => [u.id, u.name])));
      const savedCustomers = saved.filter((u) => u.role === "customer");

      const nextIssues = new Map<string, IssueInfo>();
      const fromComplaints = new Map<string, string>();
      if (isAdmin) {
        for (let page = 1; page <= 5; page++) {
          const res = await adminIssuesApi.list({ page, limit: 100 });
          for (const i of res.issues) {
            nextIssues.set(i.issue_id, {
              issueId: i.issue_id,
              label: categoryLabel(i.category_code),
              status: i.status,
              createdAt: i.created_at,
              customerId: i.source_id ?? undefined,
              summary: i.descriptor?.short_desc,
            });
            if (i.source_id && looksLikeName(i.created_by, i.source_id) && !fromComplaints.has(i.source_id)) {
              fromComplaints.set(i.source_id, i.created_by.trim());
            }
          }
          if (page * res.pagination.limit >= res.pagination.total) break;
        }
        // No usable created_by (seeded data stores the id there): read the CONSUMER actor's name
        // from one complaint per customer.
        const savedIds = new Set(savedCustomers.map((u) => u.id));
        const firstIssue = new Map<string, string>();
        for (const i of nextIssues.values()) {
          if (i.customerId && !fromComplaints.has(i.customerId) && !savedIds.has(i.customerId) && !firstIssue.has(i.customerId)) {
            firstIssue.set(i.customerId, i.issueId);
          }
        }
        await Promise.all(
          [...firstIssue].slice(0, 50).map(async ([customerId, issueId]) => {
            try {
              const { issue } = await adminIssuesApi.detail(issueId);
              const name = issue.actors?.find((a) => a.actor_type === "CONSUMER")?.info?.person?.name;
              if (looksLikeName(name, customerId)) fromComplaints.set(customerId, name.trim());
            } catch {
              /* stays unnamed */
            }
          }),
        );
      } else {
        const res = await customerApi.myIssues();
        for (const i of res.issues) {
          nextIssues.set(i.issueId, {
            issueId: i.issueId,
            label: categoryLabel(i.categoryCode),
            status: i.status,
            createdAt: i.createdAt,
            summary: i.descriptorShortDesc,
          });
        }
      }
      setIssues(nextIssues);
      // A name on a complaint beats whatever the user was saved as.
      setNames(
        new Map([
          ...savedCustomers.filter((u) => looksLikeName(u.name, u.id)).map((u): [string, string] => [u.id, u.name]),
          ...fromComplaints,
        ]),
      );
    } catch {
      /* names are best-effort; the UI falls back to generic labels */
    } finally {
      loading.current = false;
    }
  }, [isAdmin]);

  useEffect(() => {
    void load();
  }, [load]);

  const noteChats = useCallback(
    (chats: Chat[]) => {
      const unknown = chats.some(
        (c) =>
          (c.issue_id && !issues.has(c.issue_id)) ||
          (isAdmin && c.customer_id && !isGuest(c.customer_id) && !names.has(c.customer_id)),
      );
      if (unknown && Date.now() - lastLoad.current > RELOAD_GAP_MS) void load();
    },
    [issues, names, isAdmin, load],
  );

  const value = useMemo<Directory>(() => {
    const customerName = (id: string | null | undefined) => {
      if (!id) return "Customer";
      if (!isAdmin && id === session.userId) return session.name ?? "You";
      return names.get(id) ?? (isGuest(id) ? "Guest customer" : "Unnamed customer");
    };
    const agentName = (id: string | null | undefined) => {
      if (!id) return "Support";
      if (isAdmin && id === session.userId) return "You";
      const saved = agents.get(id);
      return looksLikeName(saved, id) ? saved : isGuest(id) ? "Guest agent" : "Another agent";
    };
    const issue = (id: string | null | undefined) => (id ? issues.get(id) : undefined);
    const topic = (c: Chat) => (c.issue_id ? issues.get(c.issue_id)?.label ?? "Complaint" : "General question");
    return {
      customerName,
      agentName,
      issue,
      topic,
      title: (c) => (isAdmin ? customerName(c.customer_id) : topic(c)),
      customers: [...names].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      agents: [...agents].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
      issues: [...issues.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      noteChats,
    };
  }, [names, agents, issues, isAdmin, session.userId, session.name, noteChats]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[words.length - 1][0]).toUpperCase();
}
