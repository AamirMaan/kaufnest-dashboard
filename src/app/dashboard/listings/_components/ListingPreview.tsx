"use client";

import { ImageOff } from "lucide-react";
import { formatCurrency } from "@/lib/utils/currency";
import { sanitizeListingHtml } from "@/lib/utils/sanitizeListingHtml";
import { scoreListing } from "../_lib/listingQuality";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
}

const CONDITION_LABELS: Record<DraftFormState["condition"], string> = {
  new: "New",
  used: "Used",
  refurbished: "Refurbished",
};

function scoreBandClasses(score: number): { bar: string; text: string } {
  if (score < 50) return { bar: "bg-(--color-danger)", text: "text-(--color-danger-text)" };
  if (score < 80) return { bar: "bg-(--color-warning)", text: "text-(--color-warning-text)" };
  return { bar: "bg-(--color-success)", text: "text-(--color-success-text)" };
}

export function ListingPreview({ draft }: Props) {
  const price = Number(draft.price) || 0;
  const [mainImage, ...restImages] = draft.image_urls;
  const specifics = Object.entries(draft.aspects).filter(([, v]) => v.trim());
  const { score, checks } = scoreListing(draft);
  const failingChecks = checks.filter((check) => !check.passed);
  const band = scoreBandClasses(score);

  return (
    <div className="space-y-4">
      <p className="text-sm text-(--color-text-muted)">Approximate eBay preview</p>

      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 space-y-4">
        {/* Gallery */}
        <div className="space-y-2">
          {mainImage ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mainImage}
              alt={draft.title || "Listing image"}
              className="w-full max-w-sm aspect-square rounded-(--radius-card) object-cover border border-(--color-border)"
            />
          ) : (
            <div className="w-full max-w-sm aspect-square rounded-(--radius-card) border border-dashed border-(--color-border) flex flex-col items-center justify-center gap-2 text-(--color-text-muted)">
              <ImageOff size={28} />
              <span className="text-xs">No images yet</span>
            </div>
          )}
          {restImages.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {restImages.map((url, index) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url + index}
                  src={url}
                  alt={`Listing image ${index + 2}`}
                  className="h-16 w-16 rounded-(--radius-btn) object-cover border border-(--color-border)"
                />
              ))}
            </div>
          )}
        </div>

        {/* Title / price / condition */}
        <div className="space-y-1">
          {draft.title.trim() ? (
            <h3 className="text-lg font-semibold text-(--color-text-strong)">{draft.title}</h3>
          ) : (
            <h3 className="text-lg font-semibold text-(--color-text-muted) italic">
              Untitled listing
            </h3>
          )}
          <p className="text-xl font-bold text-(--color-text-strong)">
            {formatCurrency(price, draft.currency)}
          </p>
          <p className="text-sm text-(--color-text-muted)">
            Condition: {CONDITION_LABELS[draft.condition]}
          </p>
        </div>

        {/* Item specifics */}
        {specifics.length > 0 && (
          <div className="border-t border-(--color-border-subtle) pt-3">
            <h4 className="text-sm font-semibold text-(--color-text-strong) mb-2">
              Item specifics
            </h4>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-(--color-border-subtle)">
                {specifics.map(([name, value]) => (
                  <tr key={name}>
                    <td className="py-1 pr-4 text-(--color-text-muted) align-top w-1/3">
                      {name}
                    </td>
                    <td className="py-1 text-(--color-text-strong)">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Description */}
        <div className="border-t border-(--color-border-subtle) pt-3">
          <h4 className="text-sm font-semibold text-(--color-text-strong) mb-2">Description</h4>
          {draft.description.trim() ? (
            <div
              className="text-sm text-(--color-text-base) space-y-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: sanitizeListingHtml(draft.description) }}
            />
          ) : (
            <p className="text-sm text-(--color-text-muted) italic">No description yet.</p>
          )}
        </div>
      </div>

      {/* Quality meter */}
      <div className="rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-(--color-text-strong)">Listing quality</h4>
          <span className={`text-sm font-semibold ${band.text}`}>{score}%</span>
        </div>
        <div className="h-2 w-full rounded-full bg-(--color-border-subtle) overflow-hidden">
          <div
            className={`h-full rounded-full ${band.bar}`}
            style={{ width: `${score}%` }}
          />
        </div>
        {failingChecks.length > 0 && (
          <ul className="space-y-2 pt-1">
            {failingChecks.map((check) => (
              <li key={check.id} className="text-sm">
                <span className="font-medium text-(--color-text-strong)">{check.label}</span>
                <p className="text-(--color-text-muted)">{check.hint}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
