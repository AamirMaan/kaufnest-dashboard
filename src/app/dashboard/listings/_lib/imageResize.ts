/** eBay requires a 500px minimum long edge and renders zoom from ~1600px.
 * Anything larger is bandwidth we pay for twice — once on upload, once when
 * eBay and the vision model fetch it. */
export const MAX_IMAGE_EDGE = 1600;
export const JPEG_QUALITY = 0.85;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/**
 * Scale a width/height pair down so its longest edge is at most `maxEdge`,
 * preserving aspect ratio. Returns whole pixels, never smaller than 1.
 * Pure — the canvas work that uses this lives in `compressImage`.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Browser-only: decode, downscale and re-encode as JPEG. Not unit-tested —
 * canvas and createImageBitmap do not exist in the node test environment.
 * The dimension maths it depends on is tested via `fitWithin`.
 */
export async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_EDGE);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    return file; // no canvas support — upload the original rather than fail
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY)
  );

  return blob ?? file;
}
