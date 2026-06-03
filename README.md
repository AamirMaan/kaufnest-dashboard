# KaufNest Dashboard

Business bookkeeping dashboard for multi-platform product sales in Germany.

## Stack

- **Frontend**: Next.js 16 (App Router, TypeScript, Tailwind CSS v4)
- **Backend / Auth / DB**: Supabase (Postgres + built-in Auth)
- **Tests**: Jest + ts-jest
- **Hosting**: Supabase Cloud + Vercel

## Features

- Login with email/password (Supabase Auth)
- Role-based access: `super_admin`, `admin`, `accountant`
- Track sales across Amazon, eBay, Etsy, Shopify, and more
- Track expenses by category (shipping, advertising, tax, etc.)
- Track inventory purchases
- Monthly overview with revenue, expenses, and net profit
- Full audit log of all user actions
- User management (super_admin only)

## Local Development

1. Copy the env example and fill in your Supabase credentials:
   ```bash
   cp .env.local.example .env.local
   ```
2. Run the migration in the Supabase SQL editor:
   `supabase/migrations/001_init.sql`
3. Start the dev server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000)

## Testing

```bash
npm test
```
