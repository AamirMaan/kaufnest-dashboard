-- ============================================================
-- Add invoice/banking/contact fields to company_profile (tenant_kaufnest schema)
-- Run this in the Supabase SQL editor for Project B.
--
-- These columns fold the old localStorage-only "Invoice Settings" (Company
-- Details / Tax & Registration / Banking Details / Invoice Defaults on
-- /dashboard/settings) into the per-tenant company_profile row, so every
-- tenant gets its own values instead of sharing browser localStorage.
--
-- Also baked into provision_tenant_schema() (005_tenant_provisioning.sql), so
-- every NEW tenant gets these columns from the start — this file only needs
-- to run for tenant_kaufnest, which was provisioned before these columns
-- existed.
--
-- All `add column if not exists` with defaults — safe to run against the live
-- schema, existing row remains valid.
-- ============================================================

alter table tenant_kaufnest.company_profile
  add column if not exists tax_id         text,
  add column if not exists phone          text,
  add column if not exists email          text,
  add column if not exists vat_rate       numeric not null default 19,
  add column if not exists bank_name      text,
  add column if not exists iban           text,
  add column if not exists bic            text,
  add column if not exists invoice_prefix text not null default 'INV-',
  add column if not exists payment_terms  text not null default '30 days',
  add column if not exists footer_notes   text;
