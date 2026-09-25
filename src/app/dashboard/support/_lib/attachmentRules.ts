/**
 * Shared by the report modal and the API routes so the two can never disagree
 * about what is acceptable. Deliberately dependency-free: this is the one
 * module in the support feature imported from both the client and the server.
 *
 * The 4 MB total is not arbitrary — Vercel caps a serverless request body at
 * 4.5 MB, and the form posts the files inline as multipart. Raising it means
 * building a chunked upload path, not changing this constant.
 */
export const MAX_FILES = 3;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export interface AttachmentCandidate {
  name: string;
  size: number;
  type: string;
}

/** Returns a user-facing error message, or null when the set is acceptable. */
export function validateAttachments(files: AttachmentCandidate[]): string | null {
  if (files.length > MAX_FILES) {
    return `You can attach at most ${MAX_FILES} screenshots.`;
  }

  const offender = files.find((f) => !ALLOWED_MIME_TYPES.includes(f.type));
  if (offender) {
    return `${offender.name} is not an image. Attach a PNG, JPEG, WebP or GIF.`;
  }

  const total = files.reduce((sum, f) => sum + f.size, 0);
  if (total > MAX_TOTAL_BYTES) {
    const mb = Math.round(MAX_TOTAL_BYTES / (1024 * 1024));
    return `Screenshots total more than ${mb} MB. Attach fewer or smaller images.`;
  }

  return null;
}
