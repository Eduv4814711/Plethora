import type { Prisma } from "@prisma/client";
import type { BillingPartyDetails } from "./billing-pdf.service.js";

/** The company columns every branded PDF header needs. */
export type BrandingCompanyRow = {
  name: string;
  legalName: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  vatNumber: string | null;
  registrationNumber: string | null;
  logoUrl: string | null;
  settings: Prisma.JsonValue | null;
};

export const BRANDING_COMPANY_SELECT = {
  name: true,
  legalName: true,
  address: true,
  email: true,
  phone: true,
  vatNumber: true,
  registrationNumber: true,
  logoUrl: true,
  settings: true,
} as const;

export function issuerFrom(company: BrandingCompanyRow): BillingPartyDetails {
  return {
    name: company.name,
    legalName: company.legalName,
    address: company.address,
    email: company.email,
    phone: company.phone,
    vatNumber: company.vatNumber,
    registrationNumber: company.registrationNumber,
    logoUrl: company.logoUrl,
  };
}

/** Currency symbol/code from company settings; the templates prefix amounts with it. */
export function currencyFrom(company: Pick<BrandingCompanyRow, "settings">): string {
  const settings = company.settings as { currency?: unknown } | null;
  return typeof settings?.currency === "string" && settings.currency.trim()
    ? settings.currency.trim()
    : "R";
}

/** Filenames end up in a Content-Disposition header — keep them boring. */
export function safeFilenamePart(value: string, fallback: string): string {
  return value.replace(/[^a-zA-Z0-9-_ ]/g, "").trim() || fallback;
}
