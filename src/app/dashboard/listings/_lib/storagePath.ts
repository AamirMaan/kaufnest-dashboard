export const LISTING_IMAGES_BUCKET = "listing-images";

/**
 * Object path for a listing image: `{tenant_schema}/{draftId}/{uuid}.{ext}`.
 *
 * The tenant-schema prefix is load-bearing — the bucket's write/delete RLS
 * policies (022_listing_images_bucket.sql) compare
 * `(storage.foldername(name))[1]` against the caller's JWT tenant_schema
 * claim. The user's filename is discarded entirely: it can contain spaces,
 * unicode and slashes, and two files picked in the same millisecond used to
 * collide under the old `Date.now()-name` scheme.
 */
export function buildImagePath(
  tenantSchema: string,
  draftId: string,
  fileName: string
): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = match ? match[1].toLowerCase() : "jpg";
  return `${tenantSchema}/${draftId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * Object path for a URL that points into our own bucket, or `null` for any
 * other URL.
 *
 * Returning null is the important half. Listings imported from eBay hold
 * eBay CDN URLs (i.ebayimg.com); a caller that treated those as our paths
 * would issue storage deletes against images this app does not own. Callers
 * must treat null as "remove from the array only, delete nothing".
 */
export function pathFromPublicUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const marker = `/storage/v1/object/public/${LISTING_IMAGES_BUCKET}/`;
  const index = parsed.pathname.indexOf(marker);
  if (index === -1) return null;

  const path = parsed.pathname.slice(index + marker.length);
  return path.length > 0 ? decodeURIComponent(path) : null;
}
