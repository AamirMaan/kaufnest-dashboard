/**
 * Pure validation helpers for settings-form fields.
 * All functions return null when the value is valid (or empty/blank — fields
 * are optional), and a human-readable error string when the value is present
 * but malformed.
 */

/**
 * Validates an IBAN.
 * Strips spaces before checking.
 * Pattern: two uppercase letters, two digits, then 11–30 alphanumeric chars.
 */
export function validateIBAN(value: string): string | null {
  const stripped = value.replace(/\s/g, "");
  if (!stripped) return null;
  return /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(stripped)
    ? null
    : "Invalid IBAN format";
}

/**
 * Validates a VAT ID (permissive multi-country format).
 * Strips spaces before checking.
 * Pattern: two uppercase letters followed by 2–13 alphanumeric chars.
 */
export function validateVATId(value: string): string | null {
  const stripped = value.replace(/\s/g, "");
  if (!stripped) return null;
  return /^[A-Z]{2}[A-Z0-9]{2,13}$/.test(stripped)
    ? null
    : "Invalid VAT ID format";
}

/**
 * Validates an email address (standard format check).
 */
export function validateEmail(value: string): string | null {
  if (!value.trim()) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
    ? null
    : "Invalid email address";
}

/**
 * Validates a VAT rate.
 * Coerces the value to a number. Must be in the range 0–100 inclusive.
 */
export function validateVATRate(value: number | string): string | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  if (isNaN(n)) return "VAT rate must be between 0 and 100";
  return n >= 0 && n <= 100 ? null : "VAT rate must be between 0 and 100";
}
