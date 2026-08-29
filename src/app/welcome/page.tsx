"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function WelcomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function provision() {
    setError(null);

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login");
      return;
    }

    let body: { ok?: boolean; error?: string };
    try {
      const res = await fetch("/api/signup/provision", { method: "POST" });
      body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setError(body.error ?? "We couldn't finish setting up your workspace.");
        return;
      }
    } catch {
      setError("Network error — please try again.");
      return;
    }

    // set_user_tenant wrote app_metadata.tenant_schema, but the JWT this
    // browser holds was issued BEFORE that write. Every RLS policy reads the
    // claim from the token itself (auth.jwt() -> 'app_metadata' ->>
    // 'tenant_schema'), not from the auth server, so without this refresh the
    // dashboard loads with a stale token and every single query fails.
    await supabase.auth.refreshSession();
    router.replace("/dashboard");
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Deferred via a microtask rather than called directly: provision()'s
    // first statement is a synchronous setState, which trips
    // react-hooks/set-state-in-effect when invoked straight from an effect
    // body. Same pattern as dashboard/messages/page.tsx's auto-sync.
    Promise.resolve().then(() => provision());
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 px-4">
      <div className="w-full max-w-sm text-center">
        <img
          src="/brand/boughtopia-icon-bag-mono-light.svg"
          alt=""
          aria-hidden="true"
          width={40}
          height={40}
          className="mx-auto mb-2"
        />
        <span className="text-3xl font-bold text-white tracking-tight">
          Bought<span className="text-[var(--color-primary-hover)]">opia</span>
        </span>

        {error ? (
          <div className="mt-8 bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => Promise.resolve().then(() => provision())}
              className="mt-4 w-full rounded-[var(--radius-btn)] bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)] px-4 py-2 text-sm font-semibold text-white transition-colors"
            >
              Try again
            </button>
          </div>
        ) : (
          <p className="mt-8 text-sm text-slate-400">
            Setting up your workspace… this takes a few seconds.
          </p>
        )}
      </div>
    </div>
  );
}
