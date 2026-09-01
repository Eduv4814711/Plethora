import { readFileSync } from "fs";
import { launchPdfBrowser } from "../lib/pdf-browser.js";
import { templatePath } from "../lib/template-dir.js";

const TEMPLATE_PATH = templatePath("payslip.html");

export interface PayslipTemplateData {
  employerName?: string;
  employeeName?: string;
  dateEngaged?: string;
  employeeNumber?: string;
  jobTitle?: string;
  payDate?: string;
  siteName?: string;
  companyName?: string;
  companyAddress?: string;
  psiraRegistration?: string;
  companyRegistration?: string;
  taxNumber?: string;
  uifReference?: string;
  telephone?: string;
  fax?: string;
  email?: string;
  psiraRegistrationNumber?: string;
  identityNumber?: string;
  dateOfBirth?: string;
  maritalStatus?: string;
  gender?: string;
  jobGrade?: string;
  jobGradeRate?: string;
  earnings?: Array<{ name: string; amount: number }>;
  deductions?: Array<{ name: string; amount: number }>;
  grossPay?: number;
  totalDeductions?: number;
  netPay?: number;
  totalLeaveDays?: number;
  totalHoursWorked?: number;
  normalHoursWorked?: number;
  overtimeHours?: number;
  sundayHours?: number;
  publicHolidayHours?: number;
  annualLeaveHours?: number;
  sickLeaveHours?: number;
  totalEmployeeContribution?: number;
  totalCompanyContribution?: number;
  taxableEarnings?: number;
  tax?: number;
  additionalTax?: number;
  totalPerks?: number;
  accountHolder?: string;
  bankName?: string;
  accountNumber?: string;
  branchCode?: string;
}

/**
 * Generate A4 PDF payslip using Puppeteer from HTML template.
 * Data is injected into the page via window.__PAYSLIP_DATA__.
 */
export async function generatePayslipPDFFromTemplate(
  data: PayslipTemplateData
): Promise<Buffer> {
  const html = readFileSync(TEMPLATE_PATH, "utf-8");
  const dataScript = `<script>window.__PAYSLIP_DATA__ = ${JSON.stringify(data)};</script>`;
  const fullHtml = html.replace("</head>", `${dataScript}</head>`);

  const browser = await launchPdfBrowser();

  try {
    const page = await browser.newPage();
    await page.setContent(fullHtml, {
      waitUntil: "domcontentloaded",
      timeout: 15000,
    });

    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", right: "18mm", bottom: "10mm", left: "10mm" },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
