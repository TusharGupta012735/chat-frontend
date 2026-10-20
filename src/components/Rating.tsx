import { useState } from "react";
import type { Rating } from "../api/types";
import { formatTime } from "../util";

export function RatingPrompt({ onSubmit }: { onSubmit: (stars: number, comment: string) => Promise<void> }) {
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onSubmit(stars, comment);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rating-box">
      <div className="rating-q">How did we do?</div>
      <div className="stars" onMouseLeave={() => setHover(0)} role="radiogroup" aria-label="Rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={stars === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            className={`star ${(hover || stars) >= n ? "lit" : ""}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setStars(n)}
          >
            ★
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        maxLength={1000}
        value={comment}
        placeholder="Anything you'd like to add? (optional)"
        onChange={(e) => setComment(e.target.value)}
      />
      {error && <div className="banner banner-error">{error}</div>}
      <button className="btn btn-primary" disabled={!stars || busy} onClick={() => void submit()}>
        {busy ? "Sending…" : "Submit rating"}
      </button>
    </div>
  );
}

export function RatingView({ rating, who }: { rating: Rating; who: string }) {
  return (
    <div className="rating-box rated">
      <div className="rating-q">{who} rated this chat</div>
      <div className="stars static" aria-label={`${rating.stars} out of 5 stars`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`star ${rating.stars >= n ? "lit" : ""}`}>★</span>
        ))}
      </div>
      {rating.comment && <blockquote>“{rating.comment}”</blockquote>}
      <div className="muted small">{formatTime(rating.rated_at)}</div>
    </div>
  );
}
