"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export function AccountForm({ mode }: { mode: "signup" | "recover" | "reset" | "confirm" }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(mode === "confirm");
  const tokens = useRef<Record<string, string> | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (mode !== "reset" && mode !== "confirm" || started.current) return;
    started.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    tokens.current = { access_token: hash.get("access_token") ?? "", refresh_token: hash.get("refresh_token") ?? "" };
    window.history.replaceState(null, "", window.location.pathname);
    if (mode !== "confirm") return;
    void fetch("/api/auth/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tokens.current) })
      .then(async response => { if (!response.ok) throw new Error("This verification link has expired. Try signing in or request another email."); router.replace("/admin"); router.refresh(); })
      .catch(failure => { setError(failure.message); setPending(false); });
  }, [mode, router]);
  return <form className="login-form" onSubmit={async event => {
    event.preventDefault(); setPending(true); setError("");
    try {
      const fields = Object.fromEntries(new FormData(event.currentTarget));
      const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, ...(mode === "reset" ? tokens.current : {}) }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Please try again.");
      if (mode === "reset") { router.replace("/admin"); router.refresh(); return; }
      setMessage(result.message); setPending(false);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please try again."); setPending(false); }
  }}>
    {mode === "signup" && <label>Store name<Input name="name" autoComplete="organization" maxLength={80} required disabled={pending || !!message} /></label>}
    {(mode === "signup" || mode === "recover") && <label>Email address<Input name="email" type="email" autoComplete="email" maxLength={254} required disabled={pending || !!message} /></label>}
    {(mode === "signup" || mode === "reset") && <label>{mode === "reset" ? "New password" : "Password"}<Input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required disabled={pending || !!message} /><span className="muted">Use at least 12 characters.</span></label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    {mode !== "confirm" && <Button type="submit" className="button primary" disabled={pending || !!message}>{pending ? "Please wait…" : mode === "signup" ? "Create your workspace" : mode === "recover" ? "Send reset link" : "Save new password"}</Button>}
    {mode === "confirm" && pending && <p role="status">Verifying your email…</p>}
    <Link href="/admin/login">Back to sign in</Link>
  </form>;
}
