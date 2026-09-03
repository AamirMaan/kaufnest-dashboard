// src/app/dashboard/listings/_components/ImageGrid.tsx
"use client";

import { useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { GripVertical, ImageIcon, Loader2, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES, compressImage } from "../_lib/imageResize";
import { LISTING_IMAGES_BUCKET, buildImagePath, pathFromPublicUrl } from "../_lib/storagePath";
import { MAX_LISTING_IMAGES, type DraftFormState } from "../_lib/wizardValidation";

interface Props {
  draft: DraftFormState;
  setDraft: (patch: Partial<DraftFormState>) => void;
  /** The saved draft row's id, or null for a never-saved new draft. In that
   * case `onDraftCreated` is awaited on the first upload so the files still
   * land under a real draft folder — there is no "unsaved" folder any more. */
  draftId: string | null;
  /** Creates the draft row and resolves with its id. Only called when
   * `draftId` is null and the user picks at least one valid file. */
  onDraftCreated: () => Promise<string>;
  /** Mirrors the internal `uploading` flag out to the parent so Save Draft
   * and Publish can disable while files are still in flight. Without it a
   * save persists `image_urls` from before the uploads finished: the new URLs
   * exist only in local React state and are lost — and their objects
   * orphaned in Storage — as soon as the seller navigates away. */
  onBusyChange?: (busy: boolean) => void;
}

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

function isAllowedType(type: string): boolean {
  return (ALLOWED_IMAGE_TYPES as readonly string[]).includes(type);
}

function SortableImage({
  url,
  index,
  disabled,
  onRemove,
}: {
  url: string;
  index: number;
  disabled: boolean;
  onRemove: (url: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: url, disabled });

  const style: CSSProperties = {
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-(--radius-card) border border-(--color-border) bg-(--color-surface) p-1 ${
        isDragging ? "z-10 opacity-80 shadow-lg" : ""
      }`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={index === 0 ? "Gallery image" : `Listing image ${index + 1}`}
        className="aspect-square w-full rounded object-cover"
      />

      {index === 0 && (
        <span className="absolute left-2 top-2 rounded-(--radius-btn) bg-(--color-primary) px-1.5 py-0.5 text-[10px] font-semibold text-white">
          Gallery image
        </span>
      )}

      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Reorder image ${index + 1}`}
        className="absolute bottom-2 left-2 rounded-(--radius-btn) bg-(--color-surface)/90 border border-(--color-border) p-1 text-(--color-text-muted) cursor-grab active:cursor-grabbing disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <GripVertical size={14} />
      </button>

      <button
        type="button"
        onClick={() => onRemove(url)}
        disabled={disabled}
        aria-label={`Remove image ${index + 1}`}
        className="absolute -top-1.5 -right-1.5 rounded-full bg-(--color-danger-text) text-white p-0.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function ImageGrid({
  draft,
  setDraft,
  draftId,
  onDraftCreated,
  onBusyChange,
}: Props) {
  const [uploading, setUploading] = useState(false);

  /** Number of storage deletes still in flight. Removal itself is optimistic
   * (the tile is gone immediately, per the "cleanup must never block the
   * seller" rule), so this is what keeps the UI from looking idle while the
   * object is actually being deleted. */
  const [cleaningUp, setCleaningUp] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);

  /* Single funnel for the uploading flag: every write goes through here so
   * the parent's mirror can never drift out of sync with local state. Do not
   * call `setUploading` directly. */
  function setUploadingState(next: boolean) {
    setUploading(next);
    onBusyChange?.(next);
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const picked = Array.from(files);
    const failures: string[] = [];

    // One bad file must never abort the rest of the batch — collect the
    // failures, upload everything that passed.
    const valid = picked.filter((file) => {
      if (!isAllowedType(file.type)) {
        failures.push(`${file.name}: only JPEG, PNG and WebP images can be uploaded.`);
        return false;
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        failures.push(`${file.name}: larger than ${MAX_UPLOAD_MB} MB.`);
        return false;
      }
      return true;
    });

    const remainingSlots = MAX_LISTING_IMAGES - draft.image_urls.length;
    const accepted = valid.slice(0, Math.max(0, remainingSlots));
    if (valid.length > accepted.length) {
      failures.push(
        `eBay allows at most ${MAX_LISTING_IMAGES} images per listing — ${
          valid.length - accepted.length
        } file(s) were not uploaded.`
      );
    }

    if (accepted.length === 0) {
      setErrors(failures);
      return;
    }

    setUploadingState(true);
    setErrors([...failures]);
    try {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const tenantSchema = session?.user.app_metadata?.tenant_schema as string | undefined;
      if (!tenantSchema) {
        // Never fall back to "public": that path fails the bucket's RLS check
        // anyway and would silently scatter objects outside the tenant folder.
        setErrors([...failures, "Your workspace could not be identified. Sign out and back in."]);
        return;
      }

      // Lazy draft creation: images need a real draft id to upload under.
      const targetDraftId = draftId ?? (await onDraftCreated());
      if (!targetDraftId) throw new Error("Could not create the draft to attach images to.");

      const uploadedUrls: string[] = [];
      for (const file of accepted) {
        try {
          const blob = await compressImage(file);
          const path = buildImagePath(tenantSchema, targetDraftId, file.name);
          const { error: uploadError } = await supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .upload(path, blob, { contentType: "image/jpeg" });
          if (uploadError) throw uploadError;

          const { data: publicUrl } = supabase.storage
            .from(LISTING_IMAGES_BUCKET)
            .getPublicUrl(path);
          uploadedUrls.push(publicUrl.publicUrl);
        } catch (err) {
          failures.push(
            `${file.name}: ${err instanceof Error ? err.message : "upload failed"}`
          );
        }
      }

      if (uploadedUrls.length > 0) {
        setDraft({ image_urls: [...draft.image_urls, ...uploadedUrls] });
      }
      setErrors([...failures]);
    } catch (err) {
      setErrors([...failures, err instanceof Error ? err.message : "Upload failed"]);
    } finally {
      setUploadingState(false);
    }
  }

  async function removeImage(url: string) {
    setDraft({ image_urls: draft.image_urls.filter((u) => u !== url) });

    // Imported eBay listings hold eBay CDN URLs — pathFromPublicUrl returns
    // null for those and we must not attempt a delete.
    const path = pathFromPublicUrl(url);
    if (!path) return;

    setCleaningUp((n) => n + 1);
    try {
      const { error } = await createClient()
        .storage.from(LISTING_IMAGES_BUCKET)
        .remove([path]);
      // A failed cleanup must never block the seller — the row is already updated.
      if (error) console.warn("Failed to delete listing image", path, error);
    } finally {
      setCleaningUp((n) => n - 1);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = draft.image_urls.indexOf(String(active.id));
    const newIndex = draft.image_urls.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    setDraft({ image_urls: arrayMove(draft.image_urls, oldIndex, newIndex) });
  }

  const atCap = draft.image_urls.length >= MAX_LISTING_IMAGES;

  return (
    <div className="space-y-4">
      <label
        className={`flex flex-col items-center justify-center gap-2 rounded-(--radius-card) border-2 border-dashed border-(--color-border) p-8 text-center transition-colors ${
          uploading || atCap
            ? "opacity-60 cursor-not-allowed"
            : "cursor-pointer hover:border-(--color-primary)"
        }`}
      >
        {uploading ? (
          <Loader2 size={20} className="animate-spin text-(--color-text-faint)" />
        ) : (
          <Upload size={20} className="text-(--color-text-faint)" />
        )}
        <span className="text-sm text-(--color-text-muted)">
          {uploading
            ? "Uploading…"
            : atCap
              ? `Maximum of ${MAX_LISTING_IMAGES} images reached`
              : "Click to upload images"}
        </span>
        <span className="text-xs text-(--color-text-faint)">
          JPEG, PNG or WebP · up to {MAX_UPLOAD_MB} MB each · resized before upload
        </span>
        <input
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          multiple
          className="hidden"
          disabled={uploading || atCap}
          onChange={(e) => {
            handleFiles(e.target.files);
            // Let the same file be re-picked after a failure.
            e.target.value = "";
          }}
        />
      </label>

      {errors.length > 0 && (
        <ul className="space-y-1 text-sm text-(--color-danger-text)">
          {errors.map((message, i) => (
            <li key={`${i}-${message}`}>{message}</li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2 text-xs text-(--color-text-faint)">
        <ImageIcon size={14} />
        {draft.image_urls.length === 0 ? (
          <span>At least one image is required.</span>
        ) : (
          <span>Drag to reorder — the first image is eBay&apos;s search thumbnail.</span>
        )}
        <span className="ml-auto">
          {draft.image_urls.length} / {MAX_LISTING_IMAGES}
        </span>
      </div>

      {cleaningUp > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-(--color-text-faint)">
          <Loader2 size={12} className="animate-spin" />
          Removing image…
        </p>
      )}

      {draft.image_urls.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={draft.image_urls} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {draft.image_urls.map((url, index) => (
                <SortableImage
                  key={url}
                  url={url}
                  index={index}
                  disabled={uploading}
                  onRemove={removeImage}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
