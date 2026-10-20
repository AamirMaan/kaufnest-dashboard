import nodemailer, { type Transporter } from "nodemailer";

/**
 * Server-only SMTP transport (Mailgun, same account Supabase auth uses).
 * Never import from a "use client" file. Lazily created and cached per
 * server instance; isSmtpConfigured() lets callers no-op in dev.
 * Deliberately NOT pooled: on serverless (Vercel) a frozen instance keeps a
 * pooled socket that is dead on thaw. One connection per message is fine at
 * dispatch-email volume.
 */
let transporter: Transporter | null = null;

export function isSmtpConfigured(): boolean {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS &&
    process.env.SMTP_FROM
  );
}

function getTransporter(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

export async function sendMail(msg: { to: string; subject: string; html: string; text: string }): Promise<void> {
  await getTransporter().sendMail({ from: process.env.SMTP_FROM, ...msg });
}
