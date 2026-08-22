"use client";

import type { RosterGridRow, RosterShiftCode } from "@/lib/roster-api";
import { SHIFT_CODE_COLORS } from "@/lib/roster-api";
import { formatCalendarColumnLabel, isDateColumnKey } from "@/lib/roster-pattern-utils";
import {
  NO_SHIFT_LABEL,
  shiftCoverageOnDateKey,
  type DateShiftCoverage,
  type ShiftCoverageDays,
} from "@/lib/site-coverage-days";

const SHIFT_LABELS: Record<RosterShiftCode, string> = {
  D: "Day",
  N: "Night",
  O: "Off",
  L: "Leave",
  SL: "Sick",
  TR: "Training",
  SB: "Standby",
  AWOL: "AWOL",
  R: "Replaced",
  blank: "Unassigned",
};

/** Every column is covered unless the site's weekday picker says otherwise. */
const FULLY_COVERED: DateShiftCoverage = { day: true, night: true, anyShift: true };

/**
 * Per-column view of the site's "Days covered" picker. Pattern-mode grids can be keyed by
 * cycle day index rather than a date; those have no weekday to look up, so they stay covered.
 */
export function buildColumnCoverage(
  columnKeys: string[],
  coverageDays?: ShiftCoverageDays
): Record<string, DateShiftCoverage> {
  const byColumn: Record<string, DateShiftCoverage> = {};
  for (const key of columnKeys) {
    byColumn[key] =
      coverageDays && isDateColumnKey(key) ? shiftCoverageOnDateKey(coverageDays, key) : FULLY_COVERED;
  }
  return byColumn;
}

export function RosterCoverageTotals({
  coverageByDay,
  columnKeys,
  columnCoverage,
}: {
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  columnKeys: string[];
  columnCoverage: Record<string, DateShiftCoverage>;
}) {
  return (
    <tr className="bg-security-navy-50 dark:bg-security-navy-900/80 text-[11px] font-medium">
      <td colSpan={2} className="px-2 py-1.5 text-security-navy-500 dark:text-security-navy-400 sticky left-0 z-10 bg-inherit">
        Coverage
      </td>
      {columnKeys.map((key) => {
        const cov = coverageByDay[key];
        if (!cov) return <td key={key} className="px-1 py-1 text-center">—</td>;
        const runs = columnCoverage[key] ?? FULLY_COVERED;
        if (!runs.anyShift) {
          return (
            <td
              key={key}
              className="px-0.5 py-1 text-center leading-tight text-security-navy-400 dark:text-security-navy-500"
              title="This site does not run a day or night shift on this weekday"
            >
              {NO_SHIFT_LABEL}
            </td>
          );
        }
        const dayOk = cov.day >= cov.requiredDay;
        const nightOk = cov.night >= cov.requiredNight;
        return (
          <td key={key} className="px-0.5 py-1 text-center leading-tight">
            {runs.day ? (
              <span
                title={`Day: ${cov.day} of ${cov.requiredDay} staffed`}
                className={dayOk ? "block text-security-emerald-700 dark:text-security-emerald-300" : "block text-red-700 dark:text-red-300"}
              >
                Day {cov.day}/{cov.requiredDay}
              </span>
            ) : (
              <span
                title="No day shift on this weekday"
                className="block text-security-navy-400 dark:text-security-navy-500"
              >
                Day —
              </span>
            )}
            {runs.night ? (
              <span
                title={`Night: ${cov.night} of ${cov.requiredNight} staffed`}
                className={nightOk ? "block text-indigo-700 dark:text-indigo-400" : "block text-red-700 dark:text-red-300"}
              >
                Night {cov.night}/{cov.requiredNight}
              </span>
            ) : (
              <span
                title="No night shift on this weekday"
                className="block text-security-navy-400 dark:text-security-navy-500"
              >
                Night —
              </span>
            )}
          </td>
        );
      })}
      <td />
    </tr>
  );
}

export function cellDisplayCode(code: RosterShiftCode): string {
  return code === "blank" ? "" : SHIFT_LABELS[code];
}

function findCell(row: RosterGridRow, colKey: string) {
  return row.cells.find((c) => c.dateKey === colKey);
}

type ShiftOption = { code: RosterShiftCode; label: string };

export function RosterSpreadsheet({
  rows,
  columnKeys,
  coverageByDay,
  coverageDays,
  editable,
  shiftOptions,
  savingCellKey,
  onCellChange,
  onAddPlaceholderGuard,
  addingPlaceholder = false,
}: {
  rows: RosterGridRow[];
  columnKeys: string[];
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  /** The site's "Days covered" picker. Omit to treat every day as a seven-day site. */
  coverageDays?: ShiftCoverageDays;
  editable: boolean;
  shiftOptions: ShiftOption[];
  savingCellKey?: string | null;
  onCellChange?: (guardId: string, colKey: string, shiftCode: RosterShiftCode) => void;
  onAddPlaceholderGuard?: (type: "unknown" | "reliever") => void;
  addingPlaceholder?: boolean;
}) {
  const columnCoverage = buildColumnCoverage(columnKeys, coverageDays);
  return (
    <div className="overflow-x-auto rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
      <p className="border-b border-security-navy-100 bg-security-navy-50 px-3 py-2 text-xs text-security-navy-500 dark:border-security-navy-700 dark:bg-security-navy-900 md:hidden">
        Swipe sideways to see all days →
      </p>
      {editable && onAddPlaceholderGuard && (
        <div className="flex flex-wrap items-center gap-2 border-b border-security-navy-100 bg-security-navy-50 px-3 py-2 dark:border-security-navy-700 dark:bg-security-navy-900/80">
          <span className="text-xs text-security-navy-500 dark:text-security-navy-400">
            Need a slot before you know who will work?
          </span>
          <button
            type="button"
            disabled={addingPlaceholder}
            onClick={() => onAddPlaceholderGuard("unknown")}
            className="btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-50"
          >
            + Unknown guard
          </button>
          <button
            type="button"
            disabled={addingPlaceholder}
            onClick={() => onAddPlaceholderGuard("reliever")}
            className="btn-secondary px-2.5 py-1 text-[11px] disabled:opacity-50"
          >
            + Reliever slot
          </button>
          <span className="text-[10px] text-security-navy-400">
            Planning only — assign the real guard in attendance/timesheets later.
          </span>
        </div>
      )}
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-security-navy-100 dark:border-security-navy-700 bg-security-navy-50 dark:bg-security-navy-900">
            <th className="sticky left-0 z-20 bg-security-navy-50 dark:bg-security-navy-900 px-2 py-2 text-left font-semibold w-10">
              #
            </th>
            <th className="sticky left-10 z-20 bg-security-navy-50 dark:bg-security-navy-900 px-2 py-2 text-left font-semibold min-w-[10rem]">
              Guard
            </th>
            {columnKeys.map((key) => {
              if (!isDateColumnKey(key)) {
                return (
                  <th key={key} className="px-1 py-2 text-center font-medium text-security-navy-600">
                    {key}
                  </th>
                );
              }
              const { weekday, day, month } = formatCalendarColumnLabel(key);
              const runs = columnCoverage[key] ?? FULLY_COVERED;
              return (
                <th
                  key={key}
                  className={`px-0.5 py-1.5 text-center font-medium min-w-[2.75rem] ${
                    runs.anyShift
                      ? "text-security-navy-600 dark:text-security-navy-400"
                      : "bg-security-navy-50 text-security-navy-400 dark:bg-security-navy-900/60 dark:text-security-navy-500"
                  }`}
                  title={
                    runs.anyShift
                      ? undefined
                      : "This site does not run a shift on this weekday — set in Days covered on the site"
                  }
                >
                  <div className="text-[10px] font-normal text-security-navy-400">{weekday}</div>
                  <div className="tabular-nums text-sm">{day}</div>
                  <div className="text-[9px] font-normal text-security-navy-400">
                    {runs.anyShift ? month : NO_SHIFT_LABEL}
                  </div>
                </th>
              );
            })}
            <th className="px-2 py-2 text-left font-medium text-security-navy-500 text-[11px]">Totals</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnKeys.length + 3} className="px-4 py-12 text-center text-security-navy-500">
                No guards assigned to this site. Add guards using the dropdown above.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr
                key={row.guardId}
                className={rowIdx % 2 === 0 ? "" : "bg-security-navy-50/50 dark:bg-security-navy-900/30"}
              >
                <td className="sticky left-0 z-10 bg-inherit px-2 py-1 text-security-navy-400">{rowIdx + 1}</td>
                <td className="sticky left-10 z-10 bg-inherit px-2 py-1 font-medium whitespace-nowrap">
                  <div className={row.isPlaceholder ? "italic text-security-navy-600 dark:text-security-navy-300" : ""}>
                    {row.guardName}
                  </div>
                  {row.isPlaceholder && (
                    <div className="text-[10px] font-normal text-security-amber-700 dark:text-security-amber-300">
                      {row.placeholderType === "reliever" ? "Reliever TBD" : "Unknown — fill in at attendance"}
                    </div>
                  )}
                </td>
                {columnKeys.map((colKey) => {
                  const cell = findCell(row, colKey);
                  const code = (cell?.shiftCode ?? "blank") as RosterShiftCode;
                  const color = SHIFT_CODE_COLORS[code] ?? SHIFT_CODE_COLORS.blank;
                  const isSaving = savingCellKey === `${row.guardId}:${colKey}`;
                  const runs = columnCoverage[colKey] ?? FULLY_COVERED;
                  // The site runs nothing this weekday, so there is no shift to assign.
                  if (!runs.anyShift) {
                    return (
                      <td key={colKey} className="p-0.5">
                        <div
                          className="flex h-9 items-center justify-center rounded bg-security-navy-50 text-[10px] font-medium text-security-navy-400 dark:bg-security-navy-900/60 dark:text-security-navy-500"
                          title={`${row.guardName} — this site runs no shift on ${colKey}`}
                        >
                          {NO_SHIFT_LABEL}
                        </div>
                      </td>
                    );
                  }
                  return (
                    <td key={colKey} className="p-0.5">
                      {editable && onCellChange ? (
                        <select
                          value={code}
                          disabled={isSaving}
                          onChange={(e) => onCellChange(row.guardId, colKey, e.target.value as RosterShiftCode)}
                          className={`w-full h-9 text-center text-xs font-semibold rounded border-0 cursor-pointer ${color} ${
                            isSaving ? "opacity-60" : ""
                          }`}
                          aria-label={`Shift for ${row.guardName} on ${colKey}: ${SHIFT_LABELS[code]}`}
                          title={`${SHIFT_LABELS[code]} shift`}
                        >
                          {shiftOptions.map((o) => (
                            <option key={o.code} value={o.code}>
                              {SHIFT_LABELS[o.code]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <div
                          className={`h-9 flex items-center justify-center rounded text-xs font-semibold ${color}`}
                        >
                          {cellDisplayCode(code)}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="px-2 py-1 text-[11px] text-security-navy-500 whitespace-nowrap">
                  {Object.entries(row.totals)
                    .filter(([k, v]) => v > 0 && k !== "blank")
                    .map(([k, v]) => `${SHIFT_LABELS[k as RosterShiftCode]}:${v}`)
                    .join(" ")}
                </td>
              </tr>
            ))
          )}
          {rows.length > 0 && (
            <RosterCoverageTotals
              coverageByDay={coverageByDay}
              columnKeys={columnKeys}
              columnCoverage={columnCoverage}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
