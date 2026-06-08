import type { InvoiceSettings } from "@/lib/hooks/useInvoiceSettings";
import type { Sale, Expense, Purchase } from "@/types";

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
function addHeader(doc: any, settings: InvoiceSettings, invoiceNumber: string, title: string) {
  const pageW = doc.internal.pageSize.getWidth();

  // Company name (top-left)
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text(settings.companyName || "Your Company", 14, 22);

  // Company details (top-left, below name)
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  const lines: string[] = [];
  if (settings.companyAddress) lines.push(settings.companyAddress);
  if (settings.zipCode || settings.city)
    lines.push([settings.zipCode, settings.city].filter(Boolean).join(" "));
  if (settings.country) lines.push(settings.country);
  if (settings.phone) lines.push(`Phone: ${settings.phone}`);
  if (settings.email) lines.push(`Email: ${settings.email}`);
  if (settings.vatId) lines.push(`VAT ID: ${settings.vatId}`);
  if (settings.taxId) lines.push(`Tax ID: ${settings.taxId}`);
  lines.forEach((line, i) => doc.text(line, 14, 30 + i * 5));

  // Invoice title + number (top-right)
  doc.setFontSize(22);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  doc.text(title, pageW - 14, 22, { align: "right" });

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(90, 90, 90);
  doc.text(`Invoice #: ${invoiceNumber}`, pageW - 14, 30, { align: "right" });
  doc.text(`Date: ${todayFormatted()}`, pageW - 14, 36, { align: "right" });
  if (settings.paymentTerms)
    doc.text(`Payment Terms: ${settings.paymentTerms}`, pageW - 14, 42, { align: "right" });

  // Horizontal rule
  const headerBottom = Math.max(30 + lines.length * 5, 46) + 4;
  doc.setDrawColor(220, 220, 220);
  doc.line(14, headerBottom, pageW - 14, headerBottom);

  return headerBottom + 6;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function addFooter(doc: any, settings: InvoiceSettings) {
  const pageH = doc.internal.pageSize.getHeight();
  const pageW = doc.internal.pageSize.getWidth();

  doc.setDrawColor(220, 220, 220);
  doc.line(14, pageH - 30, pageW - 14, pageH - 30);

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(130, 130, 130);

  const bankParts: string[] = [];
  if (settings.bankName) bankParts.push(settings.bankName);
  if (settings.iban) bankParts.push(`IBAN: ${settings.iban}`);
  if (settings.bic) bankParts.push(`BIC: ${settings.bic}`);
  if (bankParts.length)
    doc.text(bankParts.join("  ·  "), pageW / 2, pageH - 23, { align: "center" });

  if (settings.footerNotes)
    doc.text(settings.footerNotes, pageW / 2, pageH - 17, { align: "center" });
}

// ─── Public generate functions ────────────────────────────────────────────────

export async function generateSalesInvoice(sales: Sale[], settings: InvoiceSettings) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoicePrefix);

  const startY = addHeader(doc, settings, invoiceNumber, "SALES INVOICE");

  const rows = sales.map((s, i) => [
    i + 1,
    formatDate(s.date),
    s.product_name,
    s.platform.charAt(0).toUpperCase() + s.platform.slice(1),
    s.quantity,
    formatMoney(s.unit_price, s.currency),
    formatMoney(s.total_amount, s.currency),
    s.vat_rate != null ? `${s.vat_rate}%\n${formatMoney(s.vat_amount ?? 0, s.currency)}` : "—",
  ]);

  autoTable(doc, {
    startY,
    head: [["#", "Date", "Product", "Platform", "Qty", "Unit Price", "Total", "VAT"]],
    body: rows,
    styles: { fontSize: 9, cellPadding: 3 },
    headStyles: { fillColor: [45, 90, 200], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 249, 255] },
    columnStyles: { 0: { cellWidth: 8 }, 4: { halign: "center" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
  });

  // Totals by currency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const finalY = (doc as any).lastAutoTable.finalY + 6;
  const byCurrency: Record<string, number> = {};
  const vatByCurrency: Record<string, number> = {};
  sales.forEach((s) => {
    byCurrency[s.currency] = (byCurrency[s.currency] ?? 0) + s.total_amount;
    if (s.vat_amount) vatByCurrency[s.currency] = (vatByCurrency[s.currency] ?? 0) + s.vat_amount;
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(byCurrency).forEach(([cur, total]) => {
    doc.text(`Total (${cur}): ${formatMoney(total, cur)}`, pageW - 14, ty, { align: "right" });
    ty += 7;
    const vat = vatByCurrency[cur];
    if (vat) {
      doc.text(`VAT (${cur}): ${formatMoney(vat, cur)}`, pageW - 14, ty, { align: "right" });
      ty += 7;
    }
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_sales.pdf`);
}

export async function generateExpensesInvoice(expenses: Expense[], settings: InvoiceSettings) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoicePrefix);

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
    if (e.vat_amount) vatByCurrency[e.currency] = (vatByCurrency[e.currency] ?? 0) + e.vat_amount;
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(byCurrency).forEach(([cur, total]) => {
    doc.text(`Total (${cur}): ${formatMoney(total, cur)}`, pageW - 14, ty, { align: "right" });
    ty += 7;
    const vat = vatByCurrency[cur];
    if (vat) {
      doc.text(`VAT (${cur}): ${formatMoney(vat, cur)}`, pageW - 14, ty, { align: "right" });
      ty += 7;
    }
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_expenses.pdf`);
}

export async function generatePurchasesInvoice(purchases: Purchase[], settings: InvoiceSettings) {
  const jsPDF = await getJsPDF();
  const autoTable = await getAutoTable();
  const doc = new jsPDF();
  const invoiceNumber = generateInvoiceNumber(settings.invoicePrefix);

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
    if (p.vat_amount) vatByCurrency[p.currency] = (vatByCurrency[p.currency] ?? 0) + p.vat_amount;
  });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(30, 30, 30);
  let ty = finalY;
  Object.entries(byCurrency).forEach(([cur, total]) => {
    doc.text(`Total (${cur}): ${formatMoney(total, cur)}`, pageW - 14, ty, { align: "right" });
    ty += 7;
    const vat = vatByCurrency[cur];
    if (vat) {
      doc.text(`VAT (${cur}): ${formatMoney(vat, cur)}`, pageW - 14, ty, { align: "right" });
      ty += 7;
    }
  });

  addFooter(doc, settings);
  doc.save(`${invoiceNumber}_purchases.pdf`);
}
