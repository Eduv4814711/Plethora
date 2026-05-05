import { z } from "zod";
import { prisma } from "./prisma.js";

export const PREFIX_RE = /^[A-Z0-9]{2,10}$/i;

/** Stored under `Company.settings.academy`; defaults match legacy hardcoded behaviour. */
export const DEFAULT_ACADEMY_COMPANY_SETTINGS = {
  studentNumberPrefix: "STU",
  invoiceNumberPrefix: "INV",
  receiptNumberPrefix: "REC",
  certificateNumberPrefix: "CERT",
  renewalRedWithinDays: 14,
  renewalAmberWithinDays: 45,
} as const;

export type AcademyCompanySettings = {
  studentNumberPrefix: string;
  invoiceNumberPrefix: string;
  receiptNumberPrefix: string;
  certificateNumberPrefix: string;
  renewalRedWithinDays: number;
  renewalAmberWithinDays: number;
};

const prefixField = z
  .string()
  .min(2)
  .max(10)
  .regex(PREFIX_RE, "Use 2–10 letters or numbers only");

/** Partial update payload for PUT /settings (businessSettings.academy). */
export const academyCompanySettingsPatchSchema = z.object({
  studentNumberPrefix: prefixField.optional(),
  invoiceNumberPrefix: prefixField.optional(),
  receiptNumberPrefix: prefixField.optional(),
  certificateNumberPrefix: prefixField.optional(),
  renewalRedWithinDays: z.number().int().min(0).max(3650).optional(),
  renewalAmberWithinDays: z.number().int().min(0).max(3650).optional(),
});

export type AcademyCompanySettingsPatch = z.infer<typeof academyCompanySettingsPatchSchema>;

function normalizePrefix(raw: unknown, fallback: string): string {
  if (typeof raw !== "string" || !PREFIX_RE.test(raw.trim())) return fallback;
  return raw.trim().toUpperCase();
}

function normalizeInt(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return fallback;
  return Math.min(max, Math.max(min, raw));
}

/**
 * Parses `Company.settings.academy` JSON into fully resolved defaults.
 */
export function resolveAcademyCompanySettings(academyRaw: unknown): AcademyCompanySettings {
  const o = academyRaw && typeof academyRaw === "object" ? (academyRaw as Record<string, unknown>) : {};
  const d = DEFAULT_ACADEMY_COMPANY_SETTINGS;
  return {
    studentNumberPrefix: normalizePrefix(o.studentNumberPrefix, d.studentNumberPrefix),
    invoiceNumberPrefix: normalizePrefix(o.invoiceNumberPrefix, d.invoiceNumberPrefix),
    receiptNumberPrefix: normalizePrefix(o.receiptNumberPrefix, d.receiptNumberPrefix),
    certificateNumberPrefix: normalizePrefix(o.certificateNumberPrefix, d.certificateNumberPrefix),
    renewalRedWithinDays: normalizeInt(o.renewalRedWithinDays, d.renewalRedWithinDays, 0, 3650),
    renewalAmberWithinDays: normalizeInt(o.renewalAmberWithinDays, d.renewalAmberWithinDays, 0, 3650),
  };
}

/**
 * Applies a validated patch onto existing stored academy JSON; uppercases prefixes.
 */
export function mergeAcademyCompanySettingsPatch(
  existingAcademyRaw: unknown,
  patch: AcademyCompanySettingsPatch
): AcademyCompanySettings {
  const prev = resolveAcademyCompanySettings(existingAcademyRaw);
  const next: AcademyCompanySettings = { ...prev };
  if (patch.studentNumberPrefix !== undefined) next.studentNumberPrefix = patch.studentNumberPrefix.toUpperCase();
  if (patch.invoiceNumberPrefix !== undefined) next.invoiceNumberPrefix = patch.invoiceNumberPrefix.toUpperCase();
  if (patch.receiptNumberPrefix !== undefined) next.receiptNumberPrefix = patch.receiptNumberPrefix.toUpperCase();
  if (patch.certificateNumberPrefix !== undefined) {
    next.certificateNumberPrefix = patch.certificateNumberPrefix.toUpperCase();
  }
  if (patch.renewalRedWithinDays !== undefined) next.renewalRedWithinDays = patch.renewalRedWithinDays;
  if (patch.renewalAmberWithinDays !== undefined) next.renewalAmberWithinDays = patch.renewalAmberWithinDays;
  if (next.renewalRedWithinDays > next.renewalAmberWithinDays) {
    throw new Error("Renewal \"red\" days must be less than or equal to \"amber\" days");
  }
  return next;
}

export async function getResolvedAcademyCompanySettings(
  companyId: string
): Promise<AcademyCompanySettings> {
  const row = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const root = row?.settings as Record<string, unknown> | null | undefined;
  const academy = root?.academy;
  return resolveAcademyCompanySettings(academy);
}
