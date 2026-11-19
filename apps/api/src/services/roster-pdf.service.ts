import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

export interface RosterPdfShiftRow {
  dateLine: string;
  timeRange: string;
  site: string;
  post: string;
}

export interface RosterPdfData {
  companyName?: string;
  employeeName: string;
  generatedAtLabel: string;
  timeZoneLabel: string;
  shifts: RosterPdfShiftRow[];
}

const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN_X = 36;
const MARGIN_BOTTOM = 42;

const NAVY = rgb(0.06, 0.12, 0.24);
const AMBER = rgb(0.85, 0.52, 0.08);
const SLATE = rgb(0.35, 0.4, 0.48);
const TEXT_DARK = rgb(0.11, 0.14, 0.2);
const ROW_ALT = rgb(0.96, 0.97, 0.99);
const BORDER_LIGHT = rgb(0.86, 0.89, 0.93);
const WHITE = rgb(1, 1, 1);

function fitText(text: string, font: PDFFont, size: number, maxWidth: number): string {
  const safe = (text || "").replace(/[^\x20-\x7E]/g, " ").trim();
  if (!safe) return "-";
  if (font.widthOfTextAtSize(safe, size) <= maxWidth) return safe;
  let cut = safe.length;
  while (cut > 1 && font.widthOfTextAtSize(`${safe.slice(0, cut)}...`, size) > maxWidth) {
    cut -= 1;
  }
  return `${safe.slice(0, Math.max(1, cut)).trimEnd()}...`;
}

/**
 * Generates an A4 portrait duty roster PDF directly in memory with pdf-lib
 * (sub-20ms, zero headless Chromium dependency) for WhatsApp delivery.
 */
export async function generateRosterPDF(data: RosterPdfData): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const fontRegular = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const companyLabel = (data.companyName?.trim() || "PLETHORA SECURITY").toUpperCase();
  const tableWidth = A4_WIDTH - MARGIN_X * 2;
  const colWidths = {
    date: 120,
    time: 95,
    site: 170,
    post: tableWidth - 120 - 95 - 170,
  };
  const headerBandHeight = 84;
  const rowHeight = 28;
  const tableHeaderHeight = 24;

  const drawHeader = (page: PDFPage, isFirstPage: boolean): number => {
    const bandH = isFirstPage ? headerBandHeight : 44;
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - bandH,
      width: A4_WIDTH,
      height: bandH,
      color: NAVY,
    });
    page.drawRectangle({
      x: 0,
      y: A4_HEIGHT - bandH,
      width: A4_WIDTH,
      height: 3,
      color: AMBER,
    });

    if (isFirstPage) {
      page.drawText(fitText(companyLabel, fontBold, 10, tableWidth - 120), {
        x: MARGIN_X,
        y: A4_HEIGHT - 28,
        size: 10,
        font: fontBold,
        color: AMBER,
      });
      page.drawText("DUTY ROSTER", {
        x: A4_WIDTH - MARGIN_X - fontBold.widthOfTextAtSize("DUTY ROSTER", 14),
        y: A4_HEIGHT - 30,
        size: 14,
        font: fontBold,
        color: WHITE,
      });
      page.drawText(fitText(data.employeeName, fontBold, 16, tableWidth), {
        x: MARGIN_X,
        y: A4_HEIGHT - 52,
        size: 16,
        font: fontBold,
        color: WHITE,
      });
      const meta = `Generated: ${data.generatedAtLabel}  |  Timezone: ${data.timeZoneLabel}  |  Shifts: ${data.shifts.length}`;
      page.drawText(fitText(meta, fontRegular, 9, tableWidth), {
        x: MARGIN_X,
        y: A4_HEIGHT - 70,
        size: 9,
        font: fontRegular,
        color: rgb(0.82, 0.86, 0.92),
      });
      return A4_HEIGHT - bandH - 20;
    }

    page.drawText(fitText(`${companyLabel} - DUTY ROSTER (${data.employeeName})`, fontBold, 10, tableWidth), {
      x: MARGIN_X,
      y: A4_HEIGHT - 27,
      size: 10,
      font: fontBold,
      color: WHITE,
    });
    return A4_HEIGHT - bandH - 18;
  };

  const drawTableHeader = (page: PDFPage, yTop: number): number => {
    page.drawRectangle({
      x: MARGIN_X,
      y: yTop - tableHeaderHeight,
      width: tableWidth,
      height: tableHeaderHeight,
      color: rgb(0.91, 0.93, 0.96),
      borderColor: BORDER_LIGHT,
      borderWidth: 0.75,
    });

    const baselineY = yTop - 16;
    let x = MARGIN_X + 8;
    page.drawText("DATE", { x, y: baselineY, size: 9, font: fontBold, color: NAVY });
    x += colWidths.date;
    page.drawText("TIME", { x, y: baselineY, size: 9, font: fontBold, color: NAVY });
    x += colWidths.time;
    page.drawText("SITE", { x, y: baselineY, size: 9, font: fontBold, color: NAVY });
    x += colWidths.site;
    page.drawText("POST / ASSIGNMENT", { x, y: baselineY, size: 9, font: fontBold, color: NAVY });

    return yTop - tableHeaderHeight;
  };

  let page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
  let cursorY = drawHeader(page, true);

  if (data.shifts.length === 0) {
    page.drawRectangle({
      x: MARGIN_X,
      y: cursorY - 64,
      width: tableWidth,
      height: 64,
      color: ROW_ALT,
      borderColor: BORDER_LIGHT,
      borderWidth: 1,
    });
    page.drawText("No upcoming shifts currently scheduled.", {
      x: MARGIN_X + 16,
      y: cursorY - 37,
      size: 11,
      font: fontBold,
      color: SLATE,
    });
  } else {
    cursorY = drawTableHeader(page, cursorY);

    data.shifts.forEach((shift, idx) => {
      if (cursorY - rowHeight < MARGIN_BOTTOM) {
        page = doc.addPage([A4_WIDTH, A4_HEIGHT]);
        cursorY = drawHeader(page, false);
        cursorY = drawTableHeader(page, cursorY);
      }

      const rowBottom = cursorY - rowHeight;
      page.drawRectangle({
        x: MARGIN_X,
        y: rowBottom,
        width: tableWidth,
        height: rowHeight,
        color: idx % 2 === 1 ? ROW_ALT : WHITE,
        borderColor: BORDER_LIGHT,
        borderWidth: 0.5,
      });

      const textY = rowBottom + 10;
      let x = MARGIN_X + 8;
      page.drawText(fitText(shift.dateLine, fontBold, 9.5, colWidths.date - 12), {
        x,
        y: textY,
        size: 9.5,
        font: fontBold,
        color: TEXT_DARK,
      });
      x += colWidths.date;
      page.drawText(fitText(shift.timeRange, fontRegular, 9.5, colWidths.time - 12), {
        x,
        y: textY,
        size: 9.5,
        font: fontRegular,
        color: TEXT_DARK,
      });
      x += colWidths.time;
      page.drawText(fitText(shift.site, fontRegular, 9.5, colWidths.site - 12), {
        x,
        y: textY,
        size: 9.5,
        font: fontRegular,
        color: TEXT_DARK,
      });
      x += colWidths.site;
      page.drawText(fitText(shift.post, fontRegular, 9.5, colWidths.post - 14), {
        x,
        y: textY,
        size: 9.5,
        font: fontRegular,
        color: SLATE,
      });

      cursorY = rowBottom;
    });
  }

  const pages = doc.getPages();
  pages.forEach((p, idx) => {
    const footerText = `Page ${idx + 1} of ${pages.length}`;
    p.drawText(footerText, {
      x: A4_WIDTH - MARGIN_X - fontRegular.widthOfTextAtSize(footerText, 8),
      y: 18,
      size: 8,
      font: fontRegular,
      color: SLATE,
    });
  });

  const pdfBytes = await doc.save();
  return Buffer.from(pdfBytes);
}
