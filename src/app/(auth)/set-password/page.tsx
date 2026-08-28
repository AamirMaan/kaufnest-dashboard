"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type State = "idle" | "loading" | "success" | "error" | "no-session";

export default function SetPasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Verify the user has an active session (set by the callback route).
  // If not, they landed here without a valid link.
  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) setState("no-session");
    });
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    if (password.length < 8) {
      setErrorMsg("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setErrorMsg("Passwords do not match.");
      return;
    }

    setState("loading");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setErrorMsg(error.message);
      setState("error");
      return;
    }

    // Re-mint the access token so app_metadata.tenant_schema (stamped by
    // set_user_tenant during provisioning/invite) is present on the JWT —
    // otherwise dashboard/layout.tsx's createClient() falls back to the
    // public schema and the profiles lookup returns no row.
    await supabase.auth.refreshSession();

    setState("success");
    setTimeout(() => router.push("/dashboard"), 1500);
  }

  if (state === "no-session") {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="text-3xl font-bold text-white tracking-tight">
            Bought<span className="text-[var(--color-primary-hover)]">opia</span>
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-4">
          <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-300">
            This link has expired or is invalid. Please request a new one.
          </div>
          <a
            href="/forgot-password"
            className="block text-center text-sm text-slate-400 hover:text-white transition-colors"
          >
            Request a new link →
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <span className="text-3xl font-bold text-white tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-slate-400">Business Dashboard</p>
      </div>

      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-white mb-1">Set your password</h1>
          <p className="text-sm text-slate-400">Choose a strong password for your account.</p>
        </div>

        {state === "success" ? (
          <div className="rounded-lg bg-green-950 border border-green-800 px-4 py-3 text-sm text-green-300">
            Password set! Redirecting to your dashboard…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-300">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium text-slate-300">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="confirm" className="block text-sm font-medium text-slate-300">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                placeholder="Re-enter your password"
              />
            </div>

            <button
              type="submit"
              disabled={state === "loading"}
              className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              {state === "loading" ? "Saving…" : "Set password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
