import { useEffect, useRef, useState } from "react";
import { streamUrl } from "../api/client";
import type { ChatEvent, Role } from "../api/types";

/**
 * Subscribes to `issue_chat` events on the customer stream (/stream/:clientId) or the admin
 * stream (/admin/stream). Calls onReconnect after the stream comes back from a drop, since
 * events are best-effort and anything sent while down must be caught up with REST.
 */
export function useEventStream(
  role: Role,
  token: string,
  onEvent: (e: ChatEvent) => void,
  onReconnect: () => void,
): boolean {
  const [connected, setConnected] = useState(false);
  const handlers = useRef({ onEvent, onReconnect });
  handlers.current = { onEvent, onReconnect };

  useEffect(() => {
    const clientId = crypto.randomUUID();
    let es: EventSource | null = null;
    let retryTimer: number | undefined;
    let wasDown = false;
    let disposed = false;

    const connect = () => {
      es = new EventSource(streamUrl(role, clientId));
      es.onopen = () => {
        setConnected(true);
        if (wasDown) handlers.current.onReconnect();
        wasDown = false;
      };
      es.onerror = () => {
        setConnected(false);
        wasDown = true;
        // The browser retries on its own unless the connection is CLOSED (e.g. an HTTP error).
        if (es?.readyState === EventSource.CLOSED && !disposed) {
          es.close();
          retryTimer = window.setTimeout(connect, 5000);
        }
      };
      es.addEventListener("issue_chat", (msg) => {
        try {
          handlers.current.onEvent(JSON.parse((msg as MessageEvent).data));
        } catch {
          /* ignore malformed event */
        }
      });
    };
    connect();

    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      es?.close();
    };
  }, [role, token]);

  return connected;
}
