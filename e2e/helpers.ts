/** Returns a unique name with the E2E- prefix + timestamp for data hygiene. */
export function e2eName(base: string): string {
  return `E2E-${base}-${Date.now()}`;
}
