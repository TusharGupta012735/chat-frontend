import { useCallback, useEffect, useMemo, useState } from "react";
import type { Role } from "../api/types";
import { devAuth, type KnownCustomer, type SavedUser, type UsersState } from "../devAuth";
import { initials } from "../directory";
import { decodeToken, guestId, loadLastUser, saveLastUser, type Session } from "../session";

interface Person {
  id: string;
  name: string;
  sub: string;
  saved: boolean;
}

/**
 * Sign-in: continue as a guest, or pick a person — the dev server signs a token for them.
 * Pasting a token by hand is kept under "More options".
 */
export function Login({ onLogin, notice }: { onLogin: (s: Session) => void; notice?: string }) {
  const last = loadLastUser();
  const [role, setRole] = useState<Role>("customer");
  const [state, setState] = useState<UsersState | null>(null);
  const [unavailable, setUnavailable] = useState("");
  const [customers, setCustomers] = useState<KnownCustomer[] | null>(null);
  const [customersError, setCustomersError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    devAuth
      .users()
      .then(setState)
      .catch((err: Error) => setUnavailable(err.message));
  }, []);

  const loadCustomers = useCallback(() => {
    setCustomersError("");
    setCustomers(null);
    devAuth
      .customers()
      .then((r) => setCustomers(r.customers))
      .catch((err: Error) => {
        setCustomers([]);
        setCustomersError(err.message);
      });
  }, []);

  useEffect(() => {
    if (role === "customer" && state?.signing && customers === null && !customersError) loadCustomers();
  }, [role, state, customers, customersError, loadCustomers]);

  const signIn = async (id: string, name: string, remember = true) => {
    setBusyId(id);
    setError("");
    try {
      const { token, exp } = await devAuth.token(role, id);
      if (remember) saveLastUser({ role, id });
      onLogin({ role, token, userId: id, exp, name });
    } catch (err) {
      setError((err as Error).message);
      setBusyId(null);
    }
  };

  const save = async (u: SavedUser) => {
    try {
      const r = await devAuth.save(u);
      setState((s) => s && { ...s, users: r.users });
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  };

  const remove = async (u: SavedUser) => {
    try {
      const r = await devAuth.remove(u);
      setState((s) => s && { ...s, users: r.users });
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const people = useMemo<Person[]>(() => {
    const saved = (state?.users ?? []).filter((u) => u.role === role);
    const savedIds = new Set(saved.map((u) => u.id));
    const isLast = (id: string) => last?.role === role && last.id === id;
    const list: Person[] = saved.map((u) => ({ id: u.id, name: u.name, sub: isLast(u.id) ? "Last used" : "Saved", saved: true }));
    if (role === "customer") {
      for (const c of customers ?? []) {
        if (savedIds.has(c.id)) continue;
        list.push({
          id: c.id,
          name: c.name || "Unnamed customer",
          sub: `${c.complaints} complaint${c.complaints === 1 ? "" : "s"}${isLast(c.id) ? " · Last used" : ""}`,
          saved: false,
        });
      }
    }
    const q = query.trim().toLowerCase();
    return list
      .filter((p) => !q || p.name.toLowerCase().includes(q))
      .sort((a, b) => Number(isLast(b.id)) - Number(isLast(a.id)) || Number(b.saved) - Number(a.saved) || a.name.localeCompare(b.name));
  }, [state, customers, role, query, last?.role, last?.id]);

  const quick = state?.signing ?? false;
  const guestLabel = role === "admin" ? "Guest agent" : "Guest";

  return (
    <div className="login">
      <div className="login-card">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </span>
          <div>
            <h1>Support Chat</h1>
            <div className="muted small">Sign in to continue</div>
          </div>
        </div>

        <div className="tabs tabs-login" role="tablist" aria-label="Sign in as">
          {(["customer", "admin"] as Role[]).map((r) => (
            <button
              key={r}
              role="tab"
              aria-selected={role === r}
              className={role === r ? "on" : ""}
              onClick={() => {
                setRole(r);
                setQuery("");
                setError("");
              }}
            >
              {r === "customer" ? "Customer" : "Support agent"}
            </button>
          ))}
        </div>

        {notice && <div className="banner banner-warn">{notice}</div>}
        {error && <div className="banner banner-error">{error}</div>}

        {unavailable ? (
          <div className="banner banner-warn">{unavailable} You can still paste a token under More options.</div>
        ) : !state ? (
          <div className="muted small">Loading…</div>
        ) : !quick ? (
          <div className="banner banner-warn">
            <span>
              Quick sign-in isn't set up. Add <code>JWT_PRIVATE_KEY</code> to <code>chat-frontend/.env</code> (same value as
              ondc-api) and restart <code>npm run dev</code>.
            </span>
          </div>
        ) : (
          <>
            <button
              className="btn btn-primary btn-block btn-lg"
              disabled={busyId !== null}
              onClick={() => void signIn(guestId(role), guestLabel, false)}
            >
              {busyId?.startsWith("guest-") ? "Signing in…" : `Continue as ${role === "admin" ? "guest agent" : "guest"}`}
            </button>

            <div className="divider"><span>or sign in as</span></div>

            {(people.length > 6 || query) && (
              <input className="input" type="search" placeholder="Search by name" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search people" />
            )}

            {customersError && role === "customer" && (
              <div className="banner banner-warn">
                <span>Couldn't load customers: {customersError}</span>
                <button className="link" onClick={loadCustomers}>Retry</button>
              </div>
            )}

            <ul className="people">
              {people.map((p) => (
                <li key={p.id} className="person">
                  <button className="person-pick" onClick={() => void signIn(p.id, p.name)} disabled={busyId !== null}>
                    <span className="avatar" aria-hidden>{initials(p.name)}</span>
                    <span className="person-text">
                      <span className="person-name">{p.name}</span>
                      <span className="person-sub">{busyId === p.id ? "Signing in…" : p.sub}</span>
                    </span>
                  </button>
                  <button
                    className="btn btn-subtle btn-sm person-action"
                    disabled={busyId !== null}
                    onClick={() => void (p.saved ? remove({ role, id: p.id, name: p.name }) : save({ role, id: p.id, name: p.name }))}
                  >
                    {p.saved ? "Remove" : "Save"}
                  </button>
                </li>
              ))}
              {people.length === 0 && (
                <li className="empty small">
                  {query
                    ? "Nobody matches that name."
                    : role === "customer" && customers === null
                      ? "Loading customers…"
                      : role === "admin"
                        ? "No saved agents yet."
                        : "No customers yet."}
                </li>
              )}
            </ul>
          </>
        )}

        <details className="more" open={!!unavailable || (!!state && !quick)}>
          <summary>More options</summary>
          <div className="more-body">
            {quick && <AddUser key={role} role={role} onSave={save} />}
            <PasteToken role={role} onLogin={onLogin} />
            {quick && <p className="hint">Sign-ins last {state?.tokenHours} hours. Saved people are kept in users.json.</p>}
          </div>
        </details>
      </div>
    </div>
  );
}

function AddUser({ role, onSave }: { role: Role; onSave: (u: SavedUser) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await onSave({ role, id: id.trim(), name: name.trim() })) {
      setName("");
      setId("");
    }
  };
  return (
    <form className="mini-form" onSubmit={(e) => void submit(e)}>
      <div className="mini-form-title">Save {role === "admin" ? "an agent" : "a customer"}</div>
      <div className="mini-form-row">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Name" />
        <input className="input" value={id} onChange={(e) => setId(e.target.value)} placeholder="User id" aria-label="User id" spellCheck={false} />
        <button className="btn btn-secondary" type="submit" disabled={!name.trim() || !id.trim() || /\s/.test(id.trim())}>Save</button>
      </div>
    </form>
  );
}

function PasteToken({ role, onLogin }: { role: Role; onLogin: (s: Session) => void }) {
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = token.trim().replace(/^Bearer\s+/i, "");
    const claims = decodeToken(t);
    if (!claims) {
      setError("That doesn't look like a valid token.");
      return;
    }
    if (claims.exp && claims.exp * 1000 < Date.now()) {
      setError("This token has expired.");
      return;
    }
    if (role === "admin" && claims.role && claims.role !== "ADMIN") {
      setError("This token doesn't have agent (ADMIN) access.");
      return;
    }
    onLogin({ role, token: t, userId: claims.userId, exp: claims.exp });
  };

  return (
    <form className="mini-form" onSubmit={submit}>
      <div className="mini-form-title">Paste a token</div>
      <textarea
        className="input mono"
        rows={3}
        value={token}
        onChange={(e) => {
          setToken(e.target.value);
          setError("");
        }}
        placeholder={`JWT for a ${role === "admin" ? "support agent" : "customer"}`}
        spellCheck={false}
      />
      {error && <div className="banner banner-error">{error}</div>}
      <button className="btn btn-secondary" type="submit" disabled={!token.trim()}>Continue</button>
    </form>
  );
}
