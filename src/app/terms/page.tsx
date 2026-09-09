import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms & Conditions — Boughtopia Dashboard",
  description: "The terms that govern your use of Boughtopia Dashboard.",
};

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[var(--color-surface-subtle)]">
      <div className="mx-auto max-w-3xl px-6 py-12 text-[var(--color-text-base)]">
        <Link href="/" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          ← Back to Boughtopia
        </Link>

        <h1 className="mt-6 text-2xl font-bold text-[var(--color-text-strong)]">
          Terms &amp; Conditions
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Last updated: September 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-6">
          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">1. Acceptance of these terms</h2>
            <p className="mt-2">
              These Terms &amp; Conditions (&quot;Terms&quot;) govern your access to and use of
              Boughtopia Dashboard (&quot;Boughtopia&quot;, &quot;we&quot;, &quot;us&quot;), a business
              bookkeeping and operations dashboard for sellers operating across multiple sales
              platforms. By creating an account or using Boughtopia, you agree to be bound by
              these Terms on behalf of yourself and, if applicable, the business or organization
              you represent.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">2. The service</h2>
            <p className="mt-2">
              Boughtopia helps you record, organize, and report on sales, expenses, purchases,
              and inventory, including data you enter manually and data synced automatically
              from platforms you connect (e.g. eBay, Amazon). Boughtopia is a record-keeping and
              reporting tool. It is not an accounting, tax, or legal service, and using it does
              not create an accountant-client, tax-advisor, or legal-advisor relationship between
              you and us.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">3. No tax, accounting, or legal advice</h2>
            <p className="mt-2">
              Boughtopia may display figures such as totals, summaries, VAT amounts, or fields
              labeled in relation to tax, based entirely on the data you or your connected
              platforms provide. These figures are provided for your convenience only and are{" "}
              <strong>not</strong> tax advice, an accounting opinion, or a guarantee of accuracy
              or compliance.
            </p>
            <p className="mt-2">
              You are solely responsible for determining, calculating, collecting, reporting,
              remitting, and paying any taxes, duties, or levies (including but not limited to
              VAT, sales tax, and income tax) that apply to your business, in whatever
              jurisdiction they arise. Boughtopia does not act as your tax agent, does not file
              returns on your behalf, and does not verify that any figure it displays or any
              invoice it generates is correct or compliant with the tax laws applicable to you.
              You should consult a qualified accountant or tax advisor for advice specific to
              your business.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">4. Accuracy of your data</h2>
            <p className="mt-2">
              Boughtopia&apos;s outputs (reports, invoices, summaries, exports) are only as
              accurate as the data entered, imported, or synced into your account. We do not
              independently verify amounts, tax rates, currency conversions, or the correctness
              of data received from a connected third-party platform. You are responsible for
              reviewing and correcting your records before relying on them.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">5. Account and acceptable use</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>You are responsible for the accuracy of the information you provide and for maintaining the confidentiality of your account credentials.</li>
              <li>You are responsible for the actions of any user your organization invites to your account, including the permissions and roles assigned to them.</li>
              <li>You agree not to use Boughtopia for any unlawful purpose or in a way that violates the terms of a platform you connect to it (e.g. eBay, Amazon).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">6. Third-party platforms and integrations</h2>
            <p className="mt-2">
              Connecting a third-party seller account (e.g. eBay, Amazon) is optional and at your
              discretion. We are not responsible for the availability, accuracy, or content of
              data returned by a third-party platform, or for any action that platform takes on
              your account. Your use of a connected platform remains subject to that platform&apos;s
              own terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">7. Subscriptions and billing</h2>
            <p className="mt-2">
              Paid plans are billed in advance on a recurring basis through our payment
              processor, Stripe. Plan changes and cancellations take effect as described at the
              point of purchase or in-app. Fees are non-refundable except where required by law.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">8. Disclaimer of warranties</h2>
            <p className="mt-2">
              Boughtopia is provided &quot;as is&quot; and &quot;as available&quot;, without warranties of any
              kind, whether express or implied, including warranties of merchantability, fitness
              for a particular purpose, accuracy, or non-infringement. We do not warrant that the
              service will be uninterrupted, error-free, or that any calculation, report, or
              figure it produces — including any relating to tax — is accurate or complete.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">9. Limitation of liability</h2>
            <p className="mt-2">
              To the fullest extent permitted by law, Boughtopia and its owners, employees, and
              agents shall not be liable for any indirect, incidental, special, consequential, or
              punitive damages, or for any loss of profits, revenue, data, or business
              opportunity, arising out of or related to your use of the service.
            </p>
            <p className="mt-2">
              Without limiting the foregoing, we are not liable for any taxes, penalties,
              interest, fines, or other liabilities you incur as a result of relying on
              Boughtopia for tax calculation, collection, reporting, or remittance, or as a
              result of errors, omissions, or delays in data synced from a third-party platform.
              Where liability cannot be excluded by law, our total liability to you for any claim
              arising from your use of Boughtopia is limited to the amount you paid us for the
              service in the twelve (12) months preceding the claim.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">10. Indemnification</h2>
            <p className="mt-2">
              You agree to indemnify and hold Boughtopia harmless from any claim, liability, or
              expense (including reasonable legal fees) arising from your use of the service,
              your business records, or your failure to meet any tax, regulatory, or legal
              obligation applicable to your business.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">11. Termination</h2>
            <p className="mt-2">
              You may cancel your subscription at any time. We may suspend or terminate your
              access to Boughtopia if you breach these Terms or fail to pay applicable fees. On
              termination, your right to use the service ends, but this section and the
              disclaimers, liability limits, and indemnification obligations above survive.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">12. Changes to these terms</h2>
            <p className="mt-2">
              We may update these Terms from time to time. Material changes will be communicated
              to account administrators by email. Continued use of Boughtopia after a change
              takes effect constitutes acceptance of the updated Terms.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">13. Contact</h2>
            <p className="mt-2">
              Questions about these Terms can be sent to{" "}
              <a className="text-[var(--color-primary)] hover:underline" href="mailto:support@boughtopia.com">
                support@boughtopia.com
              </a>
              .
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
