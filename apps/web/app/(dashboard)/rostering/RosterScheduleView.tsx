"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { fetchCurrentPayPeriod, fetchPayPeriods, type PayPeriodOption } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
import { fetchLiveRoster, type RosterPeriodGrid, type RosterShiftCode } from "@/lib/roster-api";

type ShiftFilter = "all" | "day" | "night";

const SHIFT_LABELS: Record<RosterShiftCode, string> = {
  D: "Day shift", N: "Night shift", O: "Off", L: "Approved leave", SL: "Sick leave",
  TR: "Training", SB: "Standby", AWOL: "Absent", R: "Replacement", blank: "Unassigned",
};

function shiftClass(code: RosterShiftCode): string {
  if (code === "D") return "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200";
  if (code === "N") return "bg-indigo-100 text-indigo-900 dark:bg-indigo-950/50 dark:text-indigo-200";
  if (code === "L" || code === "SL") return "bg-blue-100 text-blue-900 dark:bg-blue-950/50 dark:text-blue-200";
  if (code === "TR") return "bg-purple-100 text-purple-900 dark:bg-purple-950/50 dark:text-purple-200";
  if (code === "O") return "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400";
  return "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300";
}

function dateLabel(value: string, long = false): string {
  return new Intl.DateTimeFormat("en-ZA", {
    weekday: long ? "long" : "short",
    day: "numeric",
    month: "short",
    year: long ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

export function RosterScheduleView({ siteId, calendarId }: { siteId: string; calendarId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [periods, setPeriods] = useState<PayPeriodOption[]>([]);
  const [period, setPeriod] = useState<PayPeriodOption | null>(null);
  const [grid, setGrid] = useState<RosterPeriodGrid | null>(null);
  const [filter, setFilter] = useState<ShiftFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestedPeriodKey = searchParams.get("period");

  useEffect(() => {
    if (!token || !calendarId) return;
    let active = true;
    setLoading(true); setError(null);
    Promise.all([
      fetchCurrentPayPeriod(token, { calendarId }),
      fetchPayPeriods(token, { before: 12, after: 6, calendarId }),
    ]).then(([current, options]) => {
      if (!active) return;
      setPeriods(options);
      const selected = options.find((item) => item.periodKey === requestedPeriodKey) ?? current;
      setPeriod(selected);
      if (selected.periodKey !== requestedPeriodKey) {
        router.replace(`/rostering/sites/${siteId}?tab=schedule&period=${encodeURIComponent(selected.periodKey)}`);
      }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load roster periods."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [calendarId, requestedPeriodKey, router, siteId, token]);

  useEffect(() => {
    if (!token || !period) return;
    let active = true;
    setLoading(true); setError(null);
    fetchLiveRoster(token, siteId, period.periodStart, period.periodEnd, true)
      .then((next) => { if (active) setGrid(next); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load this schedule."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [period, siteId, token]);

  const today = new Date().toISOString().slice(0, 10);
  const filteredRows = useMemo(() => {
    if (!grid || filter === "all") return grid?.rows ?? [];
    const code = filter === "day" ? "D" : "N";
    return grid.rows.filter((row) => row.cells.some((cell) => cell.shiftCode === code));
  }, [filter, grid]);

  const mobileDays = useMemo(() => (grid?.calendarDays ?? []).map((date) => {
    const assignments = grid!.rows.flatMap((row) => {
      const cell = row.cells.find((item) => item.dateKey === date);
      if (!cell || cell.shiftCode === "O" || cell.shiftCode === "blank") return [];
      if (filter === "day" && cell.shiftCode !== "D") return [];
      if (filter === "night" && cell.shiftCode !== "N") return [];
      return [{ row, cell }];
    });
    const offCount = grid!.rows.filter((row) => row.cells.find((item) => item.dateKey === date)?.shiftCode === "O").length;
    return { date, assignments, offCount };
  }), [filter, grid]);

  const selectPeriod = (next: PayPeriodOption) => {
    router.replace(`/rostering/sites/${siteId}?tab=schedule&period=${encodeURIComponent(next.periodKey)}`);
  };
  const shiftPeriod = (direction: -1 | 1) => {
    if (!period) return;
    const index = periods.findIndex((item) => item.periodKey === period.periodKey);
    const next = periods[index + direction];
    if (next) selectPeriod(next);
  };

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h2 className="text-lg font-semibold text-neutral-900 dark:text-white">Published schedule</h2><p className="mt-1 text-sm text-neutral-500">View the roster in plain language. Use Overview for changes and replacements.</p></div>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <label><span className="block text-xs font-medium text-neutral-500">Roster period</span><select value={period?.periodKey ?? ""} onChange={(event) => { const next = periods.find((item) => item.periodKey === event.target.value); if (next) selectPeriod(next); }} className="input-modern mt-1 w-full sm:w-64">{periods.map((item) => <option key={item.periodKey} value={item.periodKey}>{item.rosterLabel}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => shiftPeriod(-1)} className="btn-secondary">← Previous</button><button type="button" onClick={() => shiftPeriod(1)} className="btn-secondary">Next →</button></div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter roster by shift">
          {([['all','All assignments'],['day','Day shifts'],['night','Night shifts']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} className={`rounded-lg px-3 py-2 text-sm font-medium ${filter === id ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "border border-neutral-200 bg-white text-neutral-700 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"}`}>{label}</button>)}
        </div>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">{error}</div>}
      {loading && <div className="h-72 animate-pulse rounded-2xl bg-neutral-100 dark:bg-neutral-800" />}

      {!loading && grid && <>
        <div className="space-y-3 md:hidden">
          {mobileDays.map((day) => <article key={day.date} className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-neutral-900 ${day.date === today ? "border-orange-400 ring-2 ring-orange-100 dark:border-orange-700 dark:ring-orange-900/40" : "border-neutral-200 dark:border-neutral-700"}`}><div className="flex items-center justify-between gap-3"><h3 className="font-semibold text-neutral-900 dark:text-white">{dateLabel(day.date, true)}</h3>{day.date === today && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[11px] font-semibold text-orange-800 dark:bg-orange-950/40 dark:text-orange-300">Today</span>}</div><div className="mt-3 space-y-2">{day.assignments.length === 0 ? <p className="text-sm text-neutral-500">No working assignments for this filter.</p> : day.assignments.map(({ row, cell }) => <div key={`${row.guardId}:${day.date}`} className="flex items-start justify-between gap-3 rounded-xl bg-neutral-50 px-3 py-2 dark:bg-neutral-800/60"><div><p className="text-sm font-medium text-neutral-900 dark:text-white">{row.guardName}</p>{cell.source && cell.source !== "pattern" && <p className="mt-0.5 text-[11px] font-medium text-orange-700 dark:text-orange-300">Exception · {cell.source.replaceAll("_", " ")}</p>}</div><span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-semibold ${shiftClass(cell.shiftCode)}`}>{SHIFT_LABELS[cell.shiftCode]}</span></div>)}</div>{filter === "all" && day.offCount > 0 && <p className="mt-3 text-xs text-neutral-500">{day.offCount} guard{day.offCount === 1 ? "" : "s"} off</p>}</article>)}
        </div>

        <div className="hidden overflow-x-auto rounded-2xl border border-neutral-200 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900 md:block">
          <table className="min-w-max border-collapse text-sm"><thead><tr className="border-b border-neutral-200 bg-neutral-50 text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900"><th className="sticky left-0 z-20 min-w-52 bg-neutral-50 px-4 py-3 text-left font-semibold dark:bg-neutral-900">Guard</th>{grid.calendarDays.map((date) => <th key={date} className={`min-w-24 px-2 py-3 text-center font-medium ${date === today ? "bg-orange-50 text-orange-800 dark:bg-orange-950/30 dark:text-orange-300" : ""}`}><span className="block text-xs">{dateLabel(date)}</span>{date === today && <span className="mt-1 block text-[10px] font-semibold uppercase">Today</span>}</th>)}</tr></thead><tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">{filteredRows.map((row) => <tr key={row.guardId}><td className="sticky left-0 z-10 bg-white px-4 py-3 font-medium text-neutral-900 dark:bg-neutral-900 dark:text-white">{row.guardName}</td>{grid.calendarDays.map((date) => { const cell = row.cells.find((item) => item.dateKey === date); const code = cell?.shiftCode ?? "blank"; const hidden = filter === "day" ? code !== "D" : filter === "night" ? code !== "N" : false; return <td key={date} className={`px-1.5 py-2 text-center ${date === today ? "bg-orange-50/50 dark:bg-orange-950/10" : ""}`}>{hidden ? <span className="text-neutral-300">—</span> : <span title={cell?.source && cell.source !== "pattern" ? `Exception: ${cell.source}` : undefined} className={`inline-flex min-w-20 items-center justify-center rounded-lg px-2 py-1.5 text-xs font-semibold ${shiftClass(code)} ${cell?.source && cell.source !== "pattern" ? "ring-2 ring-orange-300" : ""}`}>{SHIFT_LABELS[code]}</span>}</td>; })}</tr>)}</tbody></table>
        </div>
      </>}
    </section>
  );
}
