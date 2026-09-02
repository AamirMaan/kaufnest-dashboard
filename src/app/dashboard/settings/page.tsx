"use client";

import { useState } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea, Row } from "@/components/ui/FormFields";
import { useToast } from "@/components/ui/Toast";
import { generateSalesInvoice } from "@/lib/utils/generateInvoice";
import { createTenantClient } from "@/lib/supabase/client";
import {
  validateIBAN,
  validateVATId,
  validateEmail,
  validateVATRate,
} from "@/lib/utils/validation";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { hydrateCompanyProfile } from "@/store/slices/companyProfileSlice";
import { hasAiFeatures } from "@/lib/utils/planGating";
import { FileDown } from "lucide-react";
import { BillingSection } from "./_components/BillingSection";
import { AiUsageNote } from "@/components/ui/AiUsageNote";
import type { CompanyProfile, Currency, Sale } from "@/types";

const DEMO_SALE: Sale = {
  id: "demo",
  product_id: null,
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
  vat_rate: 19,
  vat_amount: 15.97,
  shipping_cost: null,
  shipping_charged: null,
  advertising_fee: null,
  platform_fee: null,
  status: "pending",
  restock: false,
  refunded_amount: null,
  external_order_id: null,
};

const COMPANY_PROFILE_ROLES = ["admin", "super_admin"];

export default function SettingsPage() {
  const { success, warning, error: toastError } = useToast();

  const dispatch = useAppDispatch();
  const companyProfile = useAppSelector((s) => s.companyProfile.profile);
  const role = useAppSelector((s) => s.currentUser.profile?.role);
  const canEditCompanyProfile = role ? COMPANY_PROFILE_ROLES.includes(role) : false;
  const tenantPlan = useAppSelector((s) => s.currentUser.tenantPlan);
  const aiEnabled = useAppSelector((s) => s.currentUser.aiEnabled);
  const aiVisible = !!tenantPlan && hasAiFeatures(tenantPlan) && aiEnabled;
  const [companyForm, setCompanyForm] = useState<CompanyProfile | null>(companyProfile);
  const [savingCompanyProfile, setSavingCompanyProfile] = useState(false);

  function setCompany<K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) {
    setCompanyForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function handleCompanyProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!companyForm) return;
    setSavingCompanyProfile(true);

    const supabase = await createTenantClient();
    const { data, error: dbError } = await supabase
      .from("company_profile")
      .upsert({
        id: companyForm.id,
        name: companyForm.name,
        logo_url: companyForm.logo_url,
        vat_number: companyForm.vat_number,
        tax_id: companyForm.tax_id,
        address: companyForm.address,
        phone: companyForm.phone,
        email: companyForm.email,
        currency: companyForm.currency,
        timezone: companyForm.timezone,
        vat_rate: companyForm.vat_rate,
        bank_name: companyForm.bank_name,
        iban: companyForm.iban,
        bic: companyForm.bic,
        invoice_prefix: companyForm.invoice_prefix,
        payment_terms: companyForm.payment_terms,
        footer_notes: companyForm.footer_notes,
      })
      .select()
      .single<CompanyProfile>();

    setSavingCompanyProfile(false);

    if (dbError) {
      toastError("Failed to save company profile", dbError.message);
      return;
    }

    dispatch(hydrateCompanyProfile(data));
    success("Company profile saved", "Your company details have been updated.");
  }

  async function handleDemoInvoice() {
    if (!companyForm) return;
    if (!companyForm.name.trim()) {
      warning("Company name missing", "Add your company name in settings before generating invoices.");
    }
    await generateSalesInvoice([DEMO_SALE], companyForm);
    success("Demo invoice downloaded", "PDF saved to your downloads folder.");
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Configure your company and invoice details"
      />

      <div className="mb-8">
        <BillingSection />
      </div>

      {aiVisible && (
        <section className="max-w-2xl mb-8 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
          <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
            AI usage
          </h2>
          <AiUsageNote />
        </section>
      )}

      {companyForm && (
        <form onSubmit={handleCompanyProfileSubmit} className="max-w-2xl space-y-8">
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Company Profile
            </h2>
            <p className="text-xs text-[var(--color-text-muted)]">
              Shared organization details for your Boughtopia workspace.
              {!canEditCompanyProfile && " Only admins can make changes."}
            </p>

            <Field label="Company Name" required>
              <Input
                value={companyForm.name}
                onChange={(e) => setCompany("name", e.target.value)}
                disabled={!canEditCompanyProfile}
                placeholder="Acme GmbH"
              />
            </Field>

            <Field label="Logo URL">
              <Input
                value={companyForm.logo_url ?? ""}
                onChange={(e) => setCompany("logo_url", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="https://example.com/logo.png"
              />
            </Field>

            <Field label="Address">
              <Textarea
                value={companyForm.address ?? ""}
                onChange={(e) => setCompany("address", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="Street, ZIP, city, country"
              />
            </Field>

            <Row>
              <Field label="Currency">
                <Select
                  value={companyForm.currency}
                  onChange={(e) => setCompany("currency", e.target.value as Currency)}
                  disabled={!canEditCompanyProfile}
                >
                  <option value="EUR">EUR</option>
                  <option value="USD">USD</option>
                  <option value="GBP">GBP</option>
                </Select>
              </Field>
              <Field label="Timezone">
                <Input
                  value={companyForm.timezone}
                  onChange={(e) => setCompany("timezone", e.target.value)}
                  disabled={!canEditCompanyProfile}
                  placeholder="Europe/Berlin"
                />
              </Field>
            </Row>
          </section>

          {/* Contact */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Contact
            </h2>

            <Row>
              <Field label="Phone">
                <Input
                  type="tel"
                  value={companyForm.phone ?? ""}
                  onChange={(e) => setCompany("phone", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="+49 30 123456"
                />
              </Field>
              <Field label="Email">
                <Input
                  type="email"
                  value={companyForm.email ?? ""}
                  onChange={(e) => setCompany("email", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="info@company.com"
                />
                {validateEmail(companyForm.email ?? "") && (
                  <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                    {validateEmail(companyForm.email ?? "")}
                  </p>
                )}
              </Field>
            </Row>
          </section>

          {/* Tax & Registration */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Tax &amp; Registration
            </h2>

            <Row>
              <Field label="VAT Number (USt-IdNr.)">
                <Input
                  value={companyForm.vat_number ?? ""}
                  onChange={(e) => setCompany("vat_number", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="DE123456789"
                />
                {validateVATId(companyForm.vat_number ?? "") && (
                  <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                    {validateVATId(companyForm.vat_number ?? "")}
                  </p>
                )}
              </Field>
              <Field label="Tax ID (Steuernummer)">
                <Input
                  value={companyForm.tax_id ?? ""}
                  onChange={(e) => setCompany("tax_id", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="123/456/78901"
                />
              </Field>
            </Row>

            <Field label="Default VAT Rate (%)">
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={companyForm.vat_rate}
                onChange={(e) => setCompany("vat_rate", parseFloat(e.target.value) || 0)}
                disabled={!canEditCompanyProfile}
                placeholder="19"
              />
              {validateVATRate(companyForm.vat_rate) && (
                <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                  {validateVATRate(companyForm.vat_rate)}
                </p>
              )}
            </Field>
            <p className="text-xs text-[var(--color-text-muted)]">
              Used as the default rate when you mark a purchase, sale, or expense
              as &ldquo;includes VAT&rdquo; — editable per record.
            </p>
          </section>

          {/* Banking Details */}
          <section className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-6 space-y-4">
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">
              Banking Details
            </h2>

            <Field label="Bank Name">
              <Input
                value={companyForm.bank_name ?? ""}
                onChange={(e) => setCompany("bank_name", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="Deutsche Bank"
              />
            </Field>

            <Row>
              <Field label="IBAN">
                <Input
                  value={companyForm.iban ?? ""}
                  onChange={(e) => setCompany("iban", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
                  placeholder="DE89 3704 0044 0532 0130 00"
                />
                {validateIBAN(companyForm.iban ?? "") && (
                  <p className="mt-1 text-xs text-(--color-warning,#f59e0b)">
                    {validateIBAN(companyForm.iban ?? "")}
                  </p>
                )}
              </Field>
              <Field label="BIC / SWIFT">
                <Input
                  value={companyForm.bic ?? ""}
                  onChange={(e) => setCompany("bic", e.target.value || null)}
                  disabled={!canEditCompanyProfile}
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
                  value={companyForm.invoice_prefix}
                  onChange={(e) => setCompany("invoice_prefix", e.target.value)}
                  disabled={!canEditCompanyProfile}
                  placeholder="INV-"
                />
              </Field>
              <Field label="Payment Terms">
                <Input
                  value={companyForm.payment_terms}
                  onChange={(e) => setCompany("payment_terms", e.target.value)}
                  disabled={!canEditCompanyProfile}
                  placeholder="30 days"
                />
              </Field>
            </Row>

            <Field label="Footer / Notes">
              <Textarea
                value={companyForm.footer_notes ?? ""}
                onChange={(e) => setCompany("footer_notes", e.target.value || null)}
                disabled={!canEditCompanyProfile}
                placeholder="Any notes to appear at the bottom of every invoice…"
              />
            </Field>
          </section>

          {/* Actions */}
          <div className="flex items-center gap-4">
            {canEditCompanyProfile && (
              <Button type="submit" disabled={savingCompanyProfile}>
                {savingCompanyProfile ? "Saving…" : "Save Settings"}
              </Button>
            )}
            <Button type="button" variant="secondary" onClick={handleDemoInvoice}>
              <FileDown size={15} />
              Generate Demo Invoice
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
