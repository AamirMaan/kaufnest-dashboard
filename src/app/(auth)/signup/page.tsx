"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export default function SignupPage() {
  const [companyName, setCompanyName] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [referral, setReferral] = useState("");
  const [consent, setConsent] = useState(false);

  // Prefill from a referral link like /signup?ref=alice — still editable,
  // and it's fine if this runs after first paint since the field starts
  // empty either way. Plain URLSearchParams instead of Next's
  // useSearchParams() so this client component doesn't need a <Suspense>
  // boundary just for an optional prefill. Deferred via a microtask rather
  // than calling setReferral directly, since a synchronous setState in the
  // effect body trips react-hooks/set-state-in-effect — same pattern as
  // welcome/page.tsx's auto-provision.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref) Promise.resolve().then(() => setReferral(ref));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Please choose a password of at least 8 characters.");
      return;
    }

    if (!consent) {
      setError("Please agree to the Terms & Conditions and Privacy Policy to continue.");
      return;
    }

    setLoading(true);
    const supabase = createClient();

    const trimmedReferral = referral.trim();

    // Creates an UNCONFIRMED auth user and nothing else — no tenant, no
    // schema, no Management API call. Provisioning happens only after the
    // email is confirmed (see /api/signup/provision), so anonymous traffic
    // can never reach it.
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          company_name: companyName.trim(),
          full_name: fullName.trim(),
          ...(trimmedReferral ? { referral: trimmedReferral } : {}),
          // Recorded so we can show, if it's ever disputed, that this account
          // affirmatively agreed to the Terms (which disclaim tax liability)
          // before we created it. `terms_version` pins it to the copy that
          // was live at signup time — see /terms's "Last updated" date.
          terms_accepted_at: new Date().toISOString(),
          terms_version: "2026-09",
        },
      },
    });

    if (signUpError) {
      setError(
        signUpError.message.toLowerCase().includes("already")
          ? "An account with this email already exists. Try signing in instead."
          : signUpError.message
      );
      setLoading(false);
      return;
    }

    setSent(true);
    setLoading(false);
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <img src="/brand/boughtopia-icon-bag-mono-light.svg" alt="" aria-hidden="true" width={40} height={40} className="mx-auto mb-2" />
          <span className="text-3xl font-bold text-white tracking-tight">
            Bought<span className="text-[var(--color-primary-hover)]">opia</span>
          </span>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <h1 className="text-lg font-semibold text-white mb-2">Check your email</h1>
          <p className="text-sm text-slate-400">
            We sent a confirmation link to <strong className="text-slate-200">{email}</strong>.
            Click it and we&rsquo;ll set up your workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <img src="/brand/boughtopia-icon-bag-mono-light.svg" alt="" aria-hidden="true" width={40} height={40} className="mx-auto mb-2" />
        <span className="text-3xl font-bold text-white tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>
        <p className="mt-2 text-sm text-slate-400">14 days free · no credit card</p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-5"
      >
        <h1 className="text-lg font-semibold text-white mb-1">Start your free trial</h1>

        {error && (
          <div className="rounded-lg bg-red-950 border border-red-800 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="space-y-1">
          <label htmlFor="company" className="block text-sm font-medium text-slate-300">
            Company name
          </label>
          <input
            id="company"
            type="text"
            autoComplete="organization"
            required
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="Acme GmbH"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="fullName" className="block text-sm font-medium text-slate-300">
            Your name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="Jane Doe"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="email" className="block text-sm font-medium text-slate-300">
            Work email
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

        <div className="space-y-1">
          <label htmlFor="password" className="block text-sm font-medium text-slate-300">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="At least 8 characters"
          />
        </div>

        <div className="space-y-1">
          <label htmlFor="referral" className="block text-sm font-medium text-slate-300">
            Referred by <span className="text-slate-500">(optional)</span>
          </label>
          <input
            id="referral"
            type="text"
            value={referral}
            onChange={(e) => setReferral(e.target.value)}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)] focus:border-transparent"
            placeholder="Referral code or name"
          />
        </div>

        <div className="flex items-start gap-2">
          <input
            id="consent"
            type="checkbox"
            required
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-700 bg-slate-800 text-[var(--color-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <label htmlFor="consent" className="text-xs text-slate-400">
            I agree to the{" "}
            <Link href="/terms" target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-white underline">
              Terms &amp; Conditions
            </Link>{" "}
            and{" "}
            <Link href="/privacy" target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-white underline">
              Privacy Policy
            </Link>
            , including that Boughtopia is not liable for my business&apos;s tax
            calculation, collection, or reporting.
          </label>
        </div>

        <button
          type="submit"
          disabled={loading || !consent}
          className="w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] disabled:opacity-60 disabled:cursor-not-allowed px-4 py-2 text-sm font-semibold text-white transition-colors"
        >
          {loading ? "Creating your account…" : "Start free trial"}
        </button>

        <p className="text-center text-xs text-slate-400">
          Already have an account?{" "}
          <Link href="/login" className="text-slate-200 hover:text-white transition-colors">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
