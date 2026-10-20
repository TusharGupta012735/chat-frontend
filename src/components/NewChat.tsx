import { useState } from "react";
import { customerApi, errorText, newClientMessageId } from "../api/client";
import type { Chat } from "../api/types";
import { useDirectory } from "../directory";
import { formatTime, humanize } from "../util";
import { Composer } from "./Composer";

interface Props {
  newChatsEnabled: boolean;
  onCreated: (chat: Chat) => void;
  onCancel: () => void;
}

/** Customer: start a chat (general, or about one of their complaints). Admins use AdminNewChat. */
export function NewChat({ newChatsEnabled, onCreated, onCancel }: Props) {
  const dir = useDirectory();
  const [issueId, setIssueId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (text: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await customerApi.open(newClientMessageId(), text, issueId || undefined);
      onCreated(res.chat);
    } catch (err) {
      // Keep what was typed so it can be sent again.
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat-pane">
      <header className="chat-head">
        <div className="chat-head-main">
          <h2>Start a chat with support</h2>
          <div className="chat-meta muted">We usually reply within a few minutes.</div>
        </div>
        <div className="chat-head-actions">
          <button className="btn btn-subtle btn-sm" onClick={onCancel}>Cancel</button>
        </div>
      </header>
      <div className="new-chat">
        {!newChatsEnabled && (
          <div className="banner banner-warn">
            Support chat isn't taking new conversations right now. You can still continue your open chats.
          </div>
        )}
        <div className="field">
          <span>What is it about?</span>
          <div className="choice-list" role="radiogroup">
            <label className={`choice ${issueId === "" ? "on" : ""}`}>
              <input type="radio" checked={issueId === ""} onChange={() => setIssueId("")} />
              <span>
                <strong>A general question</strong>
                <span className="muted small">Orders, payments, your account — anything else</span>
              </span>
            </label>
            {dir.issues.map((i) => (
              <label key={i.issueId} className={`choice ${issueId === i.issueId ? "on" : ""}`}>
                <input type="radio" checked={issueId === i.issueId} onChange={() => setIssueId(i.issueId)} />
                <span>
                  <strong>{i.label}</strong>
                  <span className="muted small">
                    Complaint raised {formatTime(i.createdAt)} · {humanize(i.status)}
                    {i.summary ? ` · ${i.summary}` : ""}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <p className="muted small">If you already have an open chat on this topic, your message will be added to it.</p>
        {error && <div className="banner banner-error">{error}</div>}
      </div>
      <Composer
        onSend={(t) => void submit(t)}
        clearOnSend={false}
        busy={busy}
        disabled={!newChatsEnabled}
        placeholder="How can we help?"
      />
    </section>
  );
}
