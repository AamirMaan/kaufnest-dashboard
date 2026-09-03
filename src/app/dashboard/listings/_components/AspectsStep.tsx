"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Field, Select, Input } from "@/components/ui/FormFields";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import type { DraftFormState } from "../_lib/wizardValidation";

interface RequiredAspect {
  name: string;
  values: string[];
  isProductIdentifier: boolean;
}

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  /** AI controls are hidden entirely when the plan or the tenant flag says no
   *  — never rendered-and-disabled. Defaults to off so any other caller gets
   *  the plain field group. */
  aiVisible?: boolean;
  /** Called after a successful AI fill so `AiUsageNote` can re-read usage. */
  onAiUsed?: () => void;
}

/** Marks a field the model filled in and the seller has not touched since. */
function AiBadge() {
  return (
    <span
      title="Filled by AI — check it before publishing"
      className="inline-flex items-center gap-1 rounded-(--radius-btn) bg-(--color-info-bg) px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-(--color-info-text)"
    >
      <Sparkles size={10} /> AI
    </span>
  );
}

export function AspectsStep({ draft, setDraft, aiVisible = false, onAiUsed }: Props) {
  const { success, info, error: toastError } = useToast();
  const [required, setRequired] = useState<RequiredAspect[] | null>(null);
  const [notApplicableText, setNotApplicableText] = useState("Does not apply");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /* Which aspect names the model filled in and the seller has not edited
   * since. Deliberately local, not part of `draft`: it is provenance for this
   * editing session only and must never be persisted to
   * `ebay_listing_drafts` or sent to eBay. */
  const [aiFilled, setAiFilled] = useState<Set<string>>(new Set());
  const [aiBusy, setAiBusy] = useState(false);
  /* Quota exhaustion (429) is the one AI failure that stays visible and
   * disables the control rather than hiding it — the message quotes the real
   * limit and comes from the route body. */
  const [quotaMessage, setQuotaMessage] = useState<string | null>(null);

  useEffect(() => {
    // Deferred via a microtask so every branch's setState — including the
    // no-category early return — runs after this tick, not synchronously
    // within the effect body (trips react-hooks/set-state-in-effect
    // otherwise; same pattern as welcome/page.tsx).
    Promise.resolve().then(async () => {
      if (!draft.category_id) {
        setRequired([]);
        setAiFilled(new Set());
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await fetch(
          `/api/listings/ebay/aspects?categoryId=${encodeURIComponent(draft.category_id)}`
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load required item details");
        setRequired(json.aspects);
        setNotApplicableText(json.notApplicableText);
        // A different category means a different set of aspect names — any
        // "AI" badges still on screen belong to the old set.
        setAiFilled(new Set());
        setDraft({ required_aspect_names: json.aspects.map((a: RequiredAspect) => a.name) });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load required item details");
      } finally {
        setLoading(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.category_id]);

  /** The seller edited this field — it is theirs now, drop the badge. */
  function clearAiFlag(name: string) {
    setAiFilled((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function updateAspect(name: string, value: string) {
    clearAiFlag(name);
    setDraft({ aspects: { ...draft.aspects, [name]: value } });
  }

  async function fillWithAi() {
    if (!required || required.length === 0 || aiBusy) return;
    setAiBusy(true);
    try {
      const res = await fetch("/api/listings/ai/aspects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: draft.category_id,
          requiredAspectNames: required.map((a) => a.name),
          title: draft.title,
          description: draft.description,
          imageUrls: draft.image_urls,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (res.status === 429) {
          setQuotaMessage(json.error ?? "AI generations are used up for this month.");
        }
        throw new Error(json.error ?? "The assistant could not fill in these details.");
      }

      const returned = (json.aspects ?? {}) as Record<string, unknown>;
      const merged = { ...draft.aspects };
      const filled = new Set<string>();

      for (const aspect of required) {
        const existing = (draft.aspects[aspect.name] ?? "").trim();
        // Anything the seller typed (or ticked "does not apply" on) wins. A
        // previous AI answer does not — re-running is allowed to replace it.
        if (existing && !aiFilled.has(aspect.name)) continue;

        const raw = returned[aspect.name];
        const candidate = typeof raw === "string" ? raw.trim() : "";
        // An empty value means "could not determine". Writing it back would
        // read as a confident blank answer and, worse, would look like the
        // field had been dealt with.
        if (!candidate) continue;

        let value = candidate;
        if (aspect.values.length > 0) {
          // eBay gave this aspect a closed value list, and the field renders
          // as a <select>. A value outside the list would set state that no
          // <option> matches — the control would show blank while the draft
          // held an invalid value, and eBay would reject it at publish time.
          const match = aspect.values.find(
            (v) => v.toLowerCase() === candidate.toLowerCase()
          );
          if (!match) continue;
          value = match;
        }

        merged[aspect.name] = value;
        filled.add(aspect.name);
      }

      setAiFilled(filled);
      setQuotaMessage(null);
      onAiUsed?.();

      if (filled.size === 0) {
        info("Nothing to fill in", "The assistant could not determine any of these details.");
        return;
      }
      setDraft({ aspects: merged });
      success(
        filled.size === 1 ? "Filled in 1 item specific." : `Filled in ${filled.size} item specifics.`
      );
    } catch (err) {
      toastError(
        err instanceof Error ? err.message : "The assistant could not fill in these details."
      );
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-(--color-text-muted)">Loading required item details…</p>;
  if (error) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!required) return null;

  if (required.length === 0) {
    return (
      <p className="text-sm text-(--color-text-muted)">
        No additional item details are required for this category.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-(--color-text-muted)">
          eBay requires these details for the category you selected.
        </p>
        {aiVisible && (
          <Button
            // Explicit type: this sits inside `ListingForm.tsx`'s <form>,
            // where the HTML default (submit) would publish the listing.
            type="button"
            variant="secondary"
            size="sm"
            onClick={fillWithAi}
            disabled={aiBusy || !!quotaMessage}
          >
            {aiBusy ? (
              <>
                <Loader2 size={14} className="animate-spin" /> Filling…
              </>
            ) : (
              <>
                <Sparkles size={14} /> Fill with AI
              </>
            )}
          </Button>
        )}
      </div>

      {aiVisible && quotaMessage && (
        <p className="text-xs text-(--color-warning-text)">{quotaMessage}</p>
      )}

      {required.map((aspect) => {
        const value = draft.aspects[aspect.name] ?? "";
        const isNotApplicable = value === notApplicableText;
        const badge = aiFilled.has(aspect.name) ? <AiBadge /> : null;

        if (aspect.isProductIdentifier && aspect.values.length === 0) {
          return (
            <Field key={aspect.name} label={aspect.name} required>
              <div className="flex items-center gap-2">
                <div className="flex-1">
                  <Input
                    required={!isNotApplicable}
                    value={isNotApplicable ? "" : value}
                    disabled={isNotApplicable}
                    onChange={(e) => updateAspect(aspect.name, e.target.value)}
                  />
                </div>
                {badge}
              </div>
              <label className="mt-1.5 flex items-center gap-2 text-xs text-(--color-text-muted)">
                <input
                  type="checkbox"
                  checked={isNotApplicable}
                  onChange={(e) =>
                    updateAspect(aspect.name, e.target.checked ? notApplicableText : "")
                  }
                />
                This product doesn&apos;t have a {aspect.name}
              </label>
            </Field>
          );
        }

        return (
          <Field key={aspect.name} label={aspect.name} required>
            <div className="flex items-center gap-2">
              <div className="flex-1">
                {aspect.values.length > 0 ? (
                  <Select
                    required
                    value={value}
                    onChange={(e) => updateAspect(aspect.name, e.target.value)}
                  >
                    <option value="">Select…</option>
                    {aspect.values.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </Select>
                ) : (
                  <Input
                    required
                    value={value}
                    onChange={(e) => updateAspect(aspect.name, e.target.value)}
                  />
                )}
              </div>
              {badge}
            </div>
          </Field>
        );
      })}
    </div>
  );
}
