import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { prisma } from "../lib/prisma.js";
import { fetchPayslipData, buildPayslipTemplateData } from "./payslip-data.service.js";
import { generatePayslipPDFFromTemplate } from "./payslip-pdf.service.js";
import { format } from "date-fns";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const SALT = "plethora-email-config";

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  enabled: boolean;
}

export interface EmailTemplateConfig {
  enabled: boolean;
  subject: string;
  body: string;
  notifyEmails?: string[];
}

export interface EmailTemplatesConfig {
  payslipOnApproval?: EmailTemplateConfig;
  leaveRequestSubmitted?: EmailTemplateConfig & { notifyEmails: string[] };
  leaveRequestApproved?: EmailTemplateConfig;
  leaveRequestRejected?: EmailTemplateConfig;
}

function getEncryptionKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (key && key.length >= 32) {
    return Buffer.from(key.slice(0, 64), "hex").slice(0, 32);
  }
  if (key) {
    return scryptSync(key, SALT, 32);
  }
  return scryptSync("plethora-default-key-change-in-production", SALT, 32);
}

function encryptPassword(plain: string): string {
  if (!plain) return "";
  const key = getEncryptionKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plain, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decryptPassword(encrypted: string): string {
  if (!encrypted) return "";
  try {
    const buf = Buffer.from(encrypted, "base64");
    if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH) return "";
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
    const data = buf.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
    const key = getEncryptionKey();
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(data) + decipher.final("utf8");
  } catch {
    return "";
  }
}

export async function getEmailConfig(companyId: string): Promise<EmailConfig | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  });
  const settings = (company?.settings as Record<string, unknown>) ?? {};
  const cfg = settings.emailConfig as Record<string, unknown> | undefined;
  if (!cfg || !cfg.host || !cfg.user) return null;
  const password = typeof cfg.password === "string" ? decryptPassword(cfg.password) : "";
  return {
    host: String(cfg.host),
    port: Number(cfg.port) || 587,
    secure: Boolean(cfg.secure),
    user: String(cfg.user),
    password,
    from: String(cfg.from || cfg.user),
    enabled: cfg.enabled !== false,
  };
}

export function getEmailConfigForApi(companyId: string): Promise<Omit<EmailConfig, "password"> & { password: string } | null> {
  return getEmailConfig(companyId).then((c) =>
    c ? { ...c, password: c.password ? "********" : "" } : null
  );
}

function getEmailTemplates(companyId: string): Promise<EmailTemplatesConfig | null> {
  return prisma.company.findUnique({
    where: { id: companyId },
    select: { settings: true },
  }).then((company) => {
    const settings = (company?.settings as Record<string, unknown>) ?? {};
    return (settings.emailTemplates as EmailTemplatesConfig) ?? null;
  });
}

function createTransporter(config: EmailConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.password,
    },
  });
}

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer }>;
}

export async function sendEmail(
  companyId: string,
  options: SendEmailOptions
): Promise<boolean> {
  const config = await getEmailConfig(companyId);
  if (!config || !config.enabled || !config.password) {
    return false;
  }
  try {
    const transporter = createTransporter(config);
    await transporter.sendMail({
      from: config.from,
      to: Array.isArray(options.to) ? options.to.join(", ") : options.to,
      subject: options.subject,
      text: options.body,
      html: options.html ?? options.body.replace(/\n/g, "<br>"),
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
      })),
    });
    return true;
  } catch (err) {
    console.error("[Email] Send failed:", err);
    return false;
  }
}

function replacePlaceholders(text: string, data: Record<string, string | undefined>): string {
  let out = text;
  for (const [key, value] of Object.entries(data)) {
    out = out.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value ?? "");
  }
  return out;
}

export async function sendPayslipEmail(
  companyId: string,
  payrollRunId: string,
  payrollItemId: string,
  employeeEmail: string
): Promise<boolean> {
  const config = await getEmailConfig(companyId);
  const templates = await getEmailTemplates(companyId);
  const tpl = templates?.payslipOnApproval;
  if (!config?.enabled || !tpl?.enabled || !employeeEmail?.trim()) {
    return false;
  }

  const payslipInput = await fetchPayslipData(payrollRunId, payrollItemId, companyId);
  if (!payslipInput) return false;

  const emp = payslipInput.payrollItem.employee;
  const employeeName = `${emp.firstName} ${emp.lastName}`.trim();
  const period = format(payslipInput.periodStart, "MMM yyyy");

  const templateData = buildPayslipTemplateData(payslipInput);
  const pdfBuffer = await generatePayslipPDFFromTemplate(templateData);
  const filename = `payslip-${employeeName.replace(/\s+/g, "-")}-${format(payslipInput.periodStart, "yyyy-MM")}.pdf`;

  const subject = replacePlaceholders(tpl.subject, { employeeName, period });
  const body = replacePlaceholders(tpl.body, { employeeName, period });

  return sendEmail(companyId, {
    to: employeeEmail,
    subject,
    body,
    attachments: [{ filename, content: pdfBuffer }],
  });
}

export type LeaveNotificationType = "submitted" | "approved" | "rejected";

export interface LeaveNotificationData {
  employeeName: string;
  employeeEmail?: string;
  leaveType: string;
  leaveDate: string;
}

export async function sendLeaveNotification(
  companyId: string,
  type: LeaveNotificationType,
  data: LeaveNotificationData
): Promise<boolean> {
  const config = await getEmailConfig(companyId);
  const templates = await getEmailTemplates(companyId);
  if (!config?.enabled) return false;

  if (type === "submitted") {
    const tpl = templates?.leaveRequestSubmitted;
    if (!tpl?.enabled || !tpl.notifyEmails?.length) return false;
    const vars: Record<string, string> = { employeeName: data.employeeName, leaveType: data.leaveType, leaveDate: data.leaveDate };
    const subject = replacePlaceholders(tpl.subject, vars);
    const body = replacePlaceholders(tpl.body, vars);
    return sendEmail(companyId, {
      to: tpl.notifyEmails,
      subject,
      body,
    });
  }

  if (type === "approved" || type === "rejected") {
    const tpl = type === "approved" ? templates?.leaveRequestApproved : templates?.leaveRequestRejected;
    if (!tpl?.enabled || !data.employeeEmail?.trim()) return false;
    const vars: Record<string, string> = { employeeName: data.employeeName, leaveType: data.leaveType, leaveDate: data.leaveDate };
    const subject = replacePlaceholders(tpl.subject, vars);
    const body = replacePlaceholders(tpl.body, vars);
    return sendEmail(companyId, {
      to: data.employeeEmail,
      subject,
      body,
    });
  }

  return false;
}

export function encryptPasswordForStorage(plain: string): string {
  return encryptPassword(plain);
}
