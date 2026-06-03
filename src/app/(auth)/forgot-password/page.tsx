"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

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
    const redirectTo = `${window.location.origin}/auth/callback?next=/set-password`;

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
        <span className="text-3xl font-bold text-white tracking-tight">
          Kauf<span className="text-[var(--color-primary-hover)]">Nest</span>
        </span>
        <p className="mt-2 text-sm text-slate-400">Business Dashboard</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-white mb-1">Reset password</h1>
          <p className="text-sm text-slate-400">
            Enter your account email and we&apos;ll send you a reset link.
          </p>
        </div>

        {state === "sent" ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-green-950 border border-green-800 px-4 py-3 text-sm text-green-300">
              Check your inbox — a reset link has been sent to <strong>{email}</strong>.
            </div>
            <Link
              href="/login"
              className="block text-center text-sm text-slate-400 hover:text-white transition-colors"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {(state === "error" && errorMsg) && (
              <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-300">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="email" className="block text-sm font-medium text-slate-300">
                Email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
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
              className="block text-center text-sm text-slate-400 hover:text-white transition-colors"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
