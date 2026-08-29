"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "../lib/api";
import { Icon, Spinner } from "../lib/ui";

const DEMO_EMAIL = "admin@signalledger.local";
const DEMO_PASSWORD = "demo1234";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/";

  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [busy, setBusy] = useState(false);
  const [automaticLogin, setAutomaticLogin] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Already signed in? Go straight to the workspace.
    api.me().then(() => router.replace(nextUrl)).catch(() => undefined);
  }, [router, nextUrl]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "login") {
        await api.login(email.trim(), password);
      } else {
        await api.register({ name: name.trim(), email: email.trim(), password, organization_name: orgName.trim() });
      }
      router.replace(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
      setBusy(false);
    }
  };

  const loginAutomatically = async () => {
    if (busy) return;
    setBusy(true);
    setAutomaticLogin(true);
    setError(null);
    try {
      await api.login(DEMO_EMAIL, DEMO_PASSWORD);
      router.replace(nextUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Automatic login failed.");
      setBusy(false);
      setAutomaticLogin(false);
    }
  };

  return (
    <main className="sl-login">
      <div className="sl-login-card">
        <div className="sl-brand sl-login-brand">
          <span className="sl-logo"><Icon name="pulse" /></span>
          <div>
            <h1 className="sl-title">Signal<span>Ledger</span></h1>
            <p className="sl-tagline">Podcast ad reconciliation</p>
          </div>
        </div>

        <div className="sl-login-tabs" role="tablist">
          <button className={`sl-login-tab ${mode === "login" ? "sl-active" : ""}`} onClick={() => { setMode("login"); setError(null); }}>Sign in</button>
          <button className={`sl-login-tab ${mode === "register" ? "sl-active" : ""}`} onClick={() => { setMode("register"); setError(null); }}>Create workspace</button>
        </div>

        <form className="sl-login-form" onSubmit={submit}>
          {mode === "register" ? (
            <>
              <label className="sl-field">
                <span className="sl-field-label">Your name</span>
                <input className="sl-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Rivera" autoFocus />
              </label>
              <label className="sl-field">
                <span className="sl-field-label">Organization name *</span>
                <input className="sl-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="Acme Podcast Network" required />
              </label>
            </>
          ) : null}
          <label className="sl-field">
            <span className="sl-field-label">Email *</span>
            <input className="sl-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required autoFocus={mode === "login"} />
          </label>
          <label className="sl-field">
            <span className="sl-field-label">Password *</span>
            <input className="sl-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "register" ? "At least 8 characters" : "••••••••"} required minLength={mode === "register" ? 8 : undefined} />
          </label>

          {error ? <div className="sl-inline-error"><Icon name="alert" /> {error}</div> : null}

          <button className="sl-btn sl-btn-primary sl-login-submit" type="submit" disabled={busy}>
            {busy && !automaticLogin ? <Spinner sm /> : <Icon name={mode === "login" ? "shield" : "plus"} />}
            {mode === "login" ? "Sign in" : "Create workspace"}
          </button>

          {mode === "login" ? (
            <>
              <div className="sl-login-or"><span>or</span></div>
              <button className="sl-btn sl-btn-outline sl-login-submit" type="button" onClick={() => void loginAutomatically()} disabled={busy}>
                {automaticLogin ? <Spinner sm /> : <Icon name="pulse" />}
                {automaticLogin ? "Opening demo workspace…" : "Automatic demo login"}
              </button>
            </>
          ) : null}
        </form>

        {mode === "login" ? (
          <p className="sl-login-hint">No setup required — automatic login opens the populated demo workspace.</p>
        ) : (
          <p className="sl-login-hint">Creates a fresh organization where you are the admin.</p>
        )}
      </div>
    </main>
  );
}
