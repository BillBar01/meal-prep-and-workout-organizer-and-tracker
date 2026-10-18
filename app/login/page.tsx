"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error") === "link") {
      setError("That sign-in link expired or was already used. Send a new one.");
    }
  }, []);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback`, shouldCreateUser: true },
    });
    setBusy(false);
    if (error) {
      setError(/sign-ups are closed|database error/i.test(error.message)
        ? "This app is private. That email can't sign in."
        : error.message);
      return;
    }
    setSent(true);
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: "email" });
    setBusy(false);
    if (error) {
      setError("That code didn't work. Check it, or send a new email.");
      return;
    }
    router.replace("/");
    router.refresh();
  }

  return (
    <main className="login">
      {!sent ? (
        <form onSubmit={sendLink}>
          <div>
            <div className="eyebrow">Private app</div>
            <h1>Sunday Meal Prep</h1>
          </div>
          <label className="field" htmlFor="email">
            Email
            <input id="email" type="email" autoComplete="email" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
          {error && <p className="err">{error}</p>}
          <button className="btn" type="submit" disabled={busy}>{busy ? "Sending…" : "Email me a sign-in link"}</button>
        </form>
      ) : (
        <form onSubmit={verifyCode}>
          <div>
            <div className="eyebrow">Check your email</div>
            <h1>Sign-in sent</h1>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Tap the link in the email from Supabase, or type the 6-digit code from it here.
          </p>
          <label className="field" htmlFor="code">
            Code
            <input id="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6,8}" value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          {error && <p className="err">{error}</p>}
          <button className="btn" type="submit" disabled={busy || code.trim().length < 6}>{busy ? "Checking…" : "Sign in with code"}</button>
          <button className="btn ghost" type="button" onClick={() => { setSent(false); setCode(""); }}>Use a different email</button>
        </form>
      )}
    </main>
  );
}
