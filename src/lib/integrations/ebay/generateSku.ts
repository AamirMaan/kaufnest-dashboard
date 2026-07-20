// Alphanumeric-only, no hyphens or other special characters — this codebase
// has already hit a real eBay account-wide failure (errorId 25707) caused by
// a single invalid SKU among existing listings breaking bulk reads for the
// whole account (see fetchActiveListings in ./listings.ts). Since SKU
// generation is fully under our control here, strict formatting avoids
// re-triggering that class of failure.
const SKU_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_LENGTH = 12;

export function generateListingSku(): string {
  let suffix = "";
  for (let i = 0; i < SUFFIX_LENGTH; i++) {
    suffix += SKU_CHARS[Math.floor(Math.random() * SKU_CHARS.length)];
  }
  return `KN${suffix}`;
}
