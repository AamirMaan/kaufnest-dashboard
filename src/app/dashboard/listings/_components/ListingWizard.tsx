// src/app/dashboard/listings/_components/ListingWizard.tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
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
  type DraftFormState,
} from "../_lib/wizardValidation";
import { SourceStep } from "./SourceStep";
import { DetailsStep } from "./DetailsStep";
import { CategoryStep } from "./CategoryStep";
import { ImagesStep } from "./ImagesStep";
import { AspectsStep } from "./AspectsStep";
import { PoliciesStep } from "./PoliciesStep";
import { ReviewStep } from "./ReviewStep";
import type { EbayListingDraft } from "@/types";

const STEPS = ["source", "details", "category", "aspects", "images", "policies", "review"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  source: "Source",
  details: "Details",
  category: "Category",
  aspects: "Item Specifics",
  images: "Images",
  policies: "Policies",
  review: "Review",
};

const VALIDATORS: Record<Exclude<Step, "review">, (draft: DraftFormState) => string | null> = {
  source: validateSourceStep,
  details: validateDetailsStep,
  category: validateCategoryStep,
  aspects: validateAspectsStep,
  images: validateImagesStep,
  policies: validatePoliciesStep,
};

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
};

function toFormState(row: EbayListingDraft): DraftFormState {
  return {
    source_type: row.source_type,
    product_id: row.product_id ?? "",
    source_url: row.source_url ?? "",
    title: row.title,
    description: row.description ?? "",
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
  };
}

interface Props {
  draftId: string | null;
}

export function ListingWizard({ draftId }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const companyCurrency = useAppSelector((s) => s.companyProfile.profile?.currency);

  const [step, setStep] = useState<Step>("source");
  const [draft, setDraftState] = useState<DraftFormState>(
    companyCurrency ? { ...EMPTY_DRAFT, currency: companyCurrency } : EMPTY_DRAFT
  );
  const [existingRow, setExistingRow] = useState<EbayListingDraft | null>(null);
  const [loading, setLoading] = useState(!!draftId);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

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
        // via Sync) — the wizard/Inventory API flow must never touch it
        // again. Redirect to the Trading-API live-edit page instead.
        router.push(`/dashboard/listings/${draftId}/live`);
        return;
      }
      if (data.status === "inactive") {
        // Ended on eBay (deleted here, or by eBay/Seller Hub) — there is
        // nothing left to create/publish, and the wizard has no re-publish
        // flow (out of scope for this pass). Only reachable via a direct
        // URL hit or stale bookmark — the Listings table itself never links
        // an inactive row anywhere (see ListingsTable.tsx).
        toastError("This listing has already ended on eBay.");
        router.push("/dashboard/listings");
        return;
      }
      setExistingRow(data);
      setDraftState(toFormState(data));
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);

  function setDraft(patch: Partial<DraftFormState>) {
    setDraftState((prev) => ({ ...prev, ...patch }));
  }

  function goNext() {
    if (step === "review") return;
    const validator = VALIDATORS[step];
    const message = validator(draft);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    setStep(STEPS[STEPS.indexOf(step) + 1]);
  }

  function goBack() {
    if (step === "source") return;
    setError(null);
    setStep(STEPS[STEPS.indexOf(step) - 1]);
  }

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
    };
  }

  async function saveDraft(): Promise<EbayListingDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      if (existingRow) {
        const { data, error: updateError } = await supabase
          .from("ebay_listing_drafts")
          .update(toPayload())
          .eq("id", existingRow.id)
          .select()
          .single<EbayListingDraft>();
        if (updateError) throw updateError;
        dispatch(updateListingDraft(data));
        setExistingRow(data);
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

      const { data, error: insertError } = await supabase
        .from("ebay_listing_drafts")
        .insert({ ...toPayload(), created_by: user.id })
        .select()
        .single<EbayListingDraft>();
      if (insertError) throw insertError;
      dispatch(addListingDraft(data));
      setExistingRow(data);
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

  async function handleSaveDraft() {
    const saved = await saveDraft();
    if (saved) {
      success("Draft saved.");
      router.push(`/dashboard/listings/${saved.id}`);
    }
  }

  async function handlePublish() {
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
      dispatch(updateListingDraft(json));
      success("Published to eBay.");
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
    <div>
      <PageHeader
        title={existingRow ? "Edit Listing" : "New Listing"}
        description={`Step ${STEPS.indexOf(step) + 1} of ${STEPS.length}: ${STEP_LABELS[step]}`}
      />

      {error && (
        <div className="mb-4 rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-4 py-3 text-sm text-(--color-danger-text)">
          {error}
        </div>
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6">
        {step === "source" && <SourceStep draft={draft} setDraft={setDraft} />}
        {step === "details" && <DetailsStep draft={draft} setDraft={setDraft} />}
        {step === "category" && <CategoryStep draft={draft} setDraft={setDraft} />}
        {step === "aspects" && <AspectsStep draft={draft} setDraft={setDraft} />}
        {step === "images" && <ImagesStep draft={draft} setDraft={setDraft} draftId={existingRow?.id ?? null} />}
        {step === "policies" && <PoliciesStep draft={draft} setDraft={setDraft} />}
        {step === "review" && <ReviewStep draft={draft} />}

        <div className="mt-6 flex items-center justify-between">
          <Button variant="secondary" onClick={goBack} disabled={step === "source" || saving || publishing}>
            Back
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={handleSaveDraft} disabled={saving || publishing}>
              {saving ? "Saving…" : "Save Draft"}
            </Button>
            {step === "review" ? (
              <Button onClick={handlePublish} disabled={saving || publishing}>
                {publishing ? "Publishing…" : "Publish to eBay"}
              </Button>
            ) : (
              <Button onClick={goNext} disabled={saving || publishing}>
                Next
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
