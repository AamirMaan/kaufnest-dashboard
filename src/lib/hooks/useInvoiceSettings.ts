"use client";

import { useState, useCallback } from "react";

export interface InvoiceSettings {
  companyName: string;
  companyAddress: string;
  city: string;
  zipCode: string;
  country: string;
  phone: string;
  email: string;
  vatId: string;
  taxId: string;
  /** Default VAT rate (%) applied when "includes VAT" is toggled on a record */
  vatRate: number;
  bankName: string;
  iban: string;
  bic: string;
  invoicePrefix: string;
  paymentTerms: string;
  footerNotes: string;
}

export const DEFAULT_INVOICE_SETTINGS: InvoiceSettings = {
  companyName: "",
  companyAddress: "",
  city: "",
  zipCode: "",
  country: "Germany",
  phone: "",
  email: "",
  vatId: "",
  taxId: "",
  vatRate: 19,
  bankName: "",
  iban: "",
  bic: "",
  invoicePrefix: "INV-",
  paymentTerms: "30 days",
  footerNotes: "",
};

const STORAGE_KEY = "kaufnest_invoice_settings";

function loadFromStorage(): InvoiceSettings {
  if (typeof window === "undefined") return DEFAULT_INVOICE_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_INVOICE_SETTINGS;
    return { ...DEFAULT_INVOICE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_INVOICE_SETTINGS;
  }
}

export function useInvoiceSettings() {
  const [settings, setSettings] = useState<InvoiceSettings>(loadFromStorage);

  const save = useCallback((updated: InvoiceSettings) => {
    setSettings(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  return { settings, save };
}

/** Read-only helper for components that only need to read settings once */
export function readInvoiceSettings(): InvoiceSettings {
  return loadFromStorage();
}
