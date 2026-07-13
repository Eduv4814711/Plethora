import { parse } from "csv-parse/sync";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

// --- Limits (configurable) ---
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_EMPLOYEES = 1000;
const MAX_SITES = 200;
const MAX_GROUPS = 500;
const MAX_COMPANIES = 50;

/** Large CSV imports (many employees) can exceed default interactive transaction limits on hosted DBs. */
const MIGRATION_TRANSACTION_OPTIONS = { maxWait: 30_000, timeout: 300_000 } as const;

// --- Helpers ---
function sanitizeDate(v: string | undefined): Date | undefined {
  if (!v || !String(v).trim()) return undefined;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return undefined;
  return d;
}

function parseOptionalNumber(v: string | undefined): number | undefined {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? undefined : n;
}

function parseOptionalBool(v: string | undefined): boolean | undefined {
  if (v === undefined || v === null || String(v).trim() === "") return undefined;
  const s = String(v).toLowerCase();
  if (["true", "1", "yes", "y"].includes(s)) return true;
  if (["false", "0", "no", "n"].includes(s)) return false;
  return undefined;
}

function emptyToUndefined(s: string | undefined): string | undefined {
  if (s === undefined || s === null || String(s).trim() === "") return undefined;
  return String(s).trim();
}

// --- Zod schemas for CSV rows ---

const companyRowSchema = z.object({
  name: z.string().min(1, "Company name is required"),
  legalName: z.string().optional().transform(emptyToUndefined),
  registrationNumber: z.string().optional().transform(emptyToUndefined),
  taxNumber: z.string().optional().transform(emptyToUndefined),
  address: z.string().optional().transform(emptyToUndefined),
  phone: z.string().optional().transform(emptyToUndefined),
  email: z.union([z.string().email(), z.literal("")]).optional().transform((v) => (v === "" ? undefined : v)),
  website: z.string().optional().transform(emptyToUndefined),
  psiraRegistration: z.string().optional().transform(emptyToUndefined),
  uifReference: z.string().optional().transform(emptyToUndefined),
  currency: z.string().optional().transform(emptyToUndefined),
  timezone: z.string().optional().transform(emptyToUndefined),
  payrollPeriod: z.enum(["weekly", "biweekly", "monthly"]).optional(),
});

const employeeStatusEnum = z.enum(["applicant", "hired", "training", "active", "suspended", "offboarded"]);
const employeeTypeEnum = z.enum(["office", "security"]);

/** CSV row shape (shared by strict and relaxed employee import parsers). */
const employeeRowBaseSchema = z.object({
  companyName: z.string().optional().transform(emptyToUndefined), // Admin flow: links to company
  employeeNumber: z.string().optional().transform(emptyToUndefined),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  idNumber: z.string().optional().transform(emptyToUndefined),
  phone: z.string().optional().transform(emptyToUndefined),
  email: z.string().optional().transform(emptyToUndefined),
  status: employeeStatusEnum.default("applicant"),
  employeeType: employeeTypeEnum.default("security"),
  hourlyRate: z.string().optional().transform((v) => parseOptionalNumber(v)),
  monthlySalary: z.string().optional().transform((v) => parseOptionalNumber(v)),
  jobRole: z.string().optional().transform(emptyToUndefined),
  gradeName: z.string().optional().transform(emptyToUndefined),
  psiraNumber: z.string().optional().transform(emptyToUndefined),
  securityServiceType: z.string().optional().transform(emptyToUndefined),
  dateOfBirth: z.string().optional().transform((v) => sanitizeDate(v)),
  gender: z.string().optional().transform(emptyToUndefined),
  maritalStatus: z.string().optional().transform(emptyToUndefined),
  physicalAddress: z.string().optional().transform(emptyToUndefined),
  postalAddress: z.string().optional().transform(emptyToUndefined),
  postalCode: z.string().optional().transform(emptyToUndefined),
  taxNumber: z.string().optional().transform(emptyToUndefined),
  bankName: z.string().optional().transform(emptyToUndefined),
  bankAccountNumber: z.string().optional().transform(emptyToUndefined),
  bankBranchCode: z.string().optional().transform(emptyToUndefined),
  commencementDate: z.string().optional().transform((v) => sanitizeDate(v)),
  occupation: z.string().optional().transform(emptyToUndefined),
  placeOfWork: z.string().optional().transform(emptyToUndefined),
  ordinaryHours: z.string().optional().transform(emptyToUndefined),
  ordinaryDays: z.string().optional().transform(emptyToUndefined),
  overtimeRate: z.string().optional().transform((v) => parseOptionalNumber(v)),
  payFrequency: z.string().optional().transform(emptyToUndefined),
  leaveEntitlement: z.string().optional().transform(emptyToUndefined),
  noticePeriod: z.string().optional().transform(emptyToUndefined),
  previousService: z.string().optional().transform(emptyToUndefined),
  psiraExpiryDate: z.string().optional().transform((v) => sanitizeDate(v)),
  nextOfKin1Name: z.string().optional().transform(emptyToUndefined),
  nextOfKin1Phone: z.string().optional().transform(emptyToUndefined),
  nextOfKin2Name: z.string().optional().transform(emptyToUndefined),
  nextOfKin2Phone: z.string().optional().transform(emptyToUndefined),
  nextOfKin3Name: z.string().optional().transform(emptyToUndefined),
  nextOfKin3Phone: z.string().optional().transform(emptyToUndefined),
  residedOutsideSA: z.string().optional().transform((v) => parseOptionalBool(v)),
  militaryPoliceService: z.string().optional().transform((v) => parseOptionalBool(v)),
  criminalInvestigation: z.string().optional().transform((v) => parseOptionalBool(v)),
  mentallyUnstable: z.string().optional().transform((v) => parseOptionalBool(v)),
  trainingCompleted: z.string().optional().transform((v) => parseOptionalBool(v)),
});

const employeeRowSchema = employeeRowBaseSchema.superRefine((data, ctx) => {
  if (data.employeeType === "security" && (!data.psiraNumber || !String(data.psiraNumber).trim())) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["psiraNumber"], message: "PSIRA number is required for security guards" });
  }
  if (data.employeeType === "security" && !data.hourlyRate && !data.monthlySalary) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["hourlyRate"], message: "Security staff need hourlyRate or monthlySalary" });
  }
  if (data.employeeType === "office" && !data.monthlySalary && !data.hourlyRate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["monthlySalary"], message: "Office staff need monthlySalary or hourlyRate" });
  }
});

/** Same fields as strict schema but does not require PSIRA or pay rates (manual cleanup in app). */
const employeeRowSchemaRelaxed = employeeRowBaseSchema;

const employeeGroupRowSchema = z.object({
  name: z.string().min(1, "Group name is required"),
  description: z.string().optional().transform(emptyToUndefined),
  sortOrder: z.string().optional().transform((v) => parseOptionalNumber(v)),
});

const siteRowSchema = z.object({
  companyName: z.string().optional().transform(emptyToUndefined), // Admin flow: links to company
  name: z.string().min(1, "Site name is required"),
  location: z.string().optional().transform(emptyToUndefined),
  physicalAddress: z.string().optional().transform(emptyToUndefined),
  contactPersonName: z.string().optional().transform(emptyToUndefined),
  contactPersonPhone: z.string().optional().transform(emptyToUndefined),
  contractOrServiceAgreement: z.string().optional().transform(emptyToUndefined),
  serviceType: z.string().optional().transform(emptyToUndefined),
});

// --- Normalize CSV headers: snake_case / "Human Readable" -> camelCase for Zod ---
function toCamelCase(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, "_")
    .split("_")
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
}

// Map user-friendly header names to schema field names
const HEADER_ALIASES: Record<string, string> = {
  sitename: "name", // "Site Name" -> name (for sites)
  groupname: "name",
  employeegroup: "name",
  employeegroupname: "name",
};

function rowToObject(record: string[], headers: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < headers.length; i++) {
    let key = toCamelCase(headers[i]);
    key = HEADER_ALIASES[key.toLowerCase()] ?? key;
    obj[key] = record[i] ?? "";
  }
  return obj;
}

function isInstructionOrExampleEmployeeRow(obj: Record<string, string>): boolean {
  const companyCell = (obj.companyName ?? "").trim().toLowerCase();
  const firstNameCell = (obj.firstName ?? "").trim().toLowerCase();
  const lastNameCell = (obj.lastName ?? "").trim().toLowerCase();

  const isInstructionCompanyCell = companyCell.startsWith("instruction:");
  const isGuidanceNameCells =
    firstNameCell.includes("enter given name") &&
    lastNameCell.includes("enter surname/family name");

  return isInstructionCompanyCell || isGuidanceNameCells;
}

// --- Parse CSV buffer ---
export interface ParseResult<T> {
  valid: T[];
  errors: { row: number; field: string; value: string; message: string }[];
}

export type ValidatedCompany = z.infer<typeof companyRowSchema>;
export type ValidatedEmployee = z.infer<typeof employeeRowBaseSchema>;
export type ValidatedSite = z.infer<typeof siteRowSchema>;
export type ValidatedEmployeeGroup = z.infer<typeof employeeGroupRowSchema>;

export function parseCsvBuffer(buffer: Buffer): { headers: string[]; rows: string[][] } {
  const content = buffer.toString("utf-8");
  const parsed = parse(content, {
    bom: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
  }) as string[][];
  if (parsed.length === 0) return { headers: [], rows: [] };
  const [headers, ...rows] = parsed;
  return { headers: headers ?? [], rows };
}

export function parseAndValidateCompanies(buffer: Buffer): ParseResult<ValidatedCompany> {
  const { headers, rows } = parseCsvBuffer(buffer);
  const valid: ValidatedCompany[] = [];
  const errors: ParseResult<ValidatedCompany>["errors"] = [];

  if (rows.length > MAX_COMPANIES) {
    errors.push({ row: 0, field: "_", value: "", message: `Maximum ${MAX_COMPANIES} companies per import` });
    return { valid, errors };
  }

  for (let i = 0; i < rows.length; i++) {
    const obj = rowToObject(rows[i], headers);
    const result = companyRowSchema.safeParse(obj);
    if (result.success) {
      valid.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        errors.push({
          row: i + 2, // 1-based, +1 for header
          field: path || "unknown",
          value: obj[path] ?? "",
          message: issue.message,
        });
      }
    }
  }
  return { valid, errors };
}

export function parseAndValidateEmployees(
  buffer: Buffer,
  options?: { requireCompanyName?: boolean; allowIncompleteRows?: boolean }
): ParseResult<ValidatedEmployee> {
  const { headers, rows } = parseCsvBuffer(buffer);
  const valid: ValidatedEmployee[] = [];
  const errors: ParseResult<ValidatedEmployee>["errors"] = [];

  const employeeRows = rows
    .map((record, index) => ({ index, obj: rowToObject(record, headers) }))
    .filter(({ obj }) => !isInstructionOrExampleEmployeeRow(obj));

  if (employeeRows.length > MAX_EMPLOYEES) {
    errors.push({ row: 0, field: "_", value: "", message: `Maximum ${MAX_EMPLOYEES} employees per import` });
    return { valid, errors };
  }

  const rowSchema = options?.allowIncompleteRows ? employeeRowSchemaRelaxed : employeeRowSchema;

  for (const { index, obj } of employeeRows) {
    let result = rowSchema.safeParse(obj);
    if (result.success && options?.requireCompanyName && !result.data.companyName) {
      errors.push({
        row: index + 2,
        field: "companyName",
        value: obj.companyname ?? "",
        message: "companyName is required for admin bulk import",
      });
    } else if (result.success) {
      valid.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        errors.push({
          row: index + 2,
          field: path || "unknown",
          value: obj[path] ?? "",
          message: issue.message,
        });
      }
    }
  }
  return { valid, errors };
}

export function parseAndValidateSites(
  buffer: Buffer,
  options?: { requireCompanyName?: boolean }
): ParseResult<ValidatedSite> {
  const { headers, rows } = parseCsvBuffer(buffer);
  const valid: ValidatedSite[] = [];
  const errors: ParseResult<ValidatedSite>["errors"] = [];

  if (rows.length > MAX_SITES) {
    errors.push({ row: 0, field: "_", value: "", message: `Maximum ${MAX_SITES} sites per import` });
    return { valid, errors };
  }

  for (let i = 0; i < rows.length; i++) {
    const obj = rowToObject(rows[i], headers);
    let result = siteRowSchema.safeParse(obj);
    if (result.success && options?.requireCompanyName && !result.data.companyName) {
      errors.push({
        row: i + 2,
        field: "companyName",
        value: obj.companyname ?? "",
        message: "companyName is required for admin bulk import",
      });
    } else if (result.success) {
      valid.push(result.data);
    } else {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        errors.push({
          row: i + 2,
          field: path || "unknown",
          value: obj[path] ?? "",
          message: issue.message,
        });
      }
    }
  }
  return { valid, errors };
}

export function parseAndValidateEmployeeGroups(buffer: Buffer): ParseResult<ValidatedEmployeeGroup> {
  const { headers, rows } = parseCsvBuffer(buffer);
  const valid: ValidatedEmployeeGroup[] = [];
  const errors: ParseResult<ValidatedEmployeeGroup>["errors"] = [];

  const dataRows = rows.filter((r) => r.some((cell) => String(cell ?? "").trim() !== ""));
  if (dataRows.length > MAX_GROUPS) {
    errors.push({ row: 0, field: "_", value: "", message: `Maximum ${MAX_GROUPS} employee groups per import` });
    return { valid, errors };
  }

  const seenNames = new Set<string>();

  for (let i = 0; i < dataRows.length; i++) {
    const obj = rowToObject(dataRows[i], headers);
    const result = employeeGroupRowSchema.safeParse(obj);
    if (!result.success) {
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        errors.push({
          row: i + 2,
          field: path || "unknown",
          value: obj[path] ?? "",
          message: issue.message,
        });
      }
      continue;
    }
    const key = result.data.name.trim().toLowerCase();
    if (seenNames.has(key)) {
      errors.push({
        row: i + 2,
        field: "name",
        value: result.data.name,
        message: "Duplicate group name in this file",
      });
      continue;
    }
    seenNames.add(key);
    valid.push(result.data);
  }
  return { valid, errors };
}

// --- Import execution ---

export interface ImportResult {
  companiesCreated: number;
  employeesCreated: number;
  sitesCreated: number;
  groupsCreated: number;
  groupsSkipped: number;
  errors: { entity: string; row?: number; message: string }[];
}

export async function executeCompanyImport(
  companies: ValidatedCompany[],
  employees: ValidatedEmployee[],
  sites: ValidatedSite[],
  companyNameToId: Map<string, string>
): Promise<ImportResult> {
  const result: ImportResult = {
    companiesCreated: 0,
    employeesCreated: 0,
    sitesCreated: 0,
    groupsCreated: 0,
    groupsSkipped: 0,
    errors: [],
  };

  await prisma.$transaction(async (tx) => {
    // 1. Create companies
    for (const c of companies) {
      const created = await tx.company.create({
        data: {
          name: c.name,
          legalName: c.legalName ?? null,
          registrationNumber: c.registrationNumber ?? null,
          taxNumber: c.taxNumber ?? null,
          address: c.address ?? null,
          phone: c.phone ?? null,
          email: c.email ?? null,
          website: c.website ?? null,
          psiraRegistration: c.psiraRegistration ?? null,
          uifReference: c.uifReference ?? null,
          settings:
            c.currency || c.timezone || c.payrollPeriod
              ? { currency: c.currency ?? undefined, timezone: c.timezone ?? undefined, payrollPeriod: c.payrollPeriod ?? undefined }
              : undefined,
        },
      });
      companyNameToId.set(c.name.trim(), created.id);
      result.companiesCreated++;
    }

    // 2. Create employees
    for (const e of employees) {
      const companyId = e.companyName ? companyNameToId.get(e.companyName.trim()) : undefined;
      if (!companyId) {
        result.errors.push({
          entity: "employee",
          message: `Unknown company "${e.companyName}" for ${e.firstName} ${e.lastName}`,
        });
        continue;
      }

      const employeeNumber =
        e.employeeNumber && e.employeeNumber.trim()
          ? e.employeeNumber.trim()
          : `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const existing = await tx.employee.findUnique({
        where: { companyId_employeeNumber: { companyId, employeeNumber } },
      });
      if (existing) {
        result.errors.push({
          entity: "employee",
          message: `Employee number ${employeeNumber} already exists`,
        });
        continue;
      }

      await tx.employee.create({
        data: {
          companyId,
          employeeNumber,
          firstName: e.firstName,
          lastName: e.lastName,
          idNumber: e.idNumber ?? null,
          phone: e.phone ?? null,
          email: e.email ?? null,
          status: e.status,
          employeeType: e.employeeType,
          hourlyRate: e.hourlyRate ?? null,
          monthlySalary: e.monthlySalary ?? null,
          jobRole: e.jobRole ?? null,
          psiraNumber: e.psiraNumber ?? null,
          securityServiceType: e.securityServiceType ?? null,
          dateOfBirth: e.dateOfBirth ?? null,
          gender: e.gender ?? null,
          maritalStatus: e.maritalStatus ?? null,
          physicalAddress: e.physicalAddress ?? null,
          postalAddress: e.postalAddress ?? null,
          postalCode: e.postalCode ?? null,
          taxNumber: e.taxNumber ?? null,
          bankName: e.bankName ?? null,
          bankAccountNumber: e.bankAccountNumber ?? null,
          bankBranchCode: e.bankBranchCode ?? null,
          commencementDate: e.commencementDate ?? null,
          occupation: e.occupation ?? null,
          placeOfWork: e.placeOfWork ?? null,
          ordinaryHours: e.ordinaryHours ?? null,
          ordinaryDays: e.ordinaryDays ?? null,
          overtimeRate: e.overtimeRate ?? null,
          payFrequency: e.payFrequency ?? null,
          leaveEntitlement: e.leaveEntitlement ?? null,
          noticePeriod: e.noticePeriod ?? null,
          previousService: e.previousService ?? null,
          psiraExpiryDate: e.psiraExpiryDate ?? null,
          nextOfKin1Name: e.nextOfKin1Name ?? null,
          nextOfKin1Phone: e.nextOfKin1Phone ?? null,
          nextOfKin2Name: e.nextOfKin2Name ?? null,
          nextOfKin2Phone: e.nextOfKin2Phone ?? null,
          nextOfKin3Name: e.nextOfKin3Name ?? null,
          nextOfKin3Phone: e.nextOfKin3Phone ?? null,
          residedOutsideSA: e.residedOutsideSA ?? null,
          militaryPoliceService: e.militaryPoliceService ?? null,
          criminalInvestigation: e.criminalInvestigation ?? null,
          mentallyUnstable: e.mentallyUnstable ?? null,
          trainingCompleted: e.trainingCompleted ?? null,
        },
      });
      result.employeesCreated++;
    }

    // 3. Create sites
    for (const s of sites) {
      const companyId = s.companyName ? companyNameToId.get(s.companyName.trim()) : undefined;
      if (!companyId) {
        result.errors.push({
          entity: "site",
          message: `Unknown company "${s.companyName}" for site ${s.name}`,
        });
        continue;
      }

      await tx.site.create({
        data: {
          companyId,
          name: s.name,
          location: s.location ?? null,
          physicalAddress: s.physicalAddress ?? null,
          contactPersonName: s.contactPersonName ?? null,
          contactPersonPhone: s.contactPersonPhone ?? null,
          contractOrServiceAgreement: s.contractOrServiceAgreement ?? null,
          serviceType: s.serviceType ?? null,
        },
      });
      result.sitesCreated++;
    }
  }, MIGRATION_TRANSACTION_OPTIONS);

  return result;
}

export async function executeSelfImport(
  companyId: string,
  employees: ValidatedEmployee[],
  sites: ValidatedSite[],
  groups: ValidatedEmployeeGroup[] = []
): Promise<ImportResult> {
  const result: ImportResult = {
    companiesCreated: 0,
    employeesCreated: 0,
    sitesCreated: 0,
    groupsCreated: 0,
    groupsSkipped: 0,
    errors: [],
  };

  const companyNameToId = new Map<string, string>();
  companyNameToId.set("_self", companyId);

  // Assign all to current company
  const employeesWithCompany = employees.map((e) => ({ ...e, companyName: "_self" }));
  const sitesWithCompany = sites.map((s) => ({ ...s, companyName: "_self" }));

  await prisma.$transaction(async (tx) => {
    for (const e of employeesWithCompany) {
      const employeeNumber =
        e.employeeNumber && e.employeeNumber.trim()
          ? e.employeeNumber.trim()
          : `EMP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      const existing = await tx.employee.findUnique({
        where: { companyId_employeeNumber: { companyId, employeeNumber } },
      });
      if (existing) {
        result.errors.push({
          entity: "employee",
          message: `Employee number ${employeeNumber} already exists`,
        });
        continue;
      }

      await tx.employee.create({
        data: {
          companyId,
          employeeNumber,
          firstName: e.firstName,
          lastName: e.lastName,
          idNumber: e.idNumber ?? null,
          phone: e.phone ?? null,
          email: e.email ?? null,
          status: e.status,
          employeeType: e.employeeType,
          hourlyRate: e.hourlyRate ?? null,
          monthlySalary: e.monthlySalary ?? null,
          jobRole: e.jobRole ?? null,
          psiraNumber: e.psiraNumber ?? null,
          securityServiceType: e.securityServiceType ?? null,
          dateOfBirth: e.dateOfBirth ?? null,
          gender: e.gender ?? null,
          maritalStatus: e.maritalStatus ?? null,
          physicalAddress: e.physicalAddress ?? null,
          postalAddress: e.postalAddress ?? null,
          postalCode: e.postalCode ?? null,
          taxNumber: e.taxNumber ?? null,
          bankName: e.bankName ?? null,
          bankAccountNumber: e.bankAccountNumber ?? null,
          bankBranchCode: e.bankBranchCode ?? null,
          commencementDate: e.commencementDate ?? null,
          occupation: e.occupation ?? null,
          placeOfWork: e.placeOfWork ?? null,
          ordinaryHours: e.ordinaryHours ?? null,
          ordinaryDays: e.ordinaryDays ?? null,
          overtimeRate: e.overtimeRate ?? null,
          payFrequency: e.payFrequency ?? null,
          leaveEntitlement: e.leaveEntitlement ?? null,
          noticePeriod: e.noticePeriod ?? null,
          previousService: e.previousService ?? null,
          psiraExpiryDate: e.psiraExpiryDate ?? null,
          nextOfKin1Name: e.nextOfKin1Name ?? null,
          nextOfKin1Phone: e.nextOfKin1Phone ?? null,
          nextOfKin2Name: e.nextOfKin2Name ?? null,
          nextOfKin2Phone: e.nextOfKin2Phone ?? null,
          nextOfKin3Name: e.nextOfKin3Name ?? null,
          nextOfKin3Phone: e.nextOfKin3Phone ?? null,
          residedOutsideSA: e.residedOutsideSA ?? null,
          militaryPoliceService: e.militaryPoliceService ?? null,
          criminalInvestigation: e.criminalInvestigation ?? null,
          mentallyUnstable: e.mentallyUnstable ?? null,
          trainingCompleted: e.trainingCompleted ?? null,
        },
      });
      result.employeesCreated++;
    }

    for (const s of sitesWithCompany) {
      await tx.site.create({
        data: {
          companyId,
          name: s.name,
          location: s.location ?? null,
          physicalAddress: s.physicalAddress ?? null,
          contactPersonName: s.contactPersonName ?? null,
          contactPersonPhone: s.contactPersonPhone ?? null,
          contractOrServiceAgreement: s.contractOrServiceAgreement ?? null,
          serviceType: s.serviceType ?? null,
        },
      });
      result.sitesCreated++;
    }

    let groupSort = 0;
    for (const g of groups) {
      const name = g.name.trim();
      const existing = await tx.employeeGroup.findFirst({
        where: { companyId, name },
        select: { id: true },
      });
      if (existing) {
        result.groupsSkipped++;
        continue;
      }
      await tx.employeeGroup.create({
        data: {
          companyId,
          name,
          description: g.description ?? null,
          sortOrder: g.sortOrder !== undefined && !Number.isNaN(g.sortOrder) ? Math.floor(g.sortOrder) : groupSort,
        },
      });
      result.groupsCreated++;
      groupSort++;
    }
  }, MIGRATION_TRANSACTION_OPTIONS);

  return result;
}

export function checkFileSize(buffer: Buffer, maxBytes: number = MAX_FILE_SIZE): boolean {
  return buffer.length <= maxBytes;
}

// --- Export to CSV ---

function csvEscape(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Safely format Prisma Decimal or number to string for CSV (hourly rate, monthly salary) */
function formatDecimal(val: unknown): string {
  if (val === null || val === undefined) return "";
  if (typeof val === "number" && !Number.isNaN(val)) return String(val);
  if (typeof val === "object" && val !== null && "toString" in val) return String(val);
  return String(val);
}

export async function exportEmployeesOperationalToCsv(companyId: string, companyName: string): Promise<string> {
  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: {
      employeeNumber: true,
      firstName: true,
      lastName: true,
      phone: true,
      employeeType: true,
      status: true,
      jobRole: true,
      psiraNumber: true,
      securityServiceType: true,
      group: { select: { name: true } },
      grade: { select: { name: true } },
    },
    orderBy: { employeeNumber: "asc" },
    take: MAX_EMPLOYEES,
  });

  const headers = [
    "Company Name",
    "Employee Number",
    "First Name",
    "Last Name",
    "Phone",
    "Employee Type",
    "Status",
    "Job Role",
    "Group",
    "Grade",
    "PSIRA Number",
    "Security Service Type",
  ];

  const rows = employees.map((e) => [
    csvEscape(companyName),
    csvEscape(e.employeeNumber),
    csvEscape(e.firstName),
    csvEscape(e.lastName),
    csvEscape(e.phone),
    csvEscape(e.employeeType),
    csvEscape(e.status),
    csvEscape(e.jobRole),
    csvEscape(e.group?.name),
    csvEscape(e.grade?.name),
    csvEscape(e.psiraNumber),
    csvEscape(e.securityServiceType),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

/** @deprecated use exportEmployeesOperationalToCsv or exportEmployeesConfidentialToCsv */
export async function exportEmployeesToCsv(companyId: string, companyName: string): Promise<string> {
  const employees = await prisma.employee.findMany({
    where: { companyId },
    include: { grade: { select: { name: true } }, group: { select: { name: true } } },
    orderBy: { employeeNumber: "asc" },
    take: MAX_EMPLOYEES,
  });

  const headers = [
    "Company Name",
    "Employee Number",
    "First Name",
    "Last Name",
    "ID Number",
    "Date of Birth",
    "Gender",
    "Phone",
    "Email",
    "Employee Type",
    "Status",
    "Job Role",
    "Occupation",
    "Commencement Date",
    "Hourly Rate",
    "Monthly Salary",
    "PSIRA Number",
    "Security Service Type",
  ];

  const rows = employees.map((e) => [
    csvEscape(companyName),
    csvEscape(e.employeeNumber),
    csvEscape(e.firstName),
    csvEscape(e.lastName),
    csvEscape(e.idNumber),
    csvEscape(formatDate(e.dateOfBirth)),
    csvEscape(e.gender),
    csvEscape(e.phone),
    csvEscape(e.email),
    csvEscape(e.employeeType),
    csvEscape(e.status),
    csvEscape(e.jobRole),
    csvEscape(e.occupation),
    csvEscape(formatDate(e.commencementDate)),
    csvEscape(formatDecimal(e.hourlyRate)),
    csvEscape(formatDecimal(e.monthlySalary)),
    csvEscape(e.psiraNumber),
    csvEscape(e.securityServiceType),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

export async function exportEmployeesConfidentialToCsv(companyId: string, companyName: string): Promise<string> {
  const employees = await prisma.employee.findMany({
    where: { companyId },
    select: {
      employeeNumber: true,
      firstName: true,
      lastName: true,
      idNumber: true,
      dateOfBirth: true,
      gender: true,
      email: true,
      taxNumber: true,
      bankName: true,
      bankAccountNumber: true,
      bankBranchCode: true,
      hourlyRate: true,
      monthlySalary: true,
      overtimeRate: true,
    },
    orderBy: { employeeNumber: "asc" },
    take: MAX_EMPLOYEES,
  });

  const headers = [
    "Company Name",
    "Employee Number",
    "First Name",
    "Last Name",
    "ID Number",
    "Date of Birth",
    "Gender",
    "Email",
    "Tax Number",
    "Bank Name",
    "Bank Account Number",
    "Bank Branch Code",
    "Hourly Rate",
    "Monthly Salary",
    "Overtime Rate",
  ];

  const rows = employees.map((e) => [
    csvEscape(companyName),
    csvEscape(e.employeeNumber),
    csvEscape(e.firstName),
    csvEscape(e.lastName),
    csvEscape(e.idNumber),
    csvEscape(formatDate(e.dateOfBirth)),
    csvEscape(e.gender),
    csvEscape(e.email),
    csvEscape(e.taxNumber),
    csvEscape(e.bankName),
    csvEscape(e.bankAccountNumber),
    csvEscape(e.bankBranchCode),
    csvEscape(formatDecimal(e.hourlyRate)),
    csvEscape(formatDecimal(e.monthlySalary)),
    csvEscape(formatDecimal(e.overtimeRate)),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

export async function exportEmployeeGroupsToCsv(companyId: string): Promise<string> {
  const groups = await prisma.employeeGroup.findMany({
    where: { companyId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    take: MAX_GROUPS,
  });

  const headers = ["Name", "Description", "Sort Order"];
  const rows = groups.map((g) => [
    csvEscape(g.name),
    csvEscape(g.description),
    csvEscape(g.sortOrder),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}

export async function exportSitesToCsv(companyId: string, companyName: string): Promise<string> {
  const sites = await prisma.site.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
    take: MAX_SITES,
  });

  const headers = [
    "Company Name",
    "Site Name",
    "Location",
    "Physical Address",
    "Contact Person Name",
    "Contact Person Phone",
    "Contract or Service Agreement",
    "Service Type",
  ];

  const rows = sites.map((s) => [
    csvEscape(companyName),
    csvEscape(s.name),
    csvEscape(s.location),
    csvEscape(s.physicalAddress),
    csvEscape(s.contactPersonName),
    csvEscape(s.contactPersonPhone),
    csvEscape(s.contractOrServiceAgreement),
    csvEscape(s.serviceType),
  ]);

  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\r\n");
}
