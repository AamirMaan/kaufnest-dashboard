// src/app/dashboard/listings/_components/ImagesStep.tsx
"use client";

import { useState } from "react";
import { X, ImageIcon, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  /** Null until the draft has been saved at least once — images upload under
   * its id, so an unsaved new draft uses a temporary folder that gets
   * orphaned if the user never saves (acceptable v1 tradeoff, cleaned up
   * manually — see Task 18's SKILL.md gotcha). */
  draftId: string | null;
}

export function ImagesStep({ draft, setDraft, draftId }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { data: { session } } = await supabase.auth.getSession();
      const tenantSchema = (session?.user.app_metadata?.tenant_schema as string | undefined) ?? "public";
      const folder = draftId ?? "unsaved";

      const uploadedUrls: string[] = [];
      for (const file of Array.from(files)) {
        const path = `${tenantSchema}/${folder}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("listing-images")
          .upload(path, file);
        if (uploadError) throw uploadError;

        const { data: publicUrl } = supabase.storage.from("listing-images").getPublicUrl(path);
        uploadedUrls.push(publicUrl.publicUrl);
      }

      setDraft({ image_urls: [...draft.image_urls, ...uploadedUrls] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function removeImage(url: string) {
    setDraft({ image_urls: draft.image_urls.filter((u) => u !== url) });
  }

  return (
    <div className="space-y-4">
      <label className="flex flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed border-(--color-border) p-8 text-center cursor-pointer hover:border-(--color-primary) transition-colors">
        <Upload size={20} className="text-(--color-text-faint)" />
        <span className="text-sm text-(--color-text-muted)">
          {uploading ? "Uploading…" : "Click to upload images"}
        </span>
        <input
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          disabled={uploading}
          onChange={(e) => handleFiles(e.target.files)}
        />
      </label>

      {error && <p className="text-sm text-(--color-danger-text)">{error}</p>}

      {draft.image_urls.length > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {draft.image_urls.map((url) => (
            <div key={url} className="relative group">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt="" className="h-20 w-20 rounded object-cover" />
              <button
                type="button"
                onClick={() => removeImage(url)}
                className="absolute -top-1.5 -right-1.5 rounded-full bg-(--color-danger-text) text-white p-0.5"
                aria-label="Remove image"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {draft.image_urls.length === 0 && !uploading && (
        <div className="flex items-center gap-2 text-xs text-(--color-text-faint)">
          <ImageIcon size={14} />
          At least one image is required.
        </div>
      )}
    </div>
  );
}
