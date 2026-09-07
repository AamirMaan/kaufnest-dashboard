import type { Sale, CompanyProfile } from "@/types";
import { addressFromCompanyProfile, addressFromSale } from "./addressMappers";
import type { EasyPostAddress } from "./easypost";

// jsPDF is loaded dynamically to avoid SSR issues — same pattern as
// src/lib/utils/generateInvoice.ts.
const getJsPDF = () => import("jspdf").then((m) => m.default);

function addressLines(address: EasyPostAddress): string[] {
  const cityLine = [address.city, [address.state, address.zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [address.name, address.street1, address.street2, cityLine, address.country, address.phone].filter(
    (line): line is string => !!line
  );
}

/**
 * Generates a plain, no-cost shipping label PDF (sender/receiver info
 * only — no tracking number, carrier, or rate) and triggers a browser
 * download. This is the default label-generation path while a tenant's
 * `shipping_labels_enabled` flag is off — see
 * docs/superpowers/specs/2026-09-07-shipping-label-gating-and-detail-layout-design.md.
 *
 * Throws if either address is incomplete (via the shared
 * `addressFromCompanyProfile`/`addressFromSale` mappers' own
 * throw-on-missing-field checks) — callers must only invoke this once both
 * addresses are known complete (see `[id]/page.tsx`'s `addressesComplete`).
 */
export async function generatePlainShippingLabel(
  sale: Sale,
  companyProfile: CompanyProfile
): Promise<void> {
  const fromAddress = addressFromCompanyProfile(companyProfile);
  const toAddress = addressFromSale(sale);

  const jsPDF = await getJsPDF();
  const doc = new jsPDF();
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Outer label border
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.5);
  doc.rect(10, 10, pageW - 20, pageH - 20);

  // ── Ship From (small, top) ────────────────────────────────────────────
  let y = 22;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("SHIP FROM", 18, y);
  y += 6;
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(30, 30, 30);
  addressLines(fromAddress).forEach((line) => {
    doc.text(line, 18, y);
    y += 5;
  });

  // Divider
  y += 8;
  doc.setDrawColor(200, 200, 200);
  doc.line(18, y, pageW - 18, y);
  y += 14;

  // ── Ship To (large, prominent) ──────────────────────────────────────────
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(90, 90, 90);
  doc.text("SHIP TO", 18, y);
  y += 10;
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(20, 20, 20);
  addressLines(toAddress).forEach((line) => {
    doc.text(line, 18, y);
    y += 9;
  });

  // ── Footer: order reference ─────────────────────────────────────────────
  doc.setDrawColor(200, 200, 200);
  doc.line(18, pageH - 24, pageW - 18, pageH - 24);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);
  doc.text(`Order: ${sale.external_order_id ?? sale.id}   ·   ${sale.product_name}`, 18, pageH - 16);

  doc.save(`shipping-label-${sale.id.slice(0, 8)}.pdf`);
}
