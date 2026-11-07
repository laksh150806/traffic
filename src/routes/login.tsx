import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { LineInput } from "@/components/fx/controls";
import { toast } from "@/components/fx/global";
import { Decrypt, GlitchText, TypeLine } from "@/components/fx/text";
import { HudRing, LetterGlitch, RetroGrid, Serial } from "@/components/fx/decor";
import { AUTH_AVAILABLE, signIn, signUp, useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Operator sign-in · SIGNAL OPS" }] }),
  component: LoginPage,
});

function LoginPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "bad" | "ok"; text: string } | null>(null);

  useEffect(() => {
    if (auth.status === "signed-in") void navigate({ to: "/" });
  }, [auth.status, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      if (mode === "in") {
        await signIn(email, password);
        toast("Access granted.", "ok");
      } else {
        const { needsConfirmation } = await signUp(
          email,
          password,
          name || email.split("@")[0] || "operator",
        );
        setMessage(
          needsConfirmation
            ? {
                tone: "ok",
                text: "Account created. Open the confirmation link in your email, then sign in.",
              }
            : { tone: "ok", text: "Account created. You are signed in." },
        );
      }
    } catch (error) {
      setMessage({ tone: "bad", text: error instanceof Error ? error.message : "Sign-in failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ops-login">
      <div className="ops-login-bg" aria-hidden>
        <LetterGlitch />
      </div>
      <RetroGrid />
      <div className="ops-login-card">
        <div className="flex items-center gap-4">
          <HudRing size={84}>
            <span className="font-mono text-[0.6rem] ops-amber">AUTH</span>
          </HudRing>
          <div>
            <p className="ops-kicker">Restricted console</p>
            <h1 className="ops-h1">
              <GlitchText text="SIGNAL OPS" />
            </h1>
          </div>
        </div>
        <TypeLine
          className="mt-3 block font-mono text-xs ops-dim"
          text={
            mode === "in"
              ? "> identify operator to unlock signal controls"
              : "> enrol new operator · first account becomes admin"
          }
        />

        {!AUTH_AVAILABLE ? (
          <p className="ops-panel mt-5 font-mono text-xs ops-amber">
            Sign-in needs the live database (VITE_DATA_MODE=live). In simulated mode every control
            is open.
          </p>
        ) : (
          <form className="mt-6 space-y-5" onSubmit={(e) => void submit(e)}>
            {mode === "up" ? (
              <LineInput
                label="Call sign"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                autoComplete="nickname"
              />
            ) : null}
            <LineInput
              label="Email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
            <LineInput
              label="Passphrase"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "in" ? "current-password" : "new-password"}
            />
            {message ? (
              <p
                role="alert"
                className={`font-mono text-xs ${message.tone === "bad" ? "ops-red" : "ops-green"}`}
              >
                {message.text}
              </p>
            ) : null}
            <button
              type="submit"
              className="ops-btn solid w-full justify-center py-3"
              disabled={busy}
            >
              <Decrypt
                text={busy ? "VERIFYING" : mode === "in" ? "AUTHENTICATE" : "ENROL OPERATOR"}
              />
            </button>
          </form>
        )}

        <div className="mt-5 flex items-center justify-between gap-3">
          <button
            type="button"
            className="ops-label hover:text-[var(--amber)]"
            onClick={() => setMode(mode === "in" ? "up" : "in")}
          >
            {mode === "in" ? "New operator? Enrol" : "Have an account? Sign in"}
          </button>
          <Link to="/" className="ops-label hover:text-[var(--amber)]">
            View read-only
          </Link>
        </div>
        <div className="mt-6 flex justify-between">
          <Serial code="AUTH-RLS-01" />
          <span className="ops-label">Roles enforced by Postgres</span>
        </div>
      </div>
    </div>
  );
}
