"use client";

import styles from "./SiteShiftRosterSheet.module.css";

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
}: SiteShiftRosterSheetProps) {
  const rulesLines = siteRules?.trim().split(/\n+/).filter(Boolean) ?? [];

  return (
    <>
      <div className={`${styles.printActions} ${styles.noPrint}`}>
        <span className={styles.printHint}>Use your browser&apos;s print dialog, then choose &quot;Save as PDF&quot;.</span>
        <button type="button" className={styles.printBtn} onClick={() => window.print()}>
          Print / Save as PDF
        </button>
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
                    Staff
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
              <div className={styles.requirements}>
                <h3 className={styles.requirementsTitle}>Site rules</h3>
                <div className={styles.requirementsBody}>
                  {rulesLines.length > 0 ? (
                    rulesLines.map((line, i) => <p key={i}>{line}</p>)
                  ) : (
                    <p style={{ textTransform: "none", fontWeight: 500, color: "#787671" }}>
                      No site rules set. Edit the site to add roster rules.
                    </p>
                  )}
                </div>
              </div>
              <div className={styles.legendColour}>
                <div className={styles.legendTitle}>Colour codings</div>
                <div className={styles.legendGrid}>
                  <span className={`${styles.swatch} ${styles.swatchMale}`} aria-hidden />
                  <span>Male</span>
                  <span className={`${styles.swatch} ${styles.swatchFemale}`} aria-hidden />
                  <span>Female</span>
                  <span className={`${styles.swatch} ${styles.swatchReplaced}`} aria-hidden>
                    R
                  </span>
                  <span>Replaced</span>
                  <span className={`${styles.swatch} ${styles.swatchAwol}`} aria-hidden>
                    A
                  </span>
                  <span>AWOL</span>
                </div>
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
