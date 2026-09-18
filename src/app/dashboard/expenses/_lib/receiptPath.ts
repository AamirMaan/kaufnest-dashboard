export const EXPENSE_RECEIPTS_BUCKET = "expense-receipts";

/**
 * Object path for an expense receipt: `{tenant_schema}/{expenseId}/{uuid}.{ext}`.
 *
 * Mirrors `listings/_lib/storagePath.ts`'s `buildImagePath` — the
 * tenant-schema prefix is load-bearing (`046_expense_receipts.sql`'s RLS
 * policies compare `(storage.foldername(name))[1]` against the caller's JWT
 * tenant_schema claim), and the user's filename is discarded entirely: it
 * can contain spaces, unicode and slashes, and two files picked in the same
 * millisecond would otherwise collide.
 */
export function buildReceiptPath(
  tenantSchema: string,
  expenseId: string,
  fileName: string
): string {
  const match = /\.([a-zA-Z0-9]+)$/.exec(fileName);
  const ext = match ? match[1].toLowerCase() : "jpg";
  return `${tenantSchema}/${expenseId}/${crypto.randomUUID()}.${ext}`;
}

/**
 * The storage path for a stored receipt record, or `null` if it doesn't
 * belong to the caller's own tenant.
 *
 * Receipt entries store a bare path, not a URL (the bucket is private, so
 * there's no public URL to store) — but the `receipts` array is still
 * ordinary jsonb a client could in principle send a tampered value for.
 * Requiring the path to start with the caller's own tenant-schema prefix
 * before it's ever handed to a Storage delete/sign call is defence in
 * depth, mirroring `pathFromPublicUrl`'s host check in the listings sibling
 * (adapted for a bare path instead of a full URL).
 */
export function pathFromStoredReceipt(
  receipt: { path: string },
  tenantSchema: string
): string | null {
  const prefix = `${tenantSchema}/`;
  if (!receipt.path.startsWith(prefix)) return null;
  return receipt.path;
}
