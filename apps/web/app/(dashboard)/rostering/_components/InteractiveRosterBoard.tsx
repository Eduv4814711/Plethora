"use client";

import { useState } from "react";
import { SHIFT_CODE_COLORS, type RosterPeriodGrid, type RosterShiftCode } from "@/lib/roster-api";
import { ShiftCellActionDrawer, type ShiftCellTarget } from "./ShiftCellActionDrawer";

export interface InteractiveRosterBoardProps {
  grid: RosterPeriodGrid;
  token: string;
  siteId: string;
  canEdit: boolean;
  onUpdated: () => void;
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatDateChip(dateKey: string) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return {
    dayName: WEEKDAY_SHORT[dt.getUTCDay()] ?? "",
    dayNum: String(d).padStart(2, "0"),
  };
}

export function InteractiveRosterBoard({
  grid,
  token,
  siteId,
  canEdit,
  onUpdated,
}: InteractiveRosterBoardProps) {
  const [activeCell, setActiveCell] = useState<ShiftCellTarget | null>(null);

  if (grid.rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-security-navy-300 p-8 text-center">
        <p className="text-sm font-medium text-security-navy-900">
          No shifts scheduled yet for this pay period.
        </p>
        <p className="text-xs text-security-navy-500 mt-1">
          Switch to the <strong>Smart Builder</strong> tab above to generate a compliant schedule in under a minute.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-security-navy-500">
        <span>
          {canEdit
            ? "Click or tap any cell to assign Day, Night, Off, or swap with a ranked reliever."
            : "Read-only view of the published schedule."}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-amber-100 text-amber-900 font-semibold">
            D = Day
          </span>
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-indigo-100 text-indigo-900 font-semibold">
            N = Night
          </span>
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-neutral-100 text-neutral-700 font-semibold">
            O = Off
          </span>
          <span className="inline-flex items-center gap-1 rounded px-2 py-0.5 bg-sky-100 text-sky-900 font-semibold">
            L = Leave
          </span>
        </div>
      </div>

      <div
        role="region"
        tabIndex={0}
        aria-label={`${grid.siteName} interactive roster schedule`}
        className="relative overflow-x-auto rounded-xl border border-security-navy-200 bg-white focus-visible:outline-2"
      >
        <table className="min-w-full border-collapse text-xs">
          <thead className="sticky top-0 z-20 bg-security-navy-50 border-b border-security-navy-200">
            <tr>
              <th
                scope="col"
                className="sticky left-0 z-30 min-w-[180px] bg-security-navy-50 px-3 py-2.5 text-left font-semibold text-security-navy-900 border-r border-security-navy-200"
              >
                Guard
              </th>
              {grid.calendarDays.map((dk) => {
                const chip = formatDateChip(dk);
                const isWeekend = chip.dayName === "Sun" || chip.dayName === "Sat";
                return (
                  <th
                    key={dk}
                    scope="col"
                    className={`min-w-[44px] px-1 py-2 text-center font-medium ${
                      isWeekend
                        ? "text-[var(--accent-signal-deep)]"
                        : "text-security-navy-600"
                    }`}
                  >
                    <div className="text-[10px] uppercase leading-tight">{chip.dayName}</div>
                    <div className="text-xs font-semibold tabular-nums">{chip.dayNum}</div>
                  </th>
                );
              })}
              <th
                scope="col"
                className="min-w-[70px] px-2.5 py-2 text-right font-semibold text-security-navy-700"
              >
                Shifts
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-security-navy-100">
            {grid.rows.map((row) => {
              const workingCount = row.cells.filter((c) => c.shiftCode === "D" || c.shiftCode === "N" || c.shiftCode === "R").length;
              return (
                <tr key={row.guardId} className="hover:bg-security-navy-50/50">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white px-3 py-2 text-left font-medium text-security-navy-900 border-r border-security-navy-200"
                  >
                    <div className="truncate max-w-[165px]">{row.guardName}</div>
                    <div className="text-[10px] text-security-navy-500 font-normal">
                      {row.phone || (row.gender ? row.gender.toUpperCase() : "Scheduled")}
                    </div>
                  </th>

                  {row.cells.map((cell, cIdx) => {
                    const dk = cell.dateKey || grid.calendarDays[cIdx] || "";
                    const code = (cell.shiftCode || "blank") as RosterShiftCode;
                    const colorCls = SHIFT_CODE_COLORS[code] ?? SHIFT_CODE_COLORS.blank;
                    const display = code === "blank" ? "—" : code;
                    return (
                      <td key={`${row.guardId}-${dk}`} className="p-0.5 text-center">
                        <button
                          type="button"
                          disabled={!canEdit || !dk}
                          onClick={() =>
                            dk &&
                            setActiveCell({
                              guardId: row.guardId,
                              guardName: row.guardName,
                              employeeNumber: row.phone || row.guardId.slice(-4),
                              dateKey: dk,
                              currentCode: code,
                              currentShiftType:
                                code === "N" ? "night" : code === "D" || code === "R" ? "day" : "off",
                            })
                          }
                          aria-label={`${row.guardName} on ${dk}: ${display}${canEdit ? ", click to edit" : ""}`}
                          className={`touch-target inline-flex items-center justify-center w-full min-h-[38px] min-w-[38px] rounded-md text-[11px] font-semibold transition-transform ${colorCls} ${
                            canEdit ? "hover:scale-[1.04] cursor-pointer" : "cursor-default"
                          }`}
                        >
                          {display}
                        </button>
                      </td>
                    );
                  })}

                  <td className="px-2.5 py-2 text-right font-semibold tabular-nums text-security-navy-700">
                    {workingCount}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ShiftCellActionDrawer
        open={Boolean(activeCell)}
        onClose={() => setActiveCell(null)}
        token={token}
        siteId={siteId}
        cell={activeCell}
        onSaved={() => {
          setActiveCell(null);
          onUpdated();
        }}
      />
    </div>
  );
}
