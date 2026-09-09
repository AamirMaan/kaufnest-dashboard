"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/BrandMark";

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
          <BrandMark size={40} className="mx-auto mb-2" />
          <span className="text-3xl font-bold text-[var(--color-text-strong)] tracking-tight">
            Bought<span className="text-[var(--color-primary-hover)]">opia</span>
          </span>
        </div>
        <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 shadow-[var(--shadow-card)] space-y-4">
          <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-text)]/30 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            This link has expired or is invalid. Please request a new one.
          </div>
          <a
            href="/forgot-password"
            className="block text-center text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-strong)] transition-colors"
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
        <BrandMark size={40} className="mx-auto mb-2" />
        <span className="text-3xl font-bold text-[var(--color-text-strong)] tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Business Dashboard</p>
      </div>

      <div className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 shadow-[var(--shadow-card)] space-y-5">
        <div>
          <h1 className="text-lg font-semibold text-[var(--color-text-strong)] mb-1">Set your password</h1>
          <p className="text-sm text-[var(--color-text-muted)]">Choose a strong password for your account.</p>
        </div>

        {state === "success" ? (
          <div className="rounded-lg bg-[var(--color-success-bg)] border border-[var(--color-success-text)]/30 px-4 py-3 text-sm text-[var(--color-success-text)]">
            Password set! Redirecting to your dashboard…
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {errorMsg && (
              <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-text)]/30 px-4 py-3 text-sm text-[var(--color-danger-text)]">
                {errorMsg}
              </div>
            )}

            <div className="space-y-1">
              <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text-base)]">
                New password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-strong)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
                placeholder="Minimum 8 characters"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="confirm" className="block text-sm font-medium text-[var(--color-text-base)]">
                Confirm password
              </label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-strong)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
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
