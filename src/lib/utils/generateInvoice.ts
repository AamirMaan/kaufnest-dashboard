import type { Sale, Expense, Purchase, CompanyProfile } from "@/types";
import { computeOrderInvoiceTotals, computeBulkTotals, invoiceNumberFor } from "./invoiceMath";

// jsPDF + autotable are loaded dynamically to avoid SSR issues
const getJsPDF = () => import("jspdf").then((m) => m.default);
const getAutoTable = () => import("jspdf-autotable").then((m) => m.default);

function generateInvoiceNumber(prefix: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 9000 + 1000);
  return `${prefix || "INV-"}${ym}-${rand}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: currency || "EUR" }).format(amount);
}

function todayFormatted(): string {
  return formatDate(new Date().toISOString().slice(0, 10));
}

// ─── Header + footer helpers ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addHeader(doc: any, settings: CompanyProfile, invoiceNumber: string, title: string, logoDataUrl?: string) {
  const pageW = doc.internal.pageSize.getWidth();

  // Company name (top-left)
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text(settings.name || "Your Company", 14, 22);

  // Company details (top-left, below name)
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  const lines: string[] = [];
  (settings.address ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((l) => lines.push(l));
  if (settings.phone) lines.push(`Phone: ${settings.phone}`);
  if (settings.email) lines.push(`Email: ${settings.email}`);
  if (settings.vat_number) lines.push(`VAT ID: ${settings.vat_number}`);
  if (settings.tax_id) lines.push(`Tax ID: ${settings.tax_id}`);
  lines.forEach((line, i) => doc.text(line, 14, 30 + i * 5));

  // Logo (top-right, 40×20mm) — rendered only when a pre-resolved dataUrl is provided.
  // Callers that need a logo must fetch + base64-encode it before calling addHeader,
  // then pass the result here. generateOrderInvoice does its own fetch; other callers
  // (generateSalesInvoice etc.) may optionally do the same in future.
  if (logoDataUrl) {
    try {
      // Detect format from dataUrl prefix
      let fmt = "JPEG";
      if (logoDataUrl.startsWith("data:image/png")) fmt = "PNG";
      else if (logoDataUrl.startsWith("data:image/webp")) fmt = "WEBP";
      // Top-right: x = pageW - 14 - 40mm width; y = 10; w = 40mm; h = 20mm
      doc.addImage(logoDataUrl, fmt, pageW - 54, 10, 40, 20);
    } catch {
      /* broken dataUrl must never abort PDF generation */
    }
  }

  // Invoice title + number (top-right, below logo area)
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text(title, pageW - 14, 22, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.text(`Invoice #: ${invoiceNumber}`, pageW - 14, 30, { align: "right" });
  doc.text(`Date: ${todayFormatted()}`, pageW - 14, 36, { align: "right" });
  if (settings.payment_terms)
    doc.text(`Payment Terms: ${settings.payment_terms}`, pageW - 14, 42, { align: "right" });

  // Horizontal rule
  const headerBottom = Math.max(30 + lines.length * 5, 46) + 4;
  doc.setDrawColor(220, 220, 220);
  doc.line(14, headerBottom, pageW - 14, headerBottom);

  return headerBottom + 6;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addFooter(doc: any, settings: CompanyProfile) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setDrawColor(220, 220, 220);
  doc.line(14, pageH - 30, pageW - 14, pageH - 30);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);

  const bankParts: string[] = [];
  if (settings.bank_name) bankParts.push(settings.bank_name);
  if (settings.iban) bankParts.push(`IBAN: ${settings.iban}`);
  if (settings.bic) bankParts.push(`BIC: ${settings.bic}`);
  if (bankParts.length)
    doc.text(bankParts.join("  ·  "), pageW / 2, pageH - 23, { align: "center" });

  if (settings.footer_notes)
    doc.text(settings.footer_notes, pageW / 2, pageH - 17, { align: "center" });
}

// ─── Public generate functions ────────────────────────────────────────────────

export async function generateSalesInvoice(sales: Sale[], settings: CompanyProfile) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoice_prefix);

  const startY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");

  const rows = sales.map((s, i) => [
    i + 1,
    formatDate(s.date),
    s.product_name,
    s.platform.charAt(0).toUpperCase() + s.platform.slice(1),
    s.quantity,
    formatMoney(s.unit_price, s.currency),
    formatMoney(s.total_amount, s.currency),
    formatMoney(s.shipping_charged ?? 0, s.currency),
    s.vat_rate != null ? `${s.vat_rate}%\n${formatMoney(s.vat_amount ?? 0, s.currency)}` : "—",
  ]);

  autoTable(doc, {
    startY,
    head: [["#", "Date", "Product", "Platform", "Qty", "Unit Price", "Total", "Shipping", "VAT"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [45, 90, 200], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 249, 255] },
    columnStyles: { 0: { cellWidth: 8 }, 4: { halign: "center" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" }, 8: { halign: "right" } },
  });

  // Totals by currency — group sales, compute via computeBulkTotals
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const salesByCurrency: Record<string, Sale[]> = {};
  sales.forEach((s) => {
    (salesByCurrency[s.currency] ??= []).push(s);
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(salesByCurrency).forEach(([cur, groupSales]) => {
    const totals = computeBulkTotals(groupSales);

    // Subtotal, Shipping, VAT — always printed
    doc.setFont("helvetica", "normal");
    doc.text(`Subtotal (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(totals.subtotal, cur), pageW - 14, ty, { align: "right" });
    ty += 7;

    doc.text(`Shipping (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(totals.shipping, cur), pageW - 14, ty, { align: "right" });
    ty += 7;

    doc.text(`VAT (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(totals.vat, cur), pageW - 14, ty, { align: "right" });
    ty += 7;

    // Bold rule above Grand Total
    doc.setDrawColor(180, 180, 180);
    doc.line(pageW - 80, ty - 2, pageW - 14, ty - 2);
    ty += 2;

    doc.setFont("helvetica", "bold");
    doc.text(`Grand Total (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(totals.grandTotal, cur), pageW - 14, ty, { align: "right" });
    ty += 10;
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_sales.pdf`);
}

export async function generateExpensesInvoice(expenses: Expense[], settings: CompanyProfile) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoice_prefix);

  const startY = addHeader(doc, settings, invoiceNumber, "EXPENSE REPORT");

  const rows = expenses.map((e, i) => [
    i + 1,
    formatDate(e.date),
    e.title,
    e.category.charAt(0).toUpperCase() + e.category.slice(1),
    e.vendor ?? "—",
    formatMoney(e.amount, e.currency),
    e.vat_rate != null ? `${e.vat_rate}%\n${formatMoney(e.vat_amount ?? 0, e.currency)}` : "—",
  ]);

  autoTable(doc, {
    startY,
    head: [["#", "Date", "Title", "Category", "Vendor", "Amount", "VAT"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [200, 50, 50], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [255, 248, 248] },
    columnStyles: { 0: { cellWidth: 8 }, 5: { halign: "right" }, 6: { halign: "right" } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const byCurrency: Record<string, number> = {};
  const vatByCurrency: Record<string, number> = {};
  expenses.forEach((e) => {
    byCurrency[e.currency] = (byCurrency[e.currency] ?? 0) + e.amount;
    vatByCurrency[e.currency] = (vatByCurrency[e.currency] ?? 0) + (e.vat_amount ?? 0);
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(byCurrency).forEach(([cur, total]) => {
    doc.setFont("helvetica", "normal");
    doc.text(`Total (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(total, cur), pageW - 14, ty, { align: "right" });
    ty += 7;

    // VAT — always printed, even when zero
    doc.text(`VAT (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(vatByCurrency[cur] ?? 0, cur), pageW - 14, ty, { align: "right" });
    ty += 7;
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_expenses.pdf`);
}

export async function generatePurchasesInvoice(purchases: Purchase[], settings: CompanyProfile) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoice_prefix);

  const startY = addHeader(doc, settings, invoiceNumber, "PURCHASE REPORT");

  const rows = purchases.map((p, i) => [
    i + 1,
    formatDate(p.date),
    p.product_name,
    p.vendor ?? "—",
    p.quantity,
    formatMoney(p.unit_price, p.currency),
    formatMoney(p.total_amount, p.currency),
    p.vat_rate != null ? `${p.vat_rate}%\n${formatMoney(p.vat_amount ?? 0, p.currency)}` : "—",
  ]);

  autoTable(doc, {
    startY,
    head: [["#", "Date", "Product", "Vendor", "Qty", "Unit Price", "Total", "VAT"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [180, 100, 0], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [255, 252, 240] },
    columnStyles: { 0: { cellWidth: 8 }, 4: { halign: "center" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const byCurrency: Record<string, number> = {};
  const vatByCurrency: Record<string, number> = {};
  purchases.forEach((p) => {
    byCurrency[p.currency] = (byCurrency[p.currency] ?? 0) + p.total_amount;
    vatByCurrency[p.currency] = (vatByCurrency[p.currency] ?? 0) + (p.vat_amount ?? 0);
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(byCurrency).forEach(([cur, total]) => {
    doc.setFont("helvetica", "normal");
    doc.text(`Total (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(total, cur), pageW - 14, ty, { align: "right" });
    ty += 7;

    // VAT — always printed, even when zero
    doc.text(`VAT (${cur}):`, pageW - 80, ty);
    doc.text(formatMoney(vatByCurrency[cur] ?? 0, cur), pageW - 14, ty, { align: "right" });
    ty += 7;
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_purchases.pdf`);
}

export async function generateOrderInvoice(
  sale: Sale,
  settings: CompanyProfile
): Promise<void> {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = invoiceNumberFor(sale, settings.invoice_prefix ?? "");
  const pageW = doc.internal.pageSize.getWidth();

  // ── 1. Resolve logo (async) before calling addHeader ────────────────────
  // addHeader is sync but accepts a pre-resolved logoDataUrl. We fetch here
  // (async) so we can pass the result in. Wrapped in try/catch: a broken URL
  // must never abort PDF generation.
  let logoDataUrl: string | undefined;
  if (settings.logo_url) {
    try {
      const resp = await fetch(settings.logo_url);
      if (!resp.ok) throw new Error("logo fetch failed");
      const blob = await resp.blob();
      logoDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    } catch {
      /* skip logo — a broken URL must never break PDF generation */
    }
  }

  // ── 2. Header (company name, address, contact info, optional logo) ───────
  let curY = addHeader(doc, settings, invoiceNumber, "INVOICE", logoDataUrl);

  // ── 3. Invoice metadata block ────────────────────────────────────────────
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("Invoice Details", 14, curY);
  curY += 6;

  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  const invoiceDate = formatDate(sale.date);
  const generatedDate = todayFormatted();
  [
    [`Invoice number:`, invoiceNumber],
    [`Invoice date:`, invoiceDate],
    [`Generated:`, generatedDate],
  ].forEach(([label, val]) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, 14, curY);
    doc.setFont("helvetica", "normal");
    doc.text(val, 65, curY);
    curY += 5;
  });

  curY += 4;

  // ── 4. Order info block ──────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text("Order Details", 14, curY);
  curY += 6;

  // Build status label — append qualifier for returned/cancelled
  let statusLabel = sale.status;
  if (sale.status === "returned") statusLabel += " (RETURNED)";
  else if (sale.status === "cancelled") statusLabel += " (CANCELLED)";

  doc.setTextColor(60, 60, 60);
  [
    [`Order number:`, sale.external_order_id ?? sale.id],
    [`Platform:`, sale.platform ?? "—"],
    [`Order date:`, formatDate(sale.date)],
    [`Status:`, statusLabel],
  ].forEach(([label, val]) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, 14, curY);
    doc.setFont("helvetica", "normal");
    doc.text(String(val), 65, curY);
    curY += 5;
  });

  curY += 6;

  // ── 5. Line-items table ──────────────────────────────────────────────────
  const itemRow = [
    "1",
    sale.product_name ?? "Order",
    String(sale.quantity ?? 1),
    formatMoney(sale.unit_price ?? sale.total_amount, sale.currency),
    sale.vat_rate != null ? `${sale.vat_rate}%` : "—",
    formatMoney(sale.total_amount, sale.currency),
  ];
  const shippingRow = [
    "—",
    "Shipping",
    "—",
    "—",
    "—",
    formatMoney(sale.shipping_charged ?? 0, sale.currency),
  ];

  autoTable(doc, {
    startY: curY,
    head: [["#", "Description", "Qty", "Unit Price", "VAT Rate", "Line Total"]],
    body: [itemRow, shippingRow],
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [45, 90, 200], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 249, 255] },
    columnStyles: {
      0: { cellWidth: 10, halign: "center" },
      2: { halign: "center" },
      3: { halign: "right" },
      4: { halign: "center" },
      5: { halign: "right" },
    },
  });

  // ── 6. Totals block (right-aligned) ─────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 8;
  const totals = computeOrderInvoiceTotals(sale);
  const vatRate = sale.vat_rate ?? 0;

  const totalsRows: [string, string][] = [
    ["Subtotal (excl. VAT):", formatMoney(totals.net, sale.currency)],
    [`VAT (${vatRate}%):`, formatMoney(totals.vatTotal, sale.currency)],
    ["Shipping (incl.):", formatMoney(totals.shipping, sale.currency)],
  ];

  doc.setFontSize(9);
  let ty = finalY;
  totalsRows.forEach(([label, val]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(label, pageW - 80, ty);
    doc.text(val, pageW - 14, ty, { align: "right" });
    ty += 6;
  });

  // Divider line above Grand Total
  doc.setDrawColor(180, 180, 180);
  doc.line(pageW - 80, ty - 2, pageW - 14, ty - 2);
  ty += 2;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(30, 30, 30);
  doc.text("Grand Total:", pageW - 80, ty);
  doc.text(formatMoney(totals.grandTotal, sale.currency), pageW - 14, ty, { align: "right" });

  // ── 7. Footer ────────────────────────────────────────────────────────────
  addFooter(doc, settings);

  // ── 8. Save ──────────────────────────────────────────────────────────────
  doc.save(`${invoiceNumber}.pdf`);
}
