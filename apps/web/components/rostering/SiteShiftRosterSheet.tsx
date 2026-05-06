"use client";

import { useState } from "react";
import styles from "./SiteShiftRosterSheet.module.css";
import { downloadSiteMatrixRosterPdf, previewSiteMatrixRosterPdf } from "@/lib/roster-pdf";

export interface MatrixDay {
  date: string;
  weekday: string;
  dayOfMonth: number;
  isSunday: boolean;
}

export interface MatrixRow {
  employeeId: string;
  displayName: string;
  gender: "male" | "female" | null;
  contact: string | null;
  cells: string[];
}

interface SiteShiftRosterSheetProps {
  siteName: string;
  periodLabel: string;
  siteRules: string | null;
  days: MatrixDay[];
  rows: MatrixRow[];
  sites: { id: string; name: string }[];
  activeSiteId: string;
  onSelectSite: (siteId: string) => void;
  /** Shown in PDF footer (e.g. user name / email). */
  pdfGeneratedBy?: string | null;
}

export function SiteShiftRosterSheet({
  siteName,
  periodLabel,
  siteRules,
  days,
  rows,
  sites,
  activeSiteId,
  onSelectSite,
  pdfGeneratedBy,
}: SiteShiftRosterSheetProps) {
  const rulesLines = siteRules?.trim().split(/\n+/).filter(Boolean) ?? [];
  const [pdfError, setPdfError] = useState<string | null>(null);

  const handleDownloadPdf = () => {
    setPdfError(null);
    try {
      downloadSiteMatrixRosterPdf({
        siteName,
        periodLabel,
        siteRules,
        days,
        rows,
        generatedBy: pdfGeneratedBy ?? undefined,
      });
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Could not create PDF");
    }
  };

  const handlePreviewPdf = () => {
    setPdfError(null);
    try {
      const opened = previewSiteMatrixRosterPdf({
        siteName,
        periodLabel,
        siteRules,
        days,
        rows,
        generatedBy: pdfGeneratedBy ?? undefined,
      });
      if (!opened) {
        setPdfError("Pop-up blocked. Allow pop-ups for this site to preview the PDF.");
      }
    } catch (e) {
      setPdfError(e instanceof Error ? e.message : "Could not create PDF");
    }
  };

  return (
    <>
      <div className={`${styles.printActions} ${styles.noPrint}`}>
        <span className={styles.printHint}>
          Download the roster PDF or preview it in a new tab (your browser&apos;s PDF viewer; you can print from there).
        </span>
        <div className={styles.printBtnRow}>
          <button type="button" className={styles.pdfBtn} onClick={handleDownloadPdf}>
            Download PDF
          </button>
          <button type="button" className={styles.printBtn} onClick={handlePreviewPdf}>
            Preview PDF
          </button>
        </div>
        {pdfError && (
          <p className={styles.pdfError} role="alert">
            {pdfError}
          </p>
        )}
      </div>

      <div className={styles.page}>
        <div className={styles.sheet}>
          <header className={styles.rosterHeader}>
            <div className={styles.headerRow}>
              <h1 className={styles.title}>Shift roster</h1>
              <p className={styles.libraryName}>{siteName}</p>
            </div>
            <p className={styles.range}>{periodLabel}</p>
          </header>

          <div className={styles.tableWrap}>
            <table className={styles.table} aria-label="Shift roster">
              <colgroup>
                <col />
                <col />
                {days.map((d) => (
                  <col key={d.date} />
                ))}
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th className={styles.colGender} rowSpan={2}>
                    Gender
                  </th>
                  <th className={styles.colName} rowSpan={2}>
                    Guard
                  </th>
                  {days.map((d) => (
                    <th
                      key={`w-${d.date}`}
                      className={`${styles.colShift} ${d.isSunday ? styles.theadSunday : ""}`}
                      title={d.date}
                    >
                      {d.weekday}
                    </th>
                  ))}
                  <th className={styles.colContact} rowSpan={2}>
                    Contact
                    <br />
                    details
                  </th>
                </tr>
                <tr>
                  {days.map((d) => (
                    <th
                      key={`d-${d.date}`}
                      className={`${styles.colShift} ${styles.dateRow} ${d.isSunday ? styles.theadSunday : ""}`}
                      title={d.date}
                    >
                      {d.dayOfMonth}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.employeeId}>
                    <td className={styles.colGender}>
                      <span
                        className={`${styles.genderMarker} ${
                          row.gender === "male"
                            ? styles.genderMale
                            : row.gender === "female"
                              ? styles.genderFemale
                              : ""
                        }`}
                        aria-label={row.gender ?? "Unknown"}
                      />
                    </td>
                    <td className={styles.colName}>{row.displayName}</td>
                    {row.cells.map((cell, i) => {
                      const sunday = days[i]?.isSunday;
                      return (
                        <td
                          key={`${row.employeeId}-${days[i]?.date}`}
                          className={`${styles.colShift} ${sunday ? styles.sundayCol : ""}`}
                        >
                          {cell}
                        </td>
                      );
                    })}
                    <td className={styles.colContact}>{row.contact ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.footerRow}>
            <div className={styles.legend}>
              <section className={styles.legendSite} aria-labelledby="roster-site-rules-heading">
                <h3 id="roster-site-rules-heading" className={styles.legendSiteTitle}>
                  Site rules
                </h3>
                <div className={styles.legendSiteBody}>
                  {rulesLines.length > 0 ? (
                    rulesLines.map((line, i) => (
                      <p key={i} className={styles.legendSiteLine}>
                        {line}
                      </p>
                    ))
                  ) : (
                    <p className={styles.rulesEmpty}>No site rules set. Edit the site to add roster rules.</p>
                  )}
                </div>
              </section>

              <div className={styles.legendGuide}>
                <section className={styles.guideBlock} aria-labelledby="roster-legend-colour">
                  <h4 id="roster-legend-colour" className={styles.guideBlockTitle}>
                    Colour coding
                  </h4>
                  <div className={styles.legendGrid}>
                    <span className={`${styles.swatch} ${styles.swatchMale}`} aria-hidden />
                    <span className={styles.legendGridLabel}>Male (blue marker in Gender column)</span>
                    <span className={`${styles.swatch} ${styles.swatchFemale}`} aria-hidden />
                    <span className={styles.legendGridLabel}>Female (orange marker in Gender column)</span>
                  </div>
                </section>

                <section className={styles.guideBlock} aria-labelledby="roster-legend-shifts">
                  <h4 id="roster-legend-shifts" className={styles.guideBlockTitle}>
                    Shift letters (day columns)
                  </h4>
                  <ul className={styles.shiftChipList}>
                    <li className={styles.shiftChip}>
                      <span className={styles.shiftChipLetter}>D</span>
                      <span className={styles.shiftChipText}>Day shift</span>
                    </li>
                    <li className={styles.shiftChip}>
                      <span className={styles.shiftChipLetter}>N</span>
                      <span className={styles.shiftChipText}>Night shift</span>
                    </li>
                    <li className={styles.shiftChip}>
                      <span className={styles.shiftChipLetter}>O</span>
                      <span className={styles.shiftChipText}>Off (not rostered this day)</span>
                    </li>
                  </ul>
                </section>

                <section className={styles.guideBlock} aria-labelledby="roster-legend-special">
                  <h4 id="roster-legend-special" className={styles.guideBlockTitle}>
                    Special codes
                  </h4>
                  <div className={styles.specialCodeList}>
                    <div className={styles.legendCodeRow}>
                      <span className={`${styles.swatch} ${styles.swatchReplaced}`} aria-hidden>
                        R
                      </span>
                      <p className={styles.legendDefText}>
                        <span className={styles.legendDefLead}>R — Replaced.</span> The guard who was scheduled on that
                        shift did not arrive, and a replacement was arranged with the controller (another guard took the
                        slot; recorded in Plethora when the shift assignee is changed).
                      </p>
                    </div>
                    <div className={styles.legendCodeRow}>
                      <span className={`${styles.swatch} ${styles.swatchAwol}`} aria-hidden>
                        A
                      </span>
                      <p className={styles.legendDefText}>
                        <span className={styles.legendDefLead}>A — AWOL.</span> The scheduled guard did not report for
                        duty and there was no controller-arranged replacement on record for that shift (shift ended
                        without clock-in).
                      </p>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>

          <ul className={styles.sheetTabs} aria-label="Sites">
            {sites.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className={`${styles.tab} ${s.id === activeSiteId ? styles.tabActive : ""}`}
                  onClick={() => onSelectSite(s.id)}
                >
                  {s.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </>
  );
}
