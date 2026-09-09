"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BrandMark } from "@/components/layout/BrandMark";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkError = searchParams.get("error") === "invalid_link";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (authError) {
      setError("Invalid email or password.");
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="w-full max-w-sm">
      {/* Logo / Brand */}
      <div className="mb-8 text-center">
        <BrandMark size={40} className="mx-auto mb-2" />
        <span className="text-3xl font-bold text-[var(--color-text-strong)] tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-[var(--color-text-muted)]">Business Dashboard</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-[var(--color-surface)] border border-[var(--color-border)] rounded-2xl p-8 shadow-[var(--shadow-card)] space-y-5"
      >
        <h1 className="text-lg font-semibold text-[var(--color-text-strong)] mb-1">Sign in</h1>

        {linkError && (
          <div className="rounded-lg bg-[var(--color-warning-bg)] border border-[var(--color-warning-text)]/30 px-4 py-3 text-sm text-[var(--color-warning-text)]">
            Your link has expired or is invalid. Please sign in or request a new one.
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-[var(--color-danger-bg)] border border-[var(--color-danger-text)]/30 px-4 py-3 text-sm text-[var(--color-danger-text)]">
            {error}
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

        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <label htmlFor="password" className="block text-sm font-medium text-[var(--color-text-base)]">
              Password
            </label>
            <Link href="/forgot-password" className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-strong)] transition-colors">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2 text-sm text-[var(--color-text-strong)] placeholder-[var(--color-text-faint)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>

        <p className="text-center text-xs text-[var(--color-text-muted)]">
          Don&rsquo;t have an account?{" "}
          <Link href="/signup" className="text-[var(--color-text-base)] hover:text-[var(--color-text-strong)] transition-colors">
            Start a free trial
          </Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
