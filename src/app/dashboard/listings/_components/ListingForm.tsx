// src/app/dashboard/listings/_components/ListingForm.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { Field, Input, Select } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { hasAiFeatures } from "@/lib/utils/planGating";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { addListingDraft, updateListingDraft } from "../_store/listingsSlice";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import {
  validateSourceStep,
  validateDetailsStep,
  validateCategoryStep,
  validateImagesStep,
  validateAspectsStep,
  validatePoliciesStep,
  validatePricingStep,
  validateAdvertisingStep,
  EMPTY_PRICING_MARKETING,
  NEW_CAMPAIGN,
  type DraftFormState,
} from "../_lib/wizardValidation";
import { toEditorHtml } from "../_lib/descriptionHtml";
import { SourceStep } from "./SourceStep";
import { CategoryStep } from "./CategoryStep";
import { ImageGrid } from "./ImageGrid";
import { AspectsStep } from "./AspectsStep";
import { PoliciesStep } from "./PoliciesStep";
import { AdvertisingSection } from "./AdvertisingSection";
import { PricingSection } from "./PricingSection";
import { useEbayCampaigns } from "./useEbayCampaigns";
import { ListingPreview } from "./ListingPreview";
import { DescriptionEditor } from "./DescriptionEditor";
import { AiUsageNote } from "@/components/ui/AiUsageNote";
import type { EbayListingDraft } from "@/types";

const FORM_ID = "listing-form";

const EMPTY_DRAFT: DraftFormState = {
  source_type: "inventory",
  product_id: "",
  source_url: "",
  title: "",
  description: "",
  price: "",
  currency: "EUR",
  quantity: "1",
  condition: "new",
  category_id: "",
  category_name: "",
  image_urls: [],
  aspects: {},
  required_aspect_names: [],
  fulfillment_policy_id: "",
  payment_policy_id: "",
  return_policy_id: "",
  merchant_location_key: "",
  ...EMPTY_PRICING_MARKETING,
};

function toFormState(row: EbayListingDraft): DraftFormState {
  return {
    source_type: row.source_type,
    product_id: row.product_id ?? "",
    source_url: row.source_url ?? "",
    title: row.title,
    /* `description` has been a plain `text` column since before the rich
     * editor existed, so drafts saved by the old <textarea> are still out
     * there. TipTap parses its `content` as HTML, which collapses plain text
     * into one paragraph and silently drops every line break the seller
     * typed. `toEditorHtml` wraps legacy text in `<p>`/`<br>` (escaping
     * first) and passes anything already HTML straight through. */
    description: toEditorHtml(row.description),
    price: String(row.price),
    currency: row.currency,
    quantity: String(row.quantity),
    condition: row.condition,
    category_id: row.category_id ?? "",
    category_name: row.category_name ?? "",
    image_urls: row.image_urls,
    aspects: row.aspects ?? {},
    required_aspect_names: [],
    fulfillment_policy_id: row.fulfillment_policy_id ?? "",
    payment_policy_id: row.payment_policy_id ?? "",
    return_policy_id: row.return_policy_id ?? "",
    merchant_location_key: row.merchant_location_key ?? "",
    vat_percentage: row.vat_percentage != null ? String(row.vat_percentage) : "",
    best_offer_enabled: row.best_offer_enabled,
    best_offer_auto_accept:
      row.best_offer_auto_accept != null ? String(row.best_offer_auto_accept) : "",
    best_offer_auto_decline:
      row.best_offer_auto_decline != null ? String(row.best_offer_auto_decline) : "",
    multibuy_enabled: row.multibuy_2_pct != null,
    multibuy_2_pct: row.multibuy_2_pct != null ? String(row.multibuy_2_pct) : "",
    multibuy_3_pct: row.multibuy_3_pct != null ? String(row.multibuy_3_pct) : "",
    multibuy_4_pct: row.multibuy_4_pct != null ? String(row.multibuy_4_pct) : "",
    ad_enabled: row.ad_rate != null,
    ad_rate: row.ad_rate != null ? String(row.ad_rate) : "",
    // A saved ad with no campaign means "create one at publish".
    ad_campaign_id: row.ad_rate != null ? (row.ad_campaign_id ?? NEW_CAMPAIGN) : "",
  };
}

/** "" → null, otherwise Number. Used for the optional numeric draft columns. */
function numberOrNull(value: string): number | null {
  return value.trim() ? Number(value) : null;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
      <header className="mb-4">
        <h2 className="text-base font-semibold text-(--color-text-strong)">{title}</h2>
        <p className="text-sm text-(--color-text-muted)">{description}</p>
      </header>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

interface Props {
  draftId: string | null;
}

export function ListingForm({ draftId }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { success, warning, error: toastError } = useToast();
  const companyCurrency = useAppSelector((s) => s.companyProfile.profile?.currency);

  /* AI controls are HIDDEN when the plan doesn't include AI or the platform
   * admin has switched it off for this tenant — never rendered-and-disabled.
   * (Quota exhaustion is the opposite: those controls stay visible and go
   * disabled with the 429's message — see `DescriptionEditor.tsx`.) This is
   * presentation only; `src/lib/ai/authGuard.ts` is the enforcement. */
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const aiEnabled = useAppSelector((s) => s.currentUser.aiEnabled);
  const aiVisible = !!tenantPlan && hasAiFeatures(tenantPlan) && aiEnabled;

  /* Bumped after every successful AI call so `AiUsageNote` re-reads
   * `/api/listings/ai/usage` — otherwise the count only ever reflects the
   * page load and never moves as the seller generates. */
  const [aiUsageToken, setAiUsageToken] = useState(0);

  /* One campaigns fetch for the whole form: Advertising needs the list, and
   * Pricing's multi-buy toggle needs to know whether eBay must be reconnected. */
  const { access: marketingAccess, reload: reloadCampaigns } = useEbayCampaigns();

  const [draft, setDraftState] = useState<DraftFormState>(
    companyCurrency ? { ...EMPTY_DRAFT, currency: companyCurrency } : EMPTY_DRAFT
  );
  const [existingRow, setExistingRow] = useState<EbayListingDraft | null>(null);
  const [loading, setLoading] = useState(!!draftId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  /* Mirrors `ImageGrid`'s internal upload state. Saving mid-upload would
   * persist the `image_urls` array as it was before the uploads finished —
   * the new URLs live only in this component's state until the upload
   * resolves, so they'd be dropped from the row and their objects left
   * orphaned in Storage the moment the seller navigated away. */
  const [imagesUploading, setImagesUploading] = useState(false);

  /* The row identity that `saveDraft` branches on. Kept in a ref as well as
   * in state because `setExistingRow` only lands on the next render: a second
   * save started from a closure captured before that render would still see
   * `existingRow === null` and take the insert branch a second time. The ref
   * is written synchronously, so every later call — whatever closure it came
   * from — sees the row that was just created. */
  const existingRowRef = useRef<EbayListingDraft | null>(null);

  /* In-flight save mutex. `ImageGrid` creates the draft row lazily on the
   * first image upload (`onDraftCreated`) using this same insert path, so a
   * user who clicks Save Draft or Publish during that upload would otherwise
   * enter `saveDraft` a second time while the first insert is still awaiting
   * Supabase — both callers read `existingRowRef.current === null`, both
   * insert, and the tenant ends up with two `ebay_listing_drafts` rows with
   * the images attached to whichever id resolved last. Holding the promise
   * here and handing the *same* promise to any concurrent caller means only
   * one insert can ever be issued, and both callers resolve with the one row
   * that was created. */
  const inFlightSave = useRef<Promise<EbayListingDraft | null> | null>(null);

  useEffect(() => {
    if (!draftId) return;
    (async () => {
      const supabase = await createTenantClient();
      const { data, error: fetchError } = await supabase
        .from("ebay_listing_drafts")
        .select("*")
        .eq("id", draftId)
        .single<EbayListingDraft>();
      if (fetchError || !data) {
        toastError("Could not load this listing.");
        router.push("/dashboard/listings");
        return;
      }
      if (data.status === "published") {
        // Already live on eBay (whether published by this app or imported
        // via Sync) — this form/Inventory API flow must never touch it
        // again. Redirect to the Trading-API live-edit page instead.
        router.push(`/dashboard/listings/${draftId}/live`);
        return;
      }
      if (data.status === "inactive") {
        // Ended on eBay (deleted here, or by eBay/Seller Hub) — there is
        // nothing left to create/publish, and this form has no re-publish
        // flow (out of scope for this pass). Only reachable via a direct
        // URL hit or stale bookmark — the Listings table itself never links
        // an inactive row anywhere (see ListingsTable.tsx).
        toastError("This listing has already ended on eBay.");
        router.push("/dashboard/listings");
        return;
      }
      existingRowRef.current = data;
      setExistingRow(data);
      setDraftState(toFormState(data));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  function setDraft(patch: Partial<DraftFormState>) {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }

  function rememberRow(row: EbayListingDraft) {
    existingRowRef.current = row;
    setExistingRow(row);
  }

  // Publish requires every validator to pass. Save Draft deliberately does
  // not: drafts are allowed to be incomplete (see SKILL.md) and a Save Draft
  // that can always succeed must never render as disabled.
  const publishError =
    validateSourceStep(draft) ??
    validateDetailsStep(draft) ??
    validateCategoryStep(draft) ??
    validateAspectsStep(draft) ??
    validateImagesStep(draft) ??
    validatePricingStep(draft) ??
    validateAdvertisingStep(draft) ??
    validatePoliciesStep(draft);

  const isPublishable = publishError === null;

  /* Why the action buttons are inert, in priority order. An in-flight upload
   * outranks a validation message because it is transient and self-resolving
   * — and because a button that goes dead with no explanation reads as a
   * broken page. */
  const blockedReason = imagesUploading
    ? "Waiting for images to finish uploading…"
    : isPublishable
      ? null
      : publishError;

  function toPayload() {
    return {
      source_type: draft.source_type,
      product_id: draft.source_type === "inventory" ? draft.product_id || null : null,
      source_url: draft.source_type === "dropship" ? draft.source_url || null : null,
      source_platform:
        draft.source_type === "dropship" ? detectPlatform(draft.source_url) : null,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      price: Number(draft.price),
      currency: draft.currency,
      quantity: Number(draft.quantity),
      condition: draft.condition,
      category_id: draft.category_id || null,
      category_name: draft.category_name || null,
      image_urls: draft.image_urls,
      aspects: draft.aspects,
      fulfillment_policy_id: draft.fulfillment_policy_id || null,
      payment_policy_id: draft.payment_policy_id || null,
      return_policy_id: draft.return_policy_id || null,
      merchant_location_key: draft.merchant_location_key || null,
      vat_percentage: numberOrNull(draft.vat_percentage),
      best_offer_enabled: draft.best_offer_enabled,
      // Switched-off extras are saved as null, so a stale value can never
      // reach eBay (or trip a DB CHECK) from a hidden field.
      best_offer_auto_accept: draft.best_offer_enabled
        ? numberOrNull(draft.best_offer_auto_accept)
        : null,
      best_offer_auto_decline: draft.best_offer_enabled
        ? numberOrNull(draft.best_offer_auto_decline)
        : null,
      multibuy_2_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_2_pct) : null,
      multibuy_3_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_3_pct) : null,
      multibuy_4_pct: draft.multibuy_enabled ? numberOrNull(draft.multibuy_4_pct) : null,
      ad_rate: draft.ad_enabled ? numberOrNull(draft.ad_rate) : null,
      ad_campaign_id:
        draft.ad_enabled && draft.ad_campaign_id && draft.ad_campaign_id !== NEW_CAMPAIGN
          ? draft.ad_campaign_id
          : null,
    };
  }

  async function performSave(): Promise<EbayListingDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const existing = existingRowRef.current;
      if (existing) {
        const { data, error: updateError } = await supabase
          .from("ebay_listing_drafts")
          .update(toPayload())
          .eq("id", existing.id)
          .select()
          .single<EbayListingDraft>();
        if (updateError) throw updateError;
        dispatch(updateListingDraft(data));
        rememberRow(data);
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "update",
          entityType: "sale", // closest existing AuditEntity; see Task 18 SKILL.md note
          entityId: data.id,
          metadata: { title: data.title, status: data.status },
        }).then((log) => log && dispatch(addAuditLog(log)));
        return data;
      }

      // `created_by` is set ONLY here, on the insert path — never on the
      // update above, which would otherwise reassign authorship of somebody
      // else's draft to whoever edited it last (a bug this file has had once
      // already; do not "tidy" it into a shared payload).
      const { data, error: insertError } = await supabase
        .from("ebay_listing_drafts")
        .insert({ ...toPayload(), created_by: user.id })
        .select()
        .single<EbayListingDraft>();
      if (insertError) throw insertError;
      dispatch(addListingDraft(data));
      rememberRow(data);
      await writeAuditLog(supabase, {
        userId: user.id,
        userEmail: user.email ?? "",
        action: "create",
        entityType: "sale",
        entityId: data.id,
        metadata: { title: data.title },
      }).then((log) => log && dispatch(addAuditLog(log)));
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save draft");
      return null;
    } finally {
      setSaving(false);
    }
  }

  /** Single entry point for every write. Coalesces concurrent callers onto
   * one promise so the insert branch can only ever run once — see
   * `inFlightSave` above for the race this closes. */
  function saveDraft(): Promise<EbayListingDraft | null> {
    if (inFlightSave.current) return inFlightSave.current;
    const pending = performSave().finally(() => {
      inFlightSave.current = null;
    });
    inFlightSave.current = pending;
    return pending;
  }

  /** Lazy draft creation for ImageGrid: uploads need a real draft id, so the
   * first upload on a never-saved draft creates the row through the normal
   * insert path and returns its id. This is NOT autosave — later field edits
   * still need Save Draft. */
  async function handleDraftCreated(): Promise<string> {
    const saved = await saveDraft();
    if (!saved) throw new Error("Could not create the draft to attach images to.");
    return saved.id;
  }

  async function handleSaveDraft() {
    const saved = await saveDraft();
    if (saved) {
      success("Draft saved.");
      router.push(`/dashboard/listings/${saved.id}`);
    }
  }

  async function handlePublish(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!isPublishable || saving || publishing || imagesUploading) return;
    const saved = await saveDraft();
    if (!saved) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/listings/${saved.id}/publish`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        if (json.draft) dispatch(updateListingDraft(json.draft));
        throw new Error(json.error ?? "Publish failed");
      }
      dispatch(updateListingDraft(json.draft));
      const warnings: string[] = json.warnings ?? [];
      if (warnings.length > 0) {
        // The listing IS live — only the optional ad/multi-buy extras failed.
        warning(
          "Published to eBay, but not everything was applied.",
          `${warnings.join(" ")} You can retry from the listing's edit page.`
        );
      } else {
        success("Published to eBay.");
      }
      router.push("/dashboard/listings");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return <div className="text-sm text-(--color-text-muted)">Loading…</div>;
  }

  return (
    <div className="flex min-h-full flex-col">
      <div className="flex-1">
      <PageHeader
        title={existingRow ? "Edit Listing" : "New Listing"}
        description="Fill in the details on the left — the preview on the right updates as you type."
      />

      {error && (
        <div className="mb-4 rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-4 py-3 text-sm text-(--color-danger-text)">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
        {/* Publish is this form's default submit button, so without this
          * guard pressing Enter in Title, Price, Quantity, the supplier URL
          * or any required-aspect input would implicitly submit — i.e. push
          * a listing live to eBay from a keystroke. The old 7-step wizard
          * made that impossible (Publish only existed on the Review step);
          * the single-page form has to block it explicitly. Three deliberate
          * exemptions: a <textarea> needs Enter for newlines, a
          * contenteditable (the TipTap description editor) needs it for
          * paragraph breaks, and Enter on a focused <button> is standard
          * keyboard activation.
          *
          * The button exemption is ANY <button>, not just type="submit"
          * (narrowed to submit until 2026-09-03, which was an accessibility
          * regression: Enter stopped activating the Category "Search"
          * button, the editor toolbar, the AI actions and the image
          * remove/reorder controls — every one of which is type="button").
          * Widening it gives nothing away: implicit form submission on Enter
          * is a text-input/select behaviour, so a non-submit button could
          * never have caused the hazard this guard exists for. The
          * submit case stays covered too, as defensive coverage for any
          * future submit button placed inside the <form> (today's Publish
          * lives outside it, reaching in via form="listing-form").
          *
          * The contenteditable exemption is belt-and-braces, not the primary
          * defence: `DescriptionEditor.tsx` already `stopPropagation()`s Enter
          * inside ProseMirror's own keydown hook, so in the normal case this
          * handler never sees the event. It still matters on iOS, where
          * prosemirror-view defers Enter handling to a timeout with a
          * synthetic event and lets the real one through untouched — without
          * this line, that real event would bubble here and get
          * preventDefault()ed, breaking newlines in the editor on iPad.
          * A contenteditable is not a form control, so it cannot trigger
          * implicit submission itself — exempting it gives nothing away. */}
        <form
          id={FORM_ID}
          onSubmit={handlePublish}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            const target = e.target as HTMLElement;
            if (target.tagName === "TEXTAREA") return;
            if (target.isContentEditable) return;
            if (target.tagName === "BUTTON") return;
            e.preventDefault();
          }}
          className="space-y-6"
        >
          <Section
            title="Item"
            description="Where this listing comes from, what it is, and what buyers will see."
          >
            <SourceStep draft={draft} setDraft={setDraft} />

            <Field label="Title" required>
              <Input
                required
                value={draft.title}
                onChange={(e) => setDraft({ title: e.target.value })}
                placeholder="e.g. Wireless Mouse, 2.4GHz, Black"
                maxLength={80}
              />
              <p className="mt-1 text-xs text-(--color-text-faint)">
                {draft.title.length} / 80 characters
              </p>
            </Field>

            <Field label="Description">
              <DescriptionEditor
                value={draft.description}
                onChange={(description) => setDraft({ description })}
                draft={draft}
                aiVisible={aiVisible}
                onAiUsed={() => setAiUsageToken((n) => n + 1)}
              />
              <AiUsageNote refreshToken={aiUsageToken} />
            </Field>

            <ImageGrid
              draft={draft}
              setDraft={setDraft}
              draftId={existingRow?.id ?? null}
              onDraftCreated={handleDraftCreated}
              onBusyChange={setImagesUploading}
            />
          </Section>

          <Section
            title="Listing"
            description="Category, item specifics and condition."
          >
            <CategoryStep draft={draft} setDraft={setDraft} />
            <AspectsStep
              draft={draft}
              setDraft={setDraft}
              aiVisible={aiVisible}
              onAiUsed={() => setAiUsageToken((n) => n + 1)}
            />

            <Field label="Condition" required>
              <Select
                required
                value={draft.condition}
                onChange={(e) =>
                  setDraft({ condition: e.target.value as DraftFormState["condition"] })
                }
              >
                <option value="new">New</option>
                <option value="used">Used</option>
                <option value="refurbished">Refurbished</option>
              </Select>
            </Field>
          </Section>

          <Section
            title="Pricing"
            description="Price, stock, VAT and the offers buyers see."
          >
            <PricingSection draft={draft} setDraft={setDraft} access={marketingAccess} />
          </Section>

          <Section
            title="Advertising"
            description="Promoted Listings: pay a share of the sale price only when an ad leads to a sale."
          >
            <AdvertisingSection
              draft={draft}
              setDraft={setDraft}
              access={marketingAccess}
              onRetry={reloadCampaigns}
            />
          </Section>

          <Section
            title="Shipping"
            description="The eBay business policies and ship-from location this listing uses."
          >
            <PoliciesStep draft={draft} setDraft={setDraft} />
          </Section>
        </form>

        <aside className="lg:sticky lg:top-6">
          <ListingPreview draft={draft} />
        </aside>
      </div>
      </div>

      {/* Action bar — outside the <form>, which is why Publish carries
        * `form={FORM_ID}`: it still participates in the form's native
        * validation and submit event from here. */}
      <div className="sticky bottom-0 z-10 mt-6 -mx-4 border-t border-(--color-border) bg-(--color-surface) px-4 py-3 sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-end gap-3">
          {blockedReason && (
            <p className="mr-auto text-sm text-(--color-text-muted)">{blockedReason}</p>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveDraft}
            disabled={saving || publishing || imagesUploading}
          >
            {saving ? "Saving…" : "Save Draft"}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={publishing || saving || imagesUploading || !isPublishable}
          >
            {publishing ? "Publishing…" : "Publish to eBay"}
          </Button>
        </div>
      </div>
    </div>
  );
}
