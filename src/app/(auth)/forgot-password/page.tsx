"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/BrandMark";

type State = "idle" | "loading" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    setErrorMsg(null);

    const supabase = createClient();
    const redirectTo = `${window.location.origin}/auth/confirm?next=/set-password`;

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo,
    });

    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }

    setState("sent");
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <BrandMark size={40} className="mx-auto mb-2" />
        <span className="text-3xl font-bold text-[var(--color-text-strong)] tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Business Dashboard</p>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 shadow-[var(--shadow-card)] space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-strong)] mb-1">Reset password</h1>
          <p className="text-sm text-[var(--color-text-muted)]">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>

        {state === "sent" ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-[var(--color-success-bg)] border border-[var(--color-success-text)]/30 px-4 py-3 text-sm text-[var(--color-success-text)]">
              Check your inbox — a reset link has been sent to <strong>{email}</strong>.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-strong)] transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {(state === "error" && errorMsg) && (
              <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-text)]/30 px-4 py-3 text-sm text-[var(--color-danger-text)]">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-[var(--color-text-base)]">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-strong)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={state === "loading"}
              className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {state === "loading" ? "Sending…" : "Send reset link"}
            </button>

            <Link
              href="/login"
              className="block text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-strong)] transition-colors"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
