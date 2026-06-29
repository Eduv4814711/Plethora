"use client";

import type { ReactNode } from "react";
import { format } from "date-fns";
import type { ShiftSheetRow } from "@/lib/shift-sheet-matrix";
import { formatPhoneForDisplay } from "@/lib/phone-format";
import { rosterSiteRulesLines } from "@/lib/roster-site-rules-defaults";

export type { ShiftSheetRow } from "@/lib/shift-sheet-matrix";

type SiteTab = { id: string; name: string };

export function ShiftRosterSheet({
  siteName,
  periodLabel,
  days,
  rows,
  sites,
  selectedSiteId,
  onSiteTabChange,
  rosterSiteRules,
  rosterSheetNotes,
  rosterDayShiftGender,
  rosterNightShiftGender,
  rosterDayShiftGuardsRequired,
  rosterNightShiftGuardsRequired,
}: {
  siteName: string;
  periodLabel: string;
  days: Date[];
  rows: ShiftSheetRow[];
  sites: SiteTab[];
  selectedSiteId: string;
  onSiteTabChange: (siteId: string) => void;
  rosterSiteRules?: string | null;
  rosterSheetNotes?: string | null;
  rosterDayShiftGender?: string | null;
  rosterNightShiftGender?: string | null;
  rosterDayShiftGuardsRequired?: number | null;
  rosterNightShiftGuardsRequired?: number | null;
}) {
  const sortedSites = [...sites].sort((a, b) => a.name.localeCompare(b.name));
  const rulesDisplay = rosterSiteRulesLines(rosterSiteRules, rosterDayShiftGender, rosterNightShiftGender, {
    rosterDayShiftGuardsRequired,
    rosterNightShiftGuardsRequired,
  });
  const notesTrimmed = rosterSheetNotes?.trim() ?? "";

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="shift-roster-sheet-root mx-auto w-full max-w-[1328px] pb-2">
        <div className="flex flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-md dark:border-neutral-700 dark:bg-neutral-950 print:rounded-none print:border-0 print:shadow-none">
          <header className="relative shrink-0 border-b border-neutral-200 bg-white px-4 py-5 dark:border-neutral-700 dark:bg-neutral-950 md:px-6 print:border-neutral-300">
            <div
              className="pointer-events-none absolute left-0 right-0 top-0 h-[3px] bg-gradient-to-r from-orange-700 via-orange-500 to-orange-600"
              aria-hidden
            />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <h2 className="text-base font-semibold uppercase tracking-wide text-neutral-900 dark:text-neutral-100 sm:text-lg">
                Shift roster
              </h2>
              <p className="text-base font-semibold uppercase tracking-wide text-neutral-900 dark:text-neutral-100 sm:text-right">
                {siteName}
              </p>
            </div>
            <p className="mt-4 text-center text-sm font-semibold uppercase tracking-widest text-neutral-600 dark:text-neutral-400">
              {periodLabel}
            </p>
          </header>

          <div className="overflow-x-auto px-4 pb-5 pt-0 dark:[scrollbar-color:theme(colors.neutral.600)_theme(colors.neutral.900)] md:px-6 print:overflow-visible print:px-0 print:pb-2">
            <table className="roster-sheet-table w-full min-w-[720px] table-fixed border-collapse text-[13px] text-neutral-900 dark:text-neutral-100 print:text-black">
              <colgroup>
                <col className="w-[3.75rem]" />
                <col className="w-[12rem]" />
                {days.map((d) => (
                  <col key={format(d, "yyyy-MM-dd")} />
                ))}
                <col className="w-[7.75rem]" />
              </colgroup>
              <thead>
                <tr>
                  <th
                    scope="col"
                    className="border border-neutral-400 bg-neutral-50 px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider dark:border-neutral-600 dark:bg-neutral-900 print:bg-neutral-100"
                  >
                    Gender
                  </th>
                  <th
                    scope="col"
                    className="border border-neutral-400 bg-neutral-50 px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider dark:border-neutral-600 dark:bg-neutral-900 print:bg-neutral-100"
                  >
                    Staff
                  </th>
                  {days.map((d) => {
                    const isSun = d.getDay() === 0;
                    return (
                      <th
                        key={format(d, "yyyy-MM-dd")}
                        scope="col"
                        className={`col-shift border border-neutral-400 px-0.5 py-2 text-center text-[9px] font-semibold uppercase leading-tight dark:border-neutral-600 print:border-neutral-500 ${
                          isSun
                            ? "bg-amber-200/90 text-neutral-900 dark:bg-amber-300/40 dark:text-neutral-100 print:bg-amber-100"
                            : "bg-neutral-50 dark:bg-neutral-900 print:bg-neutral-100"
                        }`}
                      >
                        <span className="block">{format(d, "EEE")}</span>
                      </th>
                    );
                  })}
                  <th
                    scope="col"
                    className="border border-neutral-400 bg-neutral-50 px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wider dark:border-neutral-600 dark:bg-neutral-900 print:bg-neutral-100"
                  >
                    Contact
                  </th>
                </tr>
                <tr>
                  <th
                    className="border border-neutral-400 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 print:bg-neutral-100"
                    colSpan={2}
                  />
                  {days.map((d) => {
                    const isSun = d.getDay() === 0;
                    return (
                      <th
                        key={`d-${format(d, "yyyy-MM-dd")}`}
                        className={`col-shift border border-neutral-400 px-0.5 py-1 text-[10px] font-bold tabular-nums dark:border-neutral-600 print:border-neutral-500 ${
                          isSun
                            ? "bg-amber-200/90 dark:bg-amber-300/40 print:bg-amber-100"
                            : "bg-neutral-50 dark:bg-neutral-900 print:bg-neutral-100"
                        }`}
                      >
                        {format(d, "d")}
                      </th>
                    );
                  })}
                  <th className="border border-neutral-400 bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 print:bg-neutral-100" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={days.length + 3}
                      className="border border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-600 dark:text-neutral-400"
                    >
                      No shifts in this period for this site.
                    </td>
                  </tr>
                ) : (
                  rows.map((row, ri) => (
                    <tr
                      key={row.employeeId}
                      className={
                        ri % 2 === 0
                          ? "bg-white dark:bg-neutral-950 print:bg-white"
                          : "bg-neutral-50/90 dark:bg-neutral-900/50 print:bg-neutral-50"
                      }
                    >
                      <td className="col-gender border border-neutral-300 px-2 py-2 text-center align-middle dark:border-neutral-600 print:border-neutral-400">
                        <GenderMarker gender={row.gender} />
                      </td>
                      <td className="col-name border border-neutral-300 px-3 py-2 text-left text-[13px] font-semibold dark:border-neutral-600 print:border-neutral-400">
                        {row.firstName} {row.lastName}
                      </td>
                      {row.cells.map((cell, i) => {
                        const d = days[i]!;
                        const isSun = d.getDay() === 0;
                        return (
                          <td
                            key={`${row.employeeId}-${format(d, "yyyy-MM-dd")}`}
                            className={`col-shift border border-neutral-300 px-0.5 py-2 text-center text-[11px] font-bold tabular-nums dark:border-neutral-600 print:border-neutral-400 ${
                              isSun ? "bg-amber-100/80 dark:bg-amber-900/25 print:bg-amber-50" : ""
                            } ${cellTone(cell)}`}
                          >
                            {cell}
                          </td>
                        );
                      })}
                      <td className="col-contact border border-neutral-300 px-2 py-2 text-center text-[11px] font-medium text-neutral-600 dark:border-neutral-600 dark:text-neutral-400 print:border-neutral-400 print:text-neutral-700">
                        {formatPhoneForDisplay(row.phone) || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <footer className="flex flex-col gap-4 border-t border-neutral-200 bg-neutral-50/90 px-4 py-5 dark:border-neutral-700 dark:bg-neutral-900/40 md:flex-row md:flex-wrap md:items-start md:gap-6 md:px-6 print:border-neutral-300 print:bg-neutral-100">
            <div className="min-w-0 flex-1 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-600 dark:bg-neutral-950 print:bg-white">
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Legend
              </p>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-300 print:text-neutral-800">
                <LegendSwatch className="bg-orange-100 text-orange-900 border-orange-300">D</LegendSwatch>
                <span>Day shift</span>
                <LegendSwatch className="bg-slate-200 text-slate-900 border-slate-400">N</LegendSwatch>
                <span>Night shift</span>
                <LegendSwatch className="bg-neutral-100 text-neutral-500 border-neutral-300">O</LegendSwatch>
                <span>Off</span>
                <LegendSwatch className="bg-blue-600 text-white">M</LegendSwatch>
                <span>Male</span>
                <LegendSwatch className="bg-orange-500 text-black">F</LegendSwatch>
                <span>Female</span>
                <LegendSwatch className="bg-[#0a1530] text-red-500">R</LegendSwatch>
                <span>Replaced</span>
                <LegendSwatch className="bg-red-600 text-neutral-900">A</LegendSwatch>
                <span>AWOL</span>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-3 md:max-w-xl">
              <div className="border-l-4 border-red-500 bg-red-50/60 px-4 py-3 dark:bg-red-950/30 print:bg-red-50">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                  Site rules
                </p>
                <div className="mt-2 space-y-1.5 text-xs font-semibold leading-snug text-red-700 dark:text-red-300 print:text-red-800">
                  {rulesDisplay.map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              </div>
              {notesTrimmed ? (
                <div className="rounded-xl border border-neutral-200 bg-white px-4 py-3 dark:border-neutral-600 dark:bg-neutral-950 print:bg-white">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                    Roster notes
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-xs font-medium leading-relaxed text-neutral-700 dark:text-neutral-300 print:text-neutral-800">
                    {notesTrimmed}
                  </p>
                </div>
              ) : null}
            </div>
          </footer>

          <ul className="m-0 flex list-none flex-wrap items-end gap-0 border-t border-neutral-300 bg-gradient-to-b from-neutral-200/80 to-neutral-300/90 px-4 dark:border-neutral-600 dark:from-neutral-800 dark:to-neutral-900 md:px-6 print:hidden">
            {sortedSites.map((s) => {
              const active = s.id === selectedSiteId;
              return (
                <li key={s.id} className="mb-0 mr-0.5">
                  <button
                    type="button"
                    onClick={() => onSiteTabChange(s.id)}
                    className={`rounded-t-md border border-b-0 border-neutral-400 px-3.5 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors dark:border-neutral-600 ${
                      active
                        ? "relative z-[1] -mb-px border-b-0 bg-white pb-2.5 text-neutral-900 shadow-[0_1px_0_0_white] dark:bg-neutral-950 dark:text-neutral-100 dark:shadow-[0_1px_0_0_theme(colors.neutral.950)]"
                        : "bg-white/45 text-neutral-500 hover:text-neutral-800 dark:bg-neutral-800/40 dark:text-neutral-400 dark:hover:text-neutral-200"
                    }`}
                  >
                    {active && (
                      <span className="absolute left-0 right-0 top-0 h-[3px] rounded-t-md bg-orange-500" aria-hidden />
                    )}
                    <span className={active ? "relative" : ""}>{s.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </>
  );
}

function LegendSwatch({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex h-5 w-[26px] items-center justify-center rounded border border-neutral-400 text-[11px] font-bold shadow-sm dark:border-neutral-500 ${className}`}
    >
      {children}
    </span>
  );
}

function GenderMarker({ gender }: { gender: string | null | undefined }) {
  const g = (gender ?? "").trim().toUpperCase();
  const isFemale = g === "F" || g.startsWith("F");
  const isMale = g === "M" || g.startsWith("M");
  if (isFemale) {
    return (
      <span
        className="mx-auto inline-flex h-5 w-[26px] items-center justify-center rounded border border-black/10 text-[11px] font-bold text-black shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 bg-orange-500"
        title="Female"
        aria-label="Female"
      >
        F
      </span>
    );
  }
  if (isMale) {
    return (
      <span
        className="mx-auto inline-flex h-5 w-[26px] items-center justify-center rounded border border-black/10 text-[11px] font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35)] dark:border-white/10 bg-blue-600"
        title="Male"
        aria-label="Male"
      >
        M
      </span>
    );
  }
  return (
    <span
      className="mx-auto block h-4 w-4 rounded border border-dashed border-neutral-400 bg-neutral-100 dark:border-neutral-500 dark:bg-neutral-800"
      title="Gender not set"
      aria-label="Gender not set"
    />
  );
}

function cellTone(cell: string): string {
  if (cell === "N") return "text-slate-800 dark:text-slate-200 print:text-neutral-900";
  if (cell === "D") return "text-orange-900 dark:text-orange-200 print:text-neutral-900";
  if (cell === "L") return "text-sky-800 dark:text-sky-300 print:text-neutral-900";
  if (cell === "SL") return "text-rose-800 dark:text-rose-300 print:text-neutral-900";
  if (cell === "TR") return "text-violet-800 dark:text-violet-300 print:text-neutral-900";
  if (cell === "AWOL" || cell === "R") return "text-red-800 dark:text-red-300 print:text-neutral-900";
  if (!cell) return "text-neutral-300 dark:text-neutral-600 print:text-neutral-400";
  return "text-neutral-500 dark:text-neutral-400 print:text-neutral-600";
}

const PRINT_STYLES = `
@page { size: A4 landscape; margin: 10mm; }
@media print {
  .shift-roster-sheet-root { max-width: none !important; }
  .roster-sheet-table { min-width: 0 !important; }
}
`;
