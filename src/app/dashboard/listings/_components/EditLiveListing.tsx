"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { DeleteConfirmModal } from "@/components/modals/DeleteConfirmModal";
import { createTenantClient } from "@/lib/supabase/client";
import { writeAuditLog } from "@/lib/utils/audit";
import { useAppDispatch } from "@/store/hooks";
import { addAuditLog } from "@/store/slices/auditLogsSlice";
import { updateListingDraft, removeListingDraft } from "../_store/listingsSlice";
import type { ListingCondition } from "@/types";

interface LiveDetail {
  ebayListingId: string;
  title: string;
  description: string;
  price: number;
  currency: string;
  quantity: number;
  condition: ListingCondition;
  imageUrls: string[];
  categoryId: string;
  categoryName: string;
  aspects: Record<string, string>;
  multiValueAspectNames: string[];
}

interface RequiredAspect {
  name: string;
  values: string[];
  isProductIdentifier: boolean;
}

interface Props {
  draftId: string;
}

export function EditLiveListing({ draftId }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();

  const [detail, setDetail] = useState<LiveDetail | null>(null);
  const [required, setRequired] = useState<RequiredAspect[] | null>(null);
  const [notApplicableText, setNotApplicableText] = useState("Does not apply");
  const [aspects, setAspects] = useState<Record<string, string>>({});
  const [imageUrlsText, setImageUrlsText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    Promise.resolve().then(async () => {
      try {
        const res = await fetch(`/api/listings/${draftId}/ebay-detail`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load listing");
        setDetail(json);
        setAspects(json.aspects);
        setImageUrlsText(json.imageUrls.join("\n"));

        const aspectsRes = await fetch(
          `/api/listings/ebay/aspects?categoryId=${encodeURIComponent(json.categoryId)}`
        );
        const aspectsJson = await aspectsRes.json();
        if (aspectsRes.ok) {
          setRequired(aspectsJson.aspects);
          setNotApplicableText(aspectsJson.notApplicableText);
        } else {
          setRequired([]);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load listing");
      } finally {
        setLoading(false);
      }
    });
  }, [draftId]);

  function setField<K extends keyof LiveDetail>(key: K, value: LiveDetail[K]) {
    setDetail((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleSave() {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const imageUrls = imageUrlsText
        .split("\n")
        .map((url) => url.trim())
        .filter(Boolean);

      const res = await fetch(`/api/listings/${draftId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: detail.title,
          description: detail.description,
          price: detail.price,
          quantity: detail.quantity,
          condition: detail.condition,
          imageUrls,
          aspects,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to save changes");

      dispatch(updateListingDraft(json));

      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "update",
          entityType: "sale",
          entityId: draftId,
          metadata: { title: detail.title, live: true },
        }).then((log) => log && dispatch(addAuditLog(log)));
      }

      success("Listing updated on eBay.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save changes");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(reason: string) {
    try {
      const res = await fetch(`/api/listings/${draftId}/end`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to end listing");

      dispatch(removeListingDraft(draftId));

      const supabase = await createTenantClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await writeAuditLog(supabase, {
          userId: user.id,
          userEmail: user.email ?? "",
          action: "delete",
          entityType: "sale",
          entityId: draftId,
          metadata: { title: detail?.title, reason },
        }).then((log) => log && dispatch(addAuditLog(log)));
      }

      success("Listing ended on eBay.");
      router.push("/dashboard/listings");
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to end listing");
    } finally {
      setDeleteOpen(false);
    }
  }

  if (loading) return <div className="text-sm text-(--color-text-muted)">Loading…</div>;
  if (error && !detail) return <p className="text-sm text-(--color-danger-text)">{error}</p>;
  if (!detail) return null;

  return (
    <div>
      <Link
        href="/dashboard/listings"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-(--color-primary) hover:underline"
      >
        <ArrowLeft size={14} />
        Back to Listings
      </Link>

      <PageHeader title="Edit Listing" description="Changes save directly to your live eBay listing" />

      {error && (
        <div className="mb-4 rounded-(--radius-btn) bg-(--color-danger-bg) border border-red-200 px-4 py-3 text-sm text-(--color-danger-text)">
          {error}
        </div>
      )}

      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-6 space-y-4">
        <Field label="Category">
          <Input value={detail.categoryName || detail.categoryId} disabled />
        </Field>

        <Field label="Title" required>
          <Input value={detail.title} onChange={(e) => setField("title", e.target.value)} />
        </Field>

        <Field label="Description" required>
          <Textarea
            value={detail.description}
            onChange={(e) => setField("description", e.target.value)}
          />
        </Field>

        <Field label="Price" required>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={detail.price}
            onChange={(e) => setField("price", Number(e.target.value))}
          />
        </Field>

        <Field label="Quantity" required>
          <Input
            type="number"
            min="1"
            value={detail.quantity}
            onChange={(e) => setField("quantity", Number(e.target.value))}
          />
        </Field>

        <Field label="Condition" required>
          <Select
            value={detail.condition}
            onChange={(e) => setField("condition", e.target.value as ListingCondition)}
          >
            <option value="new">New</option>
            <option value="used">Used</option>
            <option value="refurbished">Refurbished</option>
          </Select>
        </Field>

        <Field label="Image URLs (one per line)" required>
          <Textarea value={imageUrlsText} onChange={(e) => setImageUrlsText(e.target.value)} />
        </Field>

        {(required ?? []).map((aspect) => {
          const value = aspects[aspect.name] ?? "";
          const isNotApplicable = value === notApplicableText;
          const isMultiValue = detail.multiValueAspectNames.includes(aspect.name);
          const multiValueWarning = isMultiValue && (
            <p className="mt-1.5 text-xs text-(--color-danger-text)">
              eBay has multiple values for this — editing anything on this listing will
              reduce it to just what&apos;s shown here.
            </p>
          );

          if (aspect.isProductIdentifier && aspect.values.length === 0) {
            return (
              <Field key={aspect.name} label={aspect.name} required>
                <Input
                  value={isNotApplicable ? "" : value}
                  disabled={isNotApplicable}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                />
                <label className="mt-1.5 flex items-center gap-2 text-xs text-(--color-text-muted)">
                  <input
                    type="checkbox"
                    checked={isNotApplicable}
                    onChange={(e) =>
                      setAspects((prev) => ({
                        ...prev,
                        [aspect.name]: e.target.checked ? notApplicableText : "",
                      }))
                    }
                  />
                  This product doesn&apos;t have a {aspect.name}
                </label>
                {multiValueWarning}
              </Field>
            );
          }

          return (
            <Field key={aspect.name} label={aspect.name} required>
              {aspect.values.length > 0 ? (
                <Select
                  value={value}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                >
                  <option value="">Select…</option>
                  {aspect.values.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={value}
                  onChange={(e) => setAspects((prev) => ({ ...prev, [aspect.name]: e.target.value }))}
                />
              )}
              {multiValueWarning}
            </Field>
          );
        })}

        <div className="mt-6 flex items-center justify-between">
          <Button type="button" variant="danger" onClick={() => setDeleteOpen(true)}>
            Delete listing
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      <DeleteConfirmModal
        open={deleteOpen}
        title="End this eBay listing?"
        description="This ends the listing on eBay immediately. It cannot be undone — you would need to create a new listing to sell this item again."
        confirmLabel="Delete"
        confirmingLabel="Ending…"
        onConfirm={handleDelete}
        onClose={() => setDeleteOpen(false)}
      />
    </div>
  );
}
