"use client";

import { useState } from "react";
import { useAppDispatch } from "@/store/hooks";
import { updateListingSource } from "../_store/dropshippingSlice";
import { detectPlatform } from "@/lib/utils/detectPlatform";
import { Button } from "@/components/ui/Button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/Toast";
import type { DropshipListing } from "@/types";

interface EditSourceModalProps {
  listing: DropshipListing | null;
  onClose: () => void;
}

function PlatformBadge({ url }: { url: string }) {
  const platform = detectPlatform(url);
  if (platform === "amazon") {
    return (
      <span className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">
        Amazon
      </span>
    );
  }
  if (platform === "aliexpress") {
    return (
      <span className="inline-flex items-center rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700">
        AliExpress
      </span>
    );
  }
  if (url.trim() === "") return null;
  return (
    <span className="inline-flex items-center rounded-full bg-[var(--color-surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--color-text-muted)]">
      Unknown
    </span>
  );
}

export function EditSourceModal({ listing, onClose }: EditSourceModalProps) {
  const dispatch = useAppDispatch();
  const { success, error: toastError } = useToast();
  const [url, setUrl] = useState(listing?.source_url ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!listing || url.trim() === "") return;
    setSaving(true);
    try {
      const res = await fetch(`/api/dropshipping/listings/${listing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: url.trim() }),
      });

      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        throw new Error(json.error ?? "Failed to save source URL");
      }

      const updated = (await res.json()) as { source_url: string; source_platform: "amazon" | "aliexpress" | null };
      dispatch(
        updateListingSource({
          id: listing.id,
          sourceUrl: updated.source_url,
          sourcePlatform: updated.source_platform,
        })
      );
      success("Source URL saved.");
      onClose();
    } catch (err) {
      toastError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!listing} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link Source Product</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-[var(--color-text-muted)] truncate">
            {listing?.title}
          </p>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-[var(--color-text-base)]">
              Source product URL
            </label>
            <Input
              type="url"
              placeholder="https://www.amazon.com/dp/... or AliExpress URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              className="w-full"
            />
            <div className="h-5">
              <PlatformBadge url={url} />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={url.trim() === "" || saving}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
