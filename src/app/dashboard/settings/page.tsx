"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea, Row } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { useInvoiceSettings, type InvoiceSettings } from "@/lib/hooks/useInvoiceSettings";
import { generateSalesInvoice } from "@/lib/utils/generateInvoice";
import { FileDown } from "lucide-react";
import type { Sale } from "@/types";

const DEMO_SALE: Sale = {
  id: "demo",
  product_name: "Sample Product",
  platform: "amazon",
  quantity: 2,
  unit_price: 49.99,
  total_amount: 99.98,
  currency: "EUR",
  date: new Date().toISOString().slice(0, 10),
  description: "This is a demo invoice item",
  created_by: "",
  created_at: "",
};

export default function SettingsPage() {
  const { settings, save } = useInvoiceSettings();
  const { success, warning } = useToast();
  const [form, setForm] = useState<InvoiceSettings>(settings);

  function set<K extends keyof InvoiceSettings>(key: K, value: InvoiceSettings[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    save(form);
    success("Settings saved", "Your invoice settings have been updated.");
  }

  async function handleDemoInvoice() {
    if (!form.companyName.trim()) {
      warning("Company name missing", "Add your company name in settings before generating invoices.");
    }
    await generateSalesInvoice([DEMO_SALE], form);
    success("Demo invoice downloaded", "PDF saved to your downloads folder.");
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your company and invoice details"
      />

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-8">
        {/* Company Details */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
            Company Details
          </h2>

          <Field label="Company Name" required>
            <Input
              value={form.companyName}
              onChange={(e) => set("companyName", e.target.value)}
              placeholder="e.g. KaufNest GmbH"
            />
          </Field>

          <Field label="Address">
            <Input
              value={form.companyAddress}
              onChange={(e) => set("companyAddress", e.target.value)}
              placeholder="Street and house number"
            />
          </Field>

          <Row>
            <Field label="ZIP Code">
              <Input
                value={form.zipCode}
                onChange={(e) => set("zipCode", e.target.value)}
                placeholder="10115"
              />
            </Field>
            <Field label="City">
              <Input
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                placeholder="Berlin"
              />
            </Field>
          </Row>

          <Field label="Country">
            <Input
              value={form.country}
              onChange={(e) => set("country", e.target.value)}
              placeholder="Germany"
            />
          </Field>

          <Row>
            <Field label="Phone">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+49 30 123456"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="info@company.com"
              />
            </Field>
          </Row>
        </section>

        {/* Tax Details */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
            Tax &amp; Registration
          </h2>

          <Row>
            <Field label="VAT ID (USt-IdNr.)">
              <Input
                value={form.vatId}
                onChange={(e) => set("vatId", e.target.value)}
                placeholder="DE123456789"
              />
            </Field>
            <Field label="Tax ID (Steuernummer)">
              <Input
                value={form.taxId}
                onChange={(e) => set("taxId", e.target.value)}
                placeholder="123/456/78901"
              />
            </Field>
          </Row>
        </section>

        {/* Banking Details */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
            Banking Details
          </h2>

          <Field label="Bank Name">
            <Input
              value={form.bankName}
              onChange={(e) => set("bankName", e.target.value)}
              placeholder="Deutsche Bank"
            />
          </Field>

          <Row>
            <Field label="IBAN">
              <Input
                value={form.iban}
                onChange={(e) => set("iban", e.target.value)}
                placeholder="DE89 3704 0044 0532 0130 00"
              />
            </Field>
            <Field label="BIC / SWIFT">
              <Input
                value={form.bic}
                onChange={(e) => set("bic", e.target.value)}
                placeholder="DEUTDEDB"
              />
            </Field>
          </Row>
        </section>

        {/* Invoice Defaults */}
        <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
            Invoice Defaults
          </h2>

          <Row>
            <Field label="Invoice Number Prefix">
              <Input
                value={form.invoicePrefix}
                onChange={(e) => set("invoicePrefix", e.target.value)}
                placeholder="INV-"
              />
            </Field>
            <Field label="Payment Terms">
              <Input
                value={form.paymentTerms}
                onChange={(e) => set("paymentTerms", e.target.value)}
                placeholder="30 days"
              />
            </Field>
          </Row>

          <Field label="Footer / Notes">
            <Textarea
              value={form.footerNotes}
              onChange={(e) => set("footerNotes", e.target.value)}
              placeholder="Any notes to appear at the bottom of every invoice…"
            />
          </Field>
        </section>

        {/* Actions */}
        <div className="flex items-center gap-4">
          <Button type="submit">Save Settings</Button>
          <Button type="button" variant="secondary" onClick={handleDemoInvoice}>
            <FileDown size={15} />
            Generate Demo Invoice
          </Button>
        </div>
      </form>
    </div>
  );
}
