"use client";

import type { RosterGridRow, RosterShiftCode } from "@/lib/roster-api";
import { SHIFT_CODE_COLORS } from "@/lib/roster-api";
import { formatCalendarColumnLabel, isDateColumnKey } from "@/lib/roster-pattern-utils";

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

export function RosterCoverageTotals({
  coverageByDay,
  columnKeys,
}: {
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  columnKeys: string[];
}) {
  return (
    <tr className="bg-neutral-50 dark:bg-neutral-900/80 text-[11px] font-medium">
      <td colSpan={2} className="px-2 py-1.5 text-neutral-500 dark:text-neutral-400 sticky left-0 z-10 bg-inherit">
        Coverage
      </td>
      {columnKeys.map((key) => {
        const cov = coverageByDay[key];
        if (!cov) return <td key={key} className="px-1 py-1 text-center">—</td>;
        const dayOk = cov.day >= cov.requiredDay;
        const nightOk = cov.night >= cov.requiredNight;
        return (
          <td key={key} className="px-0.5 py-1 text-center leading-tight">
            <span
              title={`Day: ${cov.day} of ${cov.requiredDay} staffed`}
              className={dayOk ? "block text-emerald-700 dark:text-emerald-400" : "block text-red-700 dark:text-red-300"}
            >
              Day {cov.day}/{cov.requiredDay}
            </span>
            <span
              title={`Night: ${cov.night} of ${cov.requiredNight} staffed`}
              className={nightOk ? "block text-indigo-700 dark:text-indigo-400" : "block text-red-700 dark:text-red-300"}
            >
              Night {cov.night}/{cov.requiredNight}
            </span>
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
  editable,
  shiftOptions,
  savingCellKey,
  onCellChange,
}: {
  rows: RosterGridRow[];
  columnKeys: string[];
  coverageByDay: Record<string, { day: number; night: number; requiredDay: number; requiredNight: number }>;
  editable: boolean;
  shiftOptions: ShiftOption[];
  savingCellKey?: string | null;
  onCellChange?: (guardId: string, colKey: string, shiftCode: RosterShiftCode) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-200 dark:border-neutral-700">
      <table className="w-full min-w-[720px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900">
            <th className="sticky left-0 z-20 bg-neutral-50 dark:bg-neutral-900 px-2 py-2 text-left font-semibold w-10">
              #
            </th>
            <th className="sticky left-10 z-20 bg-neutral-50 dark:bg-neutral-900 px-2 py-2 text-left font-semibold min-w-[10rem]">
              Guard
            </th>
            {columnKeys.map((key) => {
              if (!isDateColumnKey(key)) {
                return (
                  <th key={key} className="px-1 py-2 text-center font-medium text-neutral-600">
                    {key}
                  </th>
                );
              }
              const { weekday, day, month } = formatCalendarColumnLabel(key);
              return (
                <th
                  key={key}
                  className="px-0.5 py-1.5 text-center font-medium text-neutral-600 dark:text-neutral-400 min-w-[2.75rem]"
                >
                  <div className="text-[10px] font-normal text-neutral-400">{weekday}</div>
                  <div className="tabular-nums text-sm">{day}</div>
                  <div className="text-[9px] font-normal text-neutral-400">{month}</div>
                </th>
              );
            })}
            <th className="px-2 py-2 text-left font-medium text-neutral-500 text-[11px]">Totals</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columnKeys.length + 3} className="px-4 py-12 text-center text-neutral-500">
                No guards assigned to this site. Add guards using the dropdown above.
              </td>
            </tr>
          ) : (
            rows.map((row, rowIdx) => (
              <tr
                key={row.guardId}
                className={rowIdx % 2 === 0 ? "" : "bg-neutral-50/50 dark:bg-neutral-900/30"}
              >
                <td className="sticky left-0 z-10 bg-inherit px-2 py-1 text-neutral-400">{rowIdx + 1}</td>
                <td className="sticky left-10 z-10 bg-inherit px-2 py-1 font-medium whitespace-nowrap">
                  {row.guardName}
                </td>
                {columnKeys.map((colKey) => {
                  const cell = findCell(row, colKey);
                  const code = (cell?.shiftCode ?? "blank") as RosterShiftCode;
                  const color = SHIFT_CODE_COLORS[code] ?? SHIFT_CODE_COLORS.blank;
                  const isSaving = savingCellKey === `${row.guardId}:${colKey}`;
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
                <td className="px-2 py-1 text-[11px] text-neutral-500 whitespace-nowrap">
                  {Object.entries(row.totals)
                    .filter(([k, v]) => v > 0 && k !== "blank")
                    .map(([k, v]) => `${SHIFT_LABELS[k as RosterShiftCode]}:${v}`)
                    .join(" ")}
                </td>
              </tr>
            ))
          )}
          {rows.length > 0 && (
            <RosterCoverageTotals coverageByDay={coverageByDay} columnKeys={columnKeys} />
          )}
        </tbody>
      </table>
    </div>
  );
}
