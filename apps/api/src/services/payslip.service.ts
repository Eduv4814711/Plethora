import { jsPDF } from "jspdf";
import { applyPlugin } from "jspdf-autotable";

applyPlugin(jsPDF);
import { format } from "date-fns";
import type { PayrollItem, Employee, Payslip } from "@prisma/client";

interface PayslipData {
  payrollItem: PayrollItem & { employee: Employee; payslip: Payslip | null };
  companyName: string;
  periodStart: Date;
  periodEnd: Date;
}

export function generatePayslipPDF(data: PayslipData): Buffer {
  const { payrollItem, companyName, periodStart, periodEnd } = data;
  const emp = payrollItem.employee;
  const payslip = payrollItem.payslip;

  const doc = new jsPDF() as import("jspdf").jsPDF & { autoTable: (opts: object) => void };
  const earnings = (payslip?.earnings as Array<{ name: string; amount: number }>) ?? [];
  const deductions = (payslip?.deductions as Array<{ name: string; amount: number }>) ?? [];
  const grossPay = payslip ? Number(payslip.grossPay) : Number(payrollItem.grossPay);
  const totalDeductions = payslip ? Number(payslip.totalDeductions) : Number(payrollItem.deductions);
  const netPay = payslip ? Number(payslip.netPay) : Number(payrollItem.netPay);

  doc.setFontSize(14);
  doc.text("Payslip", 14, 16);
  doc.setFontSize(10);
  doc.text(companyName, 14, 22);
  doc.text(
    `Period: ${format(periodStart, "d MMM yyyy")} – ${format(periodEnd, "d MMM yyyy")}`,
    14,
    28
  );
  doc.text(`Generated: ${format(new Date(), "d MMM yyyy HH:mm")}`, 14, 34);

  let y = 44;
  doc.setFont("helvetica", "bold");
  doc.text("Employee", 14, y);
  doc.setFont("helvetica", "normal");
  y += 6;
  doc.text(`${emp.firstName} ${emp.lastName}`, 14, y);
  y += 5;
  if (emp.employeeNumber) doc.text(`ID: ${emp.employeeNumber}`, 14, y);
  y += 10;

  const earningsRows = earnings.map((e) => [e.name, e.amount.toFixed(2)]);
  const deductionsRows = deductions.map((d) => [d.name, d.amount.toFixed(2)]);

  doc.autoTable({
    startY: y,
    head: [["Earnings", "Amount"]],
    body: earningsRows.length > 0 ? earningsRows : [["Basic", "0.00"]],
    theme: "plain",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [240, 240, 240], fontStyle: "bold" },
    margin: { left: 14 },
    tableWidth: 90,
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  doc.autoTable({
    startY: y,
    head: [["Deductions", "Amount"]],
    body: deductionsRows.length > 0 ? deductionsRows : [["None", "0.00"]],
    theme: "plain",
    styles: { fontSize: 9 },
    headStyles: { fillColor: [240, 240, 240], fontStyle: "bold" },
    margin: { left: 14 },
    tableWidth: 90,
  });

  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 12;

  doc.setFont("helvetica", "bold");
  doc.text(`Gross Pay: R ${grossPay.toFixed(2)}`, 14, y);
  y += 6;
  doc.text(`Total Deductions: R ${totalDeductions.toFixed(2)}`, 14, y);
  y += 6;
  doc.text(`Net Pay: R ${netPay.toFixed(2)}`, 14, y);
  doc.setFont("helvetica", "normal");

  return Buffer.from(doc.output("arraybuffer"));
}
