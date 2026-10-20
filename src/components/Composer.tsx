import { useState } from "react";

const MAX = 4000;

interface Props {
  initial?: string;
  onSend: (text: string) => void;
  placeholder?: string;
  buttonLabel?: string;
  /** Admins may open a chat without a first message. */
  allowEmpty?: boolean;
  /** Keep the text after sending (the caller clears it by remounting once the send succeeds). */
  clearOnSend?: boolean;
  busy?: boolean;
  disabled?: boolean;
}

export function Composer({
  initial = "",
  onSend,
  placeholder,
  buttonLabel = "Send",
  allowEmpty = false,
  clearOnSend = true,
  busy = false,
  disabled = false,
}: Props) {
  const [text, setText] = useState(initial);
  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX;
  const canSend = !busy && !disabled && !tooLong && (allowEmpty || trimmed.length > 0);

  const submit = () => {
    if (!canSend) return;
    onSend(trimmed);
    if (clearOnSend) setText("");
  };

  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <textarea
        value={text}
        rows={2}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
        aria-label="Message"
      />
      <div className="composer-side">
        <button className="btn btn-primary" type="submit" disabled={!canSend}>
          {busy ? "Please wait…" : buttonLabel}
        </button>
        <span className={`counter ${tooLong ? "over" : ""}`}>
          {trimmed.length > MAX - 500 ? `${trimmed.length}/${MAX}` : "Enter to send · Shift+Enter for new line"}
        </span>
      </div>
    </form>
  );
}
