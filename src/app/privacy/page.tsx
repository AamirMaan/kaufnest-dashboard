import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — KaufNest Dashboard",
  description: "How KaufNest Dashboard collects, uses, and protects your data.",
};

export default function PrivacyPolicyPage() {
  return (
    <main className="min-h-screen bg-[var(--color-surface-subtle)]">
      <div className="mx-auto max-w-3xl px-6 py-12 text-[var(--color-text-base)]">
        <Link href="/" className="text-sm font-medium text-[var(--color-primary)] hover:underline">
          ← Back to KaufNest
        </Link>

        <h1 className="mt-6 text-2xl font-bold text-[var(--color-text-strong)]">
          Privacy Policy
        </h1>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">Last updated: June 2026</p>

        <div className="mt-8 space-y-8 text-sm leading-6">
          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">1. Who we are</h2>
            <p className="mt-2">
              KaufNest Dashboard (&quot;KaufNest&quot;, &quot;we&quot;, &quot;us&quot;) is a business
              bookkeeping and operations dashboard for sellers operating across
              multiple sales platforms (eBay, Amazon, Etsy, Shopify, and others).
              This policy explains what data we collect when you and your team use
              KaufNest, why we collect it, and how it is stored and protected.
            </p>
            <p className="mt-2">
              [Legal entity name, registered address, and company registration
              number to be added here before publishing.]
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">2. Data we collect</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>
                <strong>Account data:</strong> name, email address, and role,
                provided when you or your administrator create a user account.
              </li>
              <li>
                <strong>Business records:</strong> sales/orders, expenses,
                purchases, inventory, VAT and invoice details, and audit logs
                that you or your team enter, import, or that are synced
                automatically from a connected sales platform.
              </li>
              <li>
                <strong>Platform integration data:</strong> if you connect an
                eBay or Amazon seller account under{" "}
                <em>Dashboard → Integrations</em>, we store an OAuth access
                token, refresh token, and the seller/account identifier
                returned by that platform, so we can periodically retrieve
                your order data on your behalf. We only request the minimum
                scopes needed to read order information (e.g. eBay&apos;s
                <code className="mx-1 rounded bg-[var(--color-surface)] px-1 py-0.5 text-xs">sell.fulfillment</code>
                scope) — we never request access to your platform account&apos;s
                payment methods, messaging, or listing-management functions.
              </li>
              <li>
                <strong>Billing data:</strong> subscription plan and status.
                Payment card details are collected and processed directly by
                our payment processor (Stripe) — we do not store card numbers.
              </li>
              <li>
                <strong>Technical data:</strong> authentication session
                cookies and a short-lived cookie used to protect the OAuth
                connection flow against cross-site request forgery.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">3. How we use your data</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li>To provide the dashboard&apos;s core functionality: recording, displaying, and reporting on your sales, expenses, purchases, and inventory.</li>
              <li>To automatically retrieve and display order data from eBay/Amazon accounts you choose to connect, and keep that data in sync.</li>
              <li>To generate invoices and financial summaries from the records you store with us.</li>
              <li>To manage your subscription, billing, and account access.</li>
              <li>To maintain an audit trail of changes made within your account, for your own compliance and bookkeeping purposes.</li>
              <li>To secure your account and prevent unauthorized access.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">4. Legal basis for processing</h2>
            <p className="mt-2">
              We process your data under the following legal bases (GDPR Art.
              6): performance of a contract (providing the service you signed
              up for), your consent (where you actively connect a third-party
              platform integration), and our legitimate interest in operating
              and securing the service.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">5. Third-party processors</h2>
            <p className="mt-2">
              We use the following sub-processors to operate KaufNest. Each
              only receives the data necessary to perform its function:
            </p>
            <ul className="mt-2 list-disc space-y-2 pl-5">
              <li><strong>Supabase</strong> — database hosting and authentication.</li>
              <li><strong>Stripe</strong> — subscription billing and payment processing.</li>
              <li><strong>eBay</strong> and <strong>Amazon (via the Selling Partner API)</strong> — only if and when you connect your seller account, to retrieve your order data.</li>
              <li><strong>Vercel</strong> — application hosting and scheduled background jobs.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">6. Data retention</h2>
            <p className="mt-2">
              We retain your account and business data for as long as your
              account is active, and for a reasonable period afterward to
              comply with legal and tax record-keeping obligations. If you
              disconnect an eBay or Amazon integration, we delete the
              associated access and refresh tokens immediately; previously
              synced order records remain part of your business data unless
              you delete them.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">7. Data security</h2>
            <p className="mt-2">
              Data is encrypted in transit (HTTPS/TLS) and at rest. Access to
              platform integration tokens and to other tenants&apos; data is
              restricted at the database level — only administrators of your
              own account can view connection status, and tokens are never
              exposed to the browser.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">8. Your rights</h2>
            <p className="mt-2">
              Subject to applicable law (including the GDPR), you have the
              right to access, correct, export, or delete the personal data we
              hold about you, to withdraw consent for a platform integration
              at any time by disconnecting it in <em>Dashboard → Integrations</em>,
              and to object to or restrict certain processing. To exercise
              these rights, contact us using the details below.
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">9. Contact</h2>
            <p className="mt-2">
              Questions about this policy or your data can be sent to{" "}
              <a className="text-[var(--color-primary)] hover:underline" href="mailto:privacy@kaufnest.example">
                privacy@kaufnest.example
              </a>
              . [Replace with your actual support/privacy contact address.]
            </p>
          </section>

          <section>
            <h2 className="text-base font-semibold text-[var(--color-text-strong)]">10. Changes to this policy</h2>
            <p className="mt-2">
              We may update this policy from time to time. Material changes
              will be communicated to account administrators by email.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
