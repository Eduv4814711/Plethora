"use client";

import { useEffect, useMemo, useState } from "react";
import type { RosterGridRow, RosterShiftCode } from "@/lib/roster-api";
import { CYCLE_LENGTH_PRESETS, MANUAL_SHIFT_CODE_OPTIONS, SHIFT_CODE_COLORS, SHIFT_CODE_OPTIONS } from "@/lib/roster-api";
import {
  expandPatternToCycle,
  parsePatternNotation,
  PATTERN_PRESETS,
} from "@/lib/roster-pattern-utils";

type GuardOption = { id: string; name: string; onSite: boolean };

export function GuardPatternBuilder({
  cycleLengthDays,
  onCycleLengthChange,
  rows,
  availableGuards,
  onApply,
  onApplyAll,
  onAddGuardToSite,
  addingGuard,
  compact = false,
}: {
  cycleLengthDays: number;
  onCycleLengthChange?: (days: number) => void;
  rows: RosterGridRow[];
  availableGuards: GuardOption[];
  onApply: (guardId: string, codes: RosterShiftCode[]) => void;
  onApplyAll?: (codes: RosterShiftCode[]) => void;
  onAddGuardToSite?: (guardId: string) => void;
  addingGuard?: boolean;
  compact?: boolean;
}) {
  const siteGuards = useMemo(
    () =>
      rows.map((r) => ({
        id: r.guardId,
        name: r.guardName,
        onSite: true,
      })),
    [rows]
  );

  const guardsNotOnSite = useMemo(
    () => availableGuards.filter((g) => !siteGuards.some((s) => s.id === g.id)),
    [availableGuards, siteGuards]
  );

  const [selectedGuardId, setSelectedGuardId] = useState(siteGuards[0]?.id ?? "");
  const [sequence, setSequence] = useState<RosterShiftCode[]>(["D", "D", "D", "O", "O", "O"]);
  const [notation, setNotation] = useState("D,D,D,O,O,O");
  const [cycleCodes, setCycleCodes] = useState<RosterShiftCode[]>(() =>
    expandPatternToCycle(["D", "D", "D", "O", "O", "O"], cycleLengthDays)
  );
  const [addGuardId, setAddGuardId] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  useEffect(() => {
    setCycleCodes(expandPatternToCycle(sequence, cycleLengthDays));
  }, [sequence, cycleLengthDays]);

  const cycleShiftOptions = useMemo(
    () => (compact ? MANUAL_SHIFT_CODE_OPTIONS : SHIFT_CODE_OPTIONS).filter((o) => o.code !== "blank"),
    [compact]
  );

  const applyPreset = (codes: RosterShiftCode[]) => {
    setSequence(codes);
    setNotation(codes.map((c) => (c === "blank" ? "—" : c)).join(","));
    onCycleLengthChange?.(codes.length);
    setShowCustom(false);
  };

  const updateCycleDay = (dayIndex: number, code: RosterShiftCode) => {
    setCycleCodes((prev) => prev.map((c, i) => (i === dayIndex ? code : c)));
  };

  const appendCode = (code: RosterShiftCode) => {
    const next = [...sequence, code];
    setSequence(next);
    setNotation(next.map((c) => (c === "blank" ? "—" : c)).join(","));
  };

  const clearSequence = () => {
    setSequence([]);
    setNotation("");
  };

  const handleNotationChange = (value: string) => {
    setNotation(value);
    setSequence(parsePatternNotation(value));
  };

  const handleApply = () => {
    if (!selectedGuardId || cycleCodes.length === 0) return;
    onApply(selectedGuardId, cycleCodes);
  };

  const handleApplyAll = () => {
    if (!onApplyAll || cycleCodes.length === 0) return;
    onApplyAll(cycleCodes);
  };

  if (siteGuards.length === 0 && guardsNotOnSite.length === 0) {
    return (
      <div
        className={`rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50/80 dark:bg-neutral-900/40 text-center text-sm text-neutral-500 ${
          compact ? "px-3 py-4" : "px-4 py-6"
        }`}
      >
        Assign guards to this site, then build a pattern for each guard here.
      </div>
    );
  }

  const rootClass = compact
    ? "min-w-0 w-full max-w-full space-y-3"
    : "rounded-xl border border-orange-200/80 dark:border-orange-900/50 bg-gradient-to-br from-orange-50/60 to-white dark:from-orange-950/20 dark:to-neutral-900/50 p-4 space-y-4";

  const fieldSelectClass = compact
    ? "block w-full min-w-0 max-w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-2 py-1.5 text-xs bg-white dark:bg-neutral-900 overflow-hidden text-ellipsis whitespace-nowrap"
    : "w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1.5 text-xs bg-white dark:bg-neutral-900";

  const addGuardRowClass = compact ? "flex flex-col gap-2 w-full min-w-0" : "flex flex-col gap-2 sm:flex-row";

  return (
    <div className={rootClass}>
      <div>
        <h3 className={`font-semibold text-neutral-900 dark:text-neutral-100 ${compact ? "text-xs" : "text-sm"}`}>
          Pattern builder
        </h3>
        <p className={`text-neutral-500 dark:text-neutral-400 mt-0.5 ${compact ? "text-[11px] leading-snug" : "text-xs"}`}>
          {compact
            ? "Build a repeating sequence and apply it to a guard's row in the roster grid."
            : "Build a repeating shift sequence and apply it to one guard's row in the pattern grid."}
        </p>
      </div>

      {showCustom && onCycleLengthChange && (
        <label className="space-y-1 block">
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Cycle length</span>
          <select
            value={cycleLengthDays}
            onChange={(e) => onCycleLengthChange(Number(e.target.value))}
            className={fieldSelectClass}
          >
            {CYCLE_LENGTH_PRESETS.map((n) => (
              <option key={n} value={n}>
                {n} days
              </option>
            ))}
          </select>
        </label>
      )}

      <div className={`${compact ? "space-y-3 w-full min-w-0" : "grid grid-cols-1 lg:grid-cols-2 gap-4"}`}>
        <label className="space-y-1.5 block min-w-0">
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Guard</span>
          <select
            value={selectedGuardId}
            onChange={(e) => setSelectedGuardId(e.target.value)}
            className={fieldSelectClass}
          >
            <option value="">Select guard…</option>
            {siteGuards.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>

        {guardsNotOnSite.length > 0 && onAddGuardToSite && (
          <div className="space-y-1.5 min-w-0 w-full">
            <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
              Add guard to site
            </span>
            <div className={addGuardRowClass}>
              <select
                value={addGuardId}
                onChange={(e) => setAddGuardId(e.target.value)}
                className={fieldSelectClass}
              >
                <option value="">{compact ? "Select guard…" : "Choose team member…"}</option>
                {guardsNotOnSite.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!addGuardId || addingGuard}
                onClick={() => {
                  if (addGuardId) onAddGuardToSite(addGuardId);
                  setAddGuardId("");
                }}
                className={
                  compact
                    ? "w-full px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                    : "shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                }
              >
                {addingGuard ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">Simple patterns</span>
          <button
            type="button"
            onClick={() => setShowCustom((value) => !value)}
            className="text-[11px] font-medium text-orange-700 hover:underline dark:text-orange-300"
          >
            {showCustom ? "Hide custom" : "Custom"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {PATTERN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              title={preset.description}
              onClick={() => applyPreset(preset.sequence)}
              className="px-2 py-1 text-[10px] font-medium rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:border-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {showCustom && (
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Pattern sequence</span>
          <button
            type="button"
            onClick={clearSequence}
            className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 underline"
          >
            Clear
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {SHIFT_CODE_OPTIONS.filter((o) => o.code !== "blank").map((o) => (
            <button
              key={o.code}
              type="button"
              onClick={() => appendCode(o.code)}
              className="px-2 py-1 text-xs font-semibold rounded-md border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-orange-50 dark:hover:bg-orange-950/40"
              title={`Add ${o.label}`}
            >
              {o.code}
            </button>
          ))}
        </div>
        <input
          type="text"
          value={notation}
          onChange={(e) => handleNotationChange(e.target.value)}
          placeholder="D,D,D,O,O,O or D N O"
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-neutral-900"
        />
        {sequence.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {sequence.map((code, i) => (
              <span
                key={`${code}-${i}`}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold"
              >
                {code === "blank" ? "—" : code}
                <button
                  type="button"
                  aria-label="Remove"
                  onClick={() => {
                    const next = sequence.filter((_, idx) => idx !== i);
                    setSequence(next);
                    setNotation(next.map((c) => (c === "blank" ? "—" : c)).join(","));
                  }}
                  className="text-neutral-400 hover:text-red-600"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
      )}

      <div className="rounded-lg bg-neutral-50 dark:bg-neutral-900/60 border border-neutral-200 dark:border-neutral-700 px-2.5 py-2.5">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[10px] font-semibold text-neutral-600 uppercase tracking-wide dark:text-neutral-400">
            Edit cycle
          </p>
          <p className="text-[10px] text-neutral-400 shrink-0">{cycleLengthDays} days</p>
        </div>
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-0.5 leading-snug">
          Tap a day to pick Day, Night, Off, or other shift.
        </p>
        <div className={`mt-2.5 grid gap-1.5 ${compact ? "grid-cols-4" : "grid-cols-7"}`}>
          {cycleCodes.map((code, dayIndex) => {
            const color = SHIFT_CODE_COLORS[code] ?? SHIFT_CODE_COLORS.blank;
            const label = cycleShiftOptions.find((o) => o.code === code)?.label ?? code;
            return (
              <label key={dayIndex} className="flex min-w-0 flex-col items-stretch gap-0.5">
                <span className="text-center text-[9px] font-medium leading-none text-neutral-400">
                  {dayIndex + 1}
                </span>
                <select
                  value={code}
                  onChange={(e) => updateCycleDay(dayIndex, e.target.value as RosterShiftCode)}
                  className={`h-9 w-full min-w-0 cursor-pointer rounded-md border-0 text-center text-xs font-bold shadow-sm ${color}`}
                  title={`Day ${dayIndex + 1}: ${label}`}
                  aria-label={`Day ${dayIndex + 1}, ${label}`}
                >
                  {cycleShiftOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.code}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-neutral-400">
          <span className="font-medium text-amber-800 dark:text-amber-200">D</span> Day ·{" "}
          <span className="font-medium text-indigo-800 dark:text-indigo-200">N</span> Night ·{" "}
          <span className="font-medium text-neutral-600 dark:text-neutral-300">O</span> Off — repeats every{" "}
          {cycleLengthDays} days
        </p>
      </div>

      <button
        type="button"
        onClick={handleApply}
        disabled={!selectedGuardId || cycleCodes.length === 0}
        className={`w-full font-semibold rounded-lg bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50 ${
          compact ? "px-3 py-2 text-xs" : "sm:w-auto px-5 py-2.5 text-sm"
        }`}
      >
        Apply pattern to guard
      </button>
      {onApplyAll && (
        <button
          type="button"
          onClick={handleApplyAll}
          disabled={cycleCodes.length === 0 || siteGuards.length === 0}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-600 dark:text-neutral-200 dark:hover:bg-neutral-800"
        >
          Apply pattern to all guards
        </button>
      )}
    </div>
  );
}
