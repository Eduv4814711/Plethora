import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";

export interface RotatePagesOptions {
  /** 0-indexed page numbers to rotate. If omitted, rotates all pages. */
  pageIndices?: number[];
  /** Angle to rotate by: 90, 180, or 270 (clockwise). Defaults to 90. */
  angleDegrees?: number;
}

export interface ReorderPagesOptions {
  /** 0-indexed array of page positions. Must include valid page indices without duplicates. */
  pageOrder: number[];
}

export interface DeletePagesOptions {
  /** 0-indexed page numbers to delete. */
  pageIndices: number[];
}

export interface SignatureStampOptions {
  /** 0-indexed page number to place stamp on. Default is last page or 0. */
  pageIndex?: number;
  signerName: string;
  signerRole?: string | null;
  documentTitle?: string;
  notes?: string;
  timestamp?: Date;
  x?: number;
  y?: number;
}

export class PdfManipulationService {
  /**
   * Validates if a buffer is a valid PDF and loads it.
   */
  static async loadPdf(buffer: Buffer): Promise<PDFDocument> {
    try {
      return await PDFDocument.load(buffer, { ignoreEncryption: true });
    } catch (err) {
      throw new Error("INVALID_PDF: The provided file is not a valid or readable PDF document.");
    }
  }

  /**
   * Get metadata and page count for a PDF buffer.
   */
  static async getPdfInfo(buffer: Buffer): Promise<{ pageCount: number; pages: { width: number; height: number; rotation: number }[] }> {
    const pdfDoc = await this.loadPdf(buffer);
    const pageCount = pdfDoc.getPageCount();
    const pages = pdfDoc.getPages().map((page) => {
      const size = page.getSize();
      const rot = page.getRotation().angle;
      return { width: Math.round(size.width), height: Math.round(size.height), rotation: rot };
    });
    return { pageCount, pages };
  }

  /**
   * Rotate specific or all pages in a PDF document.
   */
  static async rotatePages(buffer: Buffer, options: RotatePagesOptions = {}): Promise<Buffer> {
    const pdfDoc = await this.loadPdf(buffer);
    const pages = pdfDoc.getPages();
    const angleDelta = options.angleDegrees ?? 90;
    const targets = new Set(options.pageIndices ?? pages.map((_, i) => i));

    pages.forEach((page, index) => {
      if (targets.has(index)) {
        const currentAngle = page.getRotation().angle;
        page.setRotation(degrees((currentAngle + angleDelta) % 360));
      }
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Reorder pages in a PDF document.
   */
  static async reorderPages(buffer: Buffer, options: ReorderPagesOptions): Promise<Buffer> {
    const pdfDoc = await this.loadPdf(buffer);
    const pageCount = pdfDoc.getPageCount();

    if (options.pageOrder.length !== pageCount) {
      throw new Error(`PAGE_ORDER_MISMATCH: Page order length (${options.pageOrder.length}) does not match document page count (${pageCount}).`);
    }

    const uniqueIndices = new Set(options.pageOrder);
    if (uniqueIndices.size !== pageCount) {
      throw new Error("DUPLICATE_PAGE_INDICES: Page order contains duplicates.");
    }

    for (const idx of options.pageOrder) {
      if (idx < 0 || idx >= pageCount) {
        throw new Error(`INVALID_PAGE_INDEX: Page index ${idx} is out of bounds [0, ${pageCount - 1}].`);
      }
    }

    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(pdfDoc, options.pageOrder);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const pdfBytes = await newDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Delete one or more pages from a PDF. At least one page must remain.
   */
  static async deletePages(buffer: Buffer, options: DeletePagesOptions): Promise<Buffer> {
    const pdfDoc = await this.loadPdf(buffer);
    const pageCount = pdfDoc.getPageCount();
    const toDelete = new Set(options.pageIndices);

    if (toDelete.size >= pageCount) {
      throw new Error("CANNOT_DELETE_ALL_PAGES: A document must contain at least one page.");
    }

    const remainingIndices: number[] = [];
    for (let i = 0; i < pageCount; i++) {
      if (!toDelete.has(i)) {
        remainingIndices.push(i);
      }
    }

    const newDoc = await PDFDocument.create();
    const copiedPages = await newDoc.copyPages(pdfDoc, remainingIndices);
    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    const pdfBytes = await newDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Merges multiple PDF buffers into a single PDF in provided sequence.
   */
  static async mergePdfs(buffers: Buffer[]): Promise<Buffer> {
    if (!buffers.length) {
      throw new Error("NO_BUFFERS: At least one PDF buffer must be provided to merge.");
    }
    if (buffers.length === 1) {
      return buffers[0]!;
    }

    const mergedDoc = await PDFDocument.create();

    for (const buf of buffers) {
      const sourceDoc = await this.loadPdf(buf);
      const pageIndices = sourceDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(sourceDoc, pageIndices);
      for (const page of copiedPages) {
        mergedDoc.addPage(page);
      }
    }

    const pdfBytes = await mergedDoc.save();
    return Buffer.from(pdfBytes);
  }

  /**
   * Apply an electronic signature stamp / verification seal onto a PDF page.
   * Note: This is an electronic signature mark/audit stamp, not a cryptographic digital certificate.
   */
  static async applySignatureStamp(buffer: Buffer, options: SignatureStampOptions): Promise<Buffer> {
    const pdfDoc = await this.loadPdf(buffer);
    const pageCount = pdfDoc.getPageCount();
    const pageIdx = options.pageIndex !== undefined && options.pageIndex >= 0 && options.pageIndex < pageCount
      ? options.pageIndex
      : pageCount - 1; // Default to last page

    const page = pdfDoc.getPage(pageIdx);
    const { width: pageWidth, height: pageHeight } = page.getSize();

    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const stampWidth = 240;
    const stampHeight = 68;
    const margin = 20;

    // Default position: bottom-right
    const x = options.x !== undefined ? Math.max(0, Math.min(pageWidth - stampWidth, options.x)) : pageWidth - stampWidth - margin;
    const y = options.y !== undefined ? Math.max(0, Math.min(pageHeight - stampHeight, options.y)) : margin + 10;

    // Background container
    page.drawRectangle({
      x,
      y,
      width: stampWidth,
      height: stampHeight,
      color: rgb(0.97, 0.98, 1.0), // Very light navy/blue
      borderColor: rgb(0.08, 0.16, 0.32), // Deep navy
      borderWidth: 1.5,
    });

    // Header bar
    page.drawRectangle({
      x,
      y: y + stampHeight - 16,
      width: stampWidth,
      height: 16,
      color: rgb(0.08, 0.16, 0.32),
    });

    page.drawText("PLETHORA ELECTRONIC SIGNATURE", {
      x: x + 8,
      y: y + stampHeight - 12,
      size: 8,
      font: fontBold,
      color: rgb(1, 1, 1),
    });

    const dateStr = (options.timestamp ?? new Date()).toISOString().replace("T", " ").slice(0, 19) + " UTC";

    page.drawText(`Signed by: ${options.signerName}`, {
      x: x + 8,
      y: y + 36,
      size: 8.5,
      font: fontBold,
      color: rgb(0.1, 0.15, 0.25),
    });

    if (options.signerRole) {
      page.drawText(`Role: ${options.signerRole}`, {
        x: x + 8,
        y: y + 24,
        size: 7.5,
        font: fontRegular,
        color: rgb(0.25, 0.3, 0.4),
      });
    }

    page.drawText(`Timestamp: ${dateStr}`, {
      x: x + 8,
      y: y + 12,
      size: 7,
      font: fontRegular,
      color: rgb(0.35, 0.4, 0.5),
    });

    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
