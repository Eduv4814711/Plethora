import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parseISO } from "date-fns";

export interface RosterShift {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  employee: { id: string; firstName: string; lastName: string };
  post: { id: string; name: string; shiftType: string | null; site: { name: string } };
}

const WIREFRAME_STYLES = {
  lineWidth: 0.1,
  lineColor: [0, 0, 0] as [number, number, number],
  fillColor: [255, 255, 255] as [number, number, number],
  textColor: [0, 0, 0] as [number, number, number],
};

const HEADER_STYLES = {
  fillColor: [250, 250, 250] as [number, number, number],
  textColor: [0, 0, 0] as [number, number, number],
  fontStyle: "bold" as const,
};

/**
 * Generate a PDF blob for the full workforce roster.
 * Uses a flat table: Date | Employee | Site | Post | Type | Start | End
 */
export function generateFullRosterPDF(
  shifts: RosterShift[],
  calendarDays: Date[],
  periodLabel: string
): Blob {
  const useLandscape = calendarDays.length > 14;
  const doc = new jsPDF({ orientation: useLandscape ? "landscape" : "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();

  doc.setFontSize(12);
  doc.text("Roster", 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(periodLabel, 14, 22);
  doc.text(`Generated ${format(new Date(), "d MMM yyyy HH:mm")}`, 14, 27);
  doc.setTextColor(0, 0, 0);

  if (shifts.length === 0) {
    doc.setFontSize(10);
    doc.text("No shifts scheduled for this period.", 14, 40);
  } else {
    // #region agent log
    const sample = shifts[0];
    if (sample) {
      const startParsed = parseISO(sample.startTime);
      const endParsed = parseISO(sample.endTime);
      const startFormatted = format(startParsed, "HH:mm");
      const endFormatted = format(endParsed, "HH:mm");
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'roster-pdf.ts:generateFullRosterPDF',message:'PDF time formatting',data:{rawStartTime:sample.startTime,rawEndTime:sample.endTime,startParsedIso:startParsed.toISOString(),endParsedIso:endParsed.toISOString(),startFormatted,endFormatted,tzOffsetMin:new Date().getTimezoneOffset(),shiftsCount:shifts.length},hypothesisId:'H1,H2,H3,H4,H5',timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    const head = [["Date", "Employee", "Site", "Post", "Type", "Start", "End"]];
    const body = shifts
      .sort((a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime())
      .map((s) => {
        const start = parseISO(s.startTime);
        return [
          format(start, "EEE d MMM"),
          `${s.employee.firstName} ${s.employee.lastName}`,
          s.post.site.name,
          s.post.name,
          s.post.shiftType ?? "day",
          format(start, "HH:mm"),
          format(parseISO(s.endTime), "HH:mm"),
        ];
      });

    autoTable(doc, {
      head,
      body,
      startY: 32,
      styles: {
        fontSize: 9,
        cellPadding: 3,
        ...WIREFRAME_STYLES,
      },
      headStyles: {
        ...HEADER_STYLES,
        ...WIREFRAME_STYLES,
      },
      alternateRowStyles: {
        fillColor: [252, 252, 252] as [number, number, number],
      },
      margin: { left: 14 },
      tableWidth: pageWidth - 28,
    });
  }

  return doc.output("blob");
}

/**
 * Generate a PDF blob for a single guard's roster.
 * Table: Date | Site | Post | Type | Start | End
 */
export function generateGuardRosterPDF(
  shifts: RosterShift[],
  employeeName: string,
  periodLabel: string
): Blob {
  const doc = new jsPDF();

  doc.setFontSize(12);
  doc.text(`${employeeName} – Roster`, 14, 16);
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(periodLabel, 14, 22);
  doc.text(`Generated ${format(new Date(), "d MMM yyyy HH:mm")}`, 14, 27);
  doc.setTextColor(0, 0, 0);

  const filteredShifts = shifts.sort(
    (a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime()
  );

  if (filteredShifts.length === 0) {
    doc.setFontSize(10);
    doc.text("No shifts scheduled for this period.", 14, 40);
  } else {
    // #region agent log
    const sample = filteredShifts[0];
    if (sample) {
      const startParsed = parseISO(sample.startTime);
      const endParsed = parseISO(sample.endTime);
      fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'roster-pdf.ts:generateGuardRosterPDF',message:'Guard PDF time formatting',data:{rawStartTime:sample.startTime,rawEndTime:sample.endTime,startFormatted:format(startParsed,'HH:mm'),endFormatted:format(endParsed,'HH:mm'),tzOffsetMin:new Date().getTimezoneOffset()},hypothesisId:'H1,H2,H3,H4,H5',timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    const head = [["Date", "Site", "Post", "Type", "Start", "End"]];
    const body = filteredShifts.map((s) => {
      const start = parseISO(s.startTime);
      return [
        format(start, "EEE d MMM"),
        s.post.site.name,
        s.post.name,
        s.post.shiftType ?? "day",
        format(start, "HH:mm"),
        format(parseISO(s.endTime), "HH:mm"),
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: 32,
      styles: {
        fontSize: 10,
        cellPadding: 3,
        ...WIREFRAME_STYLES,
      },
      headStyles: {
        ...HEADER_STYLES,
        ...WIREFRAME_STYLES,
      },
      alternateRowStyles: {
        fillColor: [252, 252, 252] as [number, number, number],
      },
      margin: { left: 14 },
    });
  }

  return doc.output("blob");
}
