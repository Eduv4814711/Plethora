import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { authFetch } from "@/lib/api";
import { siteTimesheetCsvUrl, type AttendanceShiftTypeFilter, type SiteTimesheet, type SiteTimesheetRow } from "@/lib/roster-api";
import { humanizeCode } from "@/lib/site-timesheet-row-patch";

/** Timesheet exports. Extracted from SiteTimesheetsSection unchanged. */

export function exportSiteTimesheetPdf(params: {
  sheet: SiteTimesheet;
  rows: SiteTimesheetRow[];
  shiftType: AttendanceShiftTypeFilter;
}) {
  const { sheet, rows, shiftType } = params;
  const shiftLabel = shiftType === "day" ? "day-shift" : shiftType === "night" ? "night-shift" : "all";

  const doc = new jsPDF({ orientation: "landscape" });
  doc.setFontSize(16);
  doc.text("Site Timesheet", 14, 16);
  doc.setFontSize(10);
  const shiftNote = shiftType === "all" ? "All shifts" : `${shiftLabel} only`;
  doc.text(
    `${sheet.siteName} | ${sheet.periodStart} to ${sheet.periodEnd} | ${shiftNote} | Generated ${new Date().toLocaleDateString()}`,
    14,
    24
  );
  doc.text(
    `Status: ${humanizeCode(sheet.status)} | Approved: ${sheet.approvedAt ? new Date(sheet.approvedAt).toLocaleString() : "Not approved"}`,
    14,
    30
  );
  autoTable(doc, {
    startY: 36,
    head: [[
      "Date",
      "Day",
      "Scheduled",
      "Actual",
      "Planned",
      "Actual shift",
      "Status",
      "Hours",
      "Duty ON OB",
      "Duty OFF OB",
      "Discrepancies",
      "Comments",
    ]],
    body: rows.map((row) => [
      row.workDate,
      row.dayOfWeek,
      row.plannedGuardName ?? "",
      row.actualGuardName ?? "",
      row.plannedShiftType ?? row.plannedShiftCode ?? "",
      row.actualShiftType ?? row.actualShiftCode ?? "",
      humanizeCode(row.attendanceStatus),
      row.hoursWorked ?? "",
      row.dutyOnObNumber ?? row.occurrenceBookNumber ?? "",
      row.dutyOffObNumber ?? "",
      row.discrepancyCodes.map(humanizeCode).join("; "),
      row.comments ?? "",
    ]),
    styles: { fontSize: 7, cellPadding: 1.5 },
    headStyles: { fillColor: [15, 23, 42] },
  });
  const y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 180;
  doc.text(
    "Supervisor signature: ____________________    Manager signature: ____________________",
    14,
    y + 12
  );
  const suffix = shiftType === "all" ? "" : `-${shiftType}`;
  doc.save(`site-timesheet-${sheet.siteName}-${sheet.periodStart}${suffix}.pdf`);
}

export async function downloadSiteTimesheetCsv(params: {
  token: string;
  sheet: SiteTimesheet;
  siteId: string;
  periodStart: string;
  periodEnd: string;
  shiftType: AttendanceShiftTypeFilter;
}) {
  const { token, sheet, siteId, periodStart, periodEnd, shiftType } = params;
  const res = await authFetch(siteTimesheetCsvUrl(siteId, periodStart, periodEnd, shiftType), token);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { message?: string; error?: string }).message ||
        (body as { error?: string }).error ||
        "Failed to download CSV"
    );
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const suffix = shiftType === "all" ? "" : `-${shiftType}`;
  anchor.download = `site-timesheet-${sheet.siteName}-${sheet.periodStart}${suffix}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}
