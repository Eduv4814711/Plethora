"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { authFetch } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { useConfirmDialog } from "@/components/ui";
import {
  applyManualOverridesBulk,
  addPlaceholderGuardToSite,
  fetchLiveRoster,
  fetchSiteRosterConfig,
  MANUAL_SHIFT_CODE_OPTIONS,
  publishRoster,
  updateSiteAssignedGuards,
  type PublishRosterResponse,
  type RosterGridRow,
  type RosterPeriodGrid,
  type RosterShiftCode,
  type RosterSiteConfig,
} from "@/lib/roster-api";
import { patternDayIndexForDate, shiftCodeForStaggeredPattern } from "@/lib/roster-pattern-utils";
import {
  buildShiftSheetRowsFromRosterGrid,
  downloadPdfBlob,
  rosterExportFilename,
  rosterGridCalendarDays,
} from "@/lib/roster-grid-export";
import { generateShiftRosterSheetPDF } from "@/lib/roster-pdf";
import { RosterSpreadsheet } from "./RosterSpreadsheet";
import { RosterIssuesPanel } from "./RosterIssuesPanel";
import { RosterSheetPreviewModal } from "./RosterSheetPreviewModal";

function recalcRowTotals(cells: { shiftCode: RosterShiftCode }[]) {
  const totals: Record<string, number> = {
    D: 0,
    N: 0,
    O: 0,
    L: 0,
    SL: 0,
    TR: 0,
    blank: 0,
  };
  for (const c of cells) {
    const code = c.shiftCode;
    if (code in totals) totals[code] += 1;
  }
  return totals;
}

function recalcCoverage(
  columnKeys: string[],
  rows: RosterPeriodGrid["rows"],
  requiredDay: number,
  requiredNight: number
) {
  const coverageByDay: RosterPeriodGrid["coverageByDay"] = {};
  for (const key of columnKeys) {
    coverageByDay[key] = { day: 0, night: 0, requiredDay, requiredNight };
  }
  for (const row of rows) {
    for (const cell of row.cells) {
      const key = cell.dateKey;
      if (!key || !coverageByDay[key]) continue;
      if (cell.shiftCode === "D") coverageByDay[key].day += 1;
      if (cell.shiftCode === "N") coverageByDay[key].night += 1;
    }
  }
  return coverageByDay;
}

type EmployeeOption = {
  id: string;
  firstName: string;
  lastName: string;
  status: string;
  employeeType?: string;
  jobRole?: string | null;
};

type PendingOverride = {
  guardId: string;
  rosterDate: string;
  overrideShiftCode: RosterShiftCode;
};

export type RosterDraftState = {
  hasUnsavedChanges: boolean;
  pendingCount: number;
  isSaving: boolean;
  isPublishing: boolean;
  hardIssueCount: number;
  warningCount: number;
  canPublish: boolean;
};

export type PatternBuilderContext = {
  rows: RosterGridRow[];
  availableGuards: { id: string; name: string; onSite: boolean }[];
  cycleLengthDays: number;
  addingGuard: boolean;
};

export type ManualRosteringWorkspaceHandle = {
  saveRoster: () => Promise<void>;
  saveOngoingPattern: () => Promise<void>;
  discardChanges: () => Promise<void>;
  publishRoster: () => Promise<void>;
  applyGuardPattern: (guardId: string, cycleCodes: RosterShiftCode[]) => void;
  applyPatternToAll: (cycleCodes: RosterShiftCode[]) => void;
  addGuardToSite: (guardId: string) => Promise<void>;
  addPlaceholderGuard: (type: "unknown" | "reliever") => Promise<void>;
};

function buildBaselineCells(rows: RosterPeriodGrid["rows"]) {
  const baseline = new Map<string, RosterShiftCode>();
  for (const row of rows) {
    for (const cell of row.cells) {
      if (cell.dateKey) baseline.set(`${row.guardId}:${cell.dateKey}`, cell.shiftCode);
    }
  }
  return baseline;
}

export const ManualRosteringWorkspace = forwardRef<
  ManualRosteringWorkspaceHandle,
  {
    siteId: string;
    periodStart: string;
    periodEnd: string;
    periodLabel: string;
    ongoingMode?: boolean;
    onDraftStateChange?: (state: RosterDraftState) => void;
    onPatternContextChange?: (context: PatternBuilderContext | null) => void;
  }
>(function ManualRosteringWorkspace(
  { siteId, periodStart, periodEnd, periodLabel, ongoingMode = false, onDraftStateChange, onPatternContextChange },
  ref
) {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreateRoster = Boolean(user && hasCapability(user, "/rostering", "create"));
  const canEditRoster = Boolean(user && hasCapability(user, "/rostering", "edit"));
  const canApproveRoster = Boolean(user && hasCapability(user, "/rostering", "approve"));
  const canExportRoster = Boolean(user && hasCapability(user, "/rostering", "export"));
  const canEditSite = Boolean(user && hasCapability(user, "/sites", "edit"));
  const [siteConfig, setSiteConfig] = useState<RosterSiteConfig | null>(null);
  const [grid, setGrid] = useState<RosterPeriodGrid | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingOverride>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [addingGuard, setAddingGuard] = useState(false);
  const [addingPlaceholder, setAddingPlaceholder] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [publishSummary, setPublishSummary] = useState<PublishRosterResponse | null>(null);

  const siteConfigRef = useRef<RosterSiteConfig | null>(null);
  const baselineCellsRef = useRef<Map<string, RosterShiftCode>>(new Map());
  const gridFetchGenRef = useRef(0);
  const pendingChangesRef = useRef<Map<string, PendingOverride>>(new Map());

  useEffect(() => {
    siteConfigRef.current = siteConfig;
  }, [siteConfig]);

  const loadConfig = useCallback(async () => {
    if (!token || !siteId) return;
    try {
      const config = await fetchSiteRosterConfig(token, siteId);
      setSiteConfig(config);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load site config");
    }
  }, [token, siteId]);

  const fetchGrid = useCallback(
    async (opts?: { initialLoad?: boolean; committedChanges?: PendingOverride[] }) => {
      if (!token || !siteId) return;
      const gen = ++gridFetchGenRef.current;
      if (opts?.initialLoad) setLoading(true);
      setError(null);
      try {
        const data = await fetchLiveRoster(token, siteId, periodStart, periodEnd);
        if (gen !== gridFetchGenRef.current) return;
        const committed = new Map(
          (opts?.committedChanges ?? []).map((change) => [
            `${change.guardId}:${change.rosterDate}`,
            change.overrideShiftCode,
          ])
        );
        const rows = data.rows.map((row) => ({
          ...row,
          cells:
            committed.size > 0
              ? row.cells.map((cell) => {
                  if (!cell.dateKey) return cell;
                  const shiftCode = committed.get(`${row.guardId}:${cell.dateKey}`);
                  return shiftCode ? { ...cell, shiftCode } : cell;
                })
              : row.cells,
        })).map((row) => ({
          ...row,
          totals: recalcRowTotals(row.cells),
        }));
        const next = { ...data, rows } as RosterPeriodGrid;
        const cfg = siteConfigRef.current;
        if (cfg) {
          next.coverageByDay = recalcCoverage(
            next.calendarDays,
            rows,
            cfg.rosterDayShiftGuardsRequired,
            cfg.rosterNightShiftGuardsRequired
          );
        }
        baselineCellsRef.current = buildBaselineCells(rows);
        pendingChangesRef.current = new Map();
        setPendingChanges(new Map());
        setGrid(next);
      } catch (e) {
        if (gen === gridFetchGenRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load roster");
        }
      } finally {
        if (gen === gridFetchGenRef.current && opts?.initialLoad) {
          setLoading(false);
        }
      }
    },
    [token, siteId, periodStart, periodEnd]
  );

  useEffect(() => {
    setGrid(null);
    void loadConfig();
  }, [siteId, loadConfig]);

  useEffect(() => {
    void fetchGrid({ initialLoad: true });
  }, [fetchGrid]);

  useEffect(() => {
    if (!token) return;
    authFetch("/employees?limit=200", token)
      .then((r) => r.json())
      .then((d) => setEmployees(d.data ?? []))
      .catch(() => setEmployees([]));
  }, [token]);

  const columnKeys = useMemo(() => grid?.calendarDays ?? [], [grid]);

  const availableGuards = useMemo(
    () =>
      employees
        .filter(
          (e) =>
            (e.employeeType ?? "security") === "security" &&
            ["active", "training", "hired", "reliever"].includes(e.status) &&
            !(e.jobRole ?? "").startsWith("roster_placeholder:")
        )
        .map((e) => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName}`.trim(),
          onSite: siteConfig?.assignedGuardIds.includes(e.id) ?? false,
        })),
    [employees, siteConfig?.assignedGuardIds]
  );

  const handleCellChange = (guardId: string, colKey: string, shiftCode: RosterShiftCode) => {
    if (!canEditRoster) return;
    const cellKey = `${guardId}:${colKey}`;
    const original = baselineCellsRef.current.get(cellKey) ?? "blank";
    setPublishSummary(null);

    setGrid((current) => {
      if (!current) return current;
      const updatedRows = current.rows.map((row) => {
        if (row.guardId !== guardId) return row;
        const cells = row.cells.map((c) => (c.dateKey === colKey ? { ...c, shiftCode } : c));
        return { ...row, cells, totals: recalcRowTotals(cells) };
      });

      const nextGrid = { ...current, rows: updatedRows };
      const cfg = siteConfigRef.current;
      if (cfg) {
        nextGrid.coverageByDay = recalcCoverage(
          current.calendarDays,
          updatedRows,
          cfg.rosterDayShiftGuardsRequired,
          cfg.rosterNightShiftGuardsRequired
        );
      }
      return nextGrid;
    });
    setError(null);

    setPendingChanges((prev) => {
      const next = new Map(prev);
      if (shiftCode === original) {
        next.delete(cellKey);
      } else {
        next.set(cellKey, {
          guardId,
          rosterDate: colKey,
          overrideShiftCode: shiftCode,
        });
      }
      pendingChangesRef.current = next;
      return next;
    });
  };

  const handleSaveRoster = useCallback(async () => {
    const committedChanges = Array.from(pendingChangesRef.current.values());
    if (!token || committedChanges.length === 0 || !canEditRoster) {
      return;
    }
    const changeCount = committedChanges.length;
    setIsSaving(true);
    setError(null);
    try {
      const result = await applyManualOverridesBulk(token, {
        siteId,
        changes: committedChanges.map((change) => ({
          guardId: change.guardId,
          rosterDate: change.rosterDate,
          overrideShiftCode: change.overrideShiftCode,
        })),
      });
      void result;
      pendingChangesRef.current = new Map();
      setPendingChanges(new Map());
      setPublishSummary(null);
      setStatusMsg(`Roster saved (${changeCount} change${changeCount === 1 ? "" : "s"}).`);
      setTimeout(() => setStatusMsg(null), 3000);
      await fetchGrid({ committedChanges });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Failed to save roster";
      setError(errMsg);
    } finally {
      setIsSaving(false);
    }
  }, [token, siteId, fetchGrid, canEditRoster]);

  const handleDiscardChanges = useCallback(async () => {
    if (pendingChangesRef.current.size === 0) return;
    pendingChangesRef.current = new Map();
    setPendingChanges(new Map());
    setPublishSummary(null);
    setStatusMsg("Draft changes discarded.");
    setTimeout(() => setStatusMsg(null), 3000);
    await fetchGrid();
  }, [fetchGrid]);

  const handleSaveOngoingPattern = useCallback(async () => {
    const committedChanges = Array.from(pendingChangesRef.current.values());
    if (!token || committedChanges.length === 0 || !siteConfigRef.current?.activePattern || !canEditRoster) return;
    setIsSaving(true);
    setError(null);
    try {
      await applyManualOverridesBulk(token, {
        siteId,
        changes: committedChanges.map((change) => ({
          ...change,
          doesChangeBasePattern: true,
        })),
      });
      pendingChangesRef.current = new Map();
      setPendingChanges(new Map());
      setPublishSummary(null);
      setStatusMsg("Ongoing schedule updated. Future roster periods will use the new pattern.");
      setTimeout(() => setStatusMsg(null), 5000);
      await loadConfig();
      await fetchGrid();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to update the ongoing schedule");
    } finally {
      setIsSaving(false);
    }
  }, [token, siteId, loadConfig, fetchGrid, canEditRoster]);

  const hardIssueCount = grid?.warnings.filter((warning) => warning.severity === "hard").length ?? 0;
  const warningCount = grid?.warnings.length ?? 0;
  const canPublish = canApproveRoster && !!grid && pendingChanges.size === 0 && hardIssueCount === 0 && !isSaving && !isPublishing;

  const handlePublishRoster = useCallback(async () => {
    if (!token || !grid || !canApproveRoster || pendingChangesRef.current.size > 0 || hardIssueCount > 0) return;
    setIsPublishing(true);
    setError(null);
    try {
      const result = await publishRoster(token, {
        siteId,
        startDate: periodStart,
        endDate: periodEnd,
        replaceExisting: true,
      });
      setPublishSummary(result);
      if (result.success) {
        setStatusMsg(result.message);
        setTimeout(() => setStatusMsg(null), 4000);
      } else {
        setError(result.message);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to publish roster");
    } finally {
      setIsPublishing(false);
    }
  }, [token, grid, hardIssueCount, siteId, periodStart, periodEnd, canApproveRoster]);


  useEffect(() => {
    onDraftStateChange?.({
      hasUnsavedChanges: pendingChanges.size > 0,
      pendingCount: pendingChanges.size,
      isSaving,
      isPublishing,
      hardIssueCount,
      warningCount,
      canPublish,
    });
  }, [pendingChanges, isSaving, isPublishing, hardIssueCount, warningCount, canPublish, onDraftStateChange]);

  const exportSheetRows = useMemo(
    () => (grid ? buildShiftSheetRowsFromRosterGrid(grid) : []),
    [grid]
  );

  const exportCalendarDays = useMemo(
    () => (grid ? rosterGridCalendarDays(grid) : []),
    [grid]
  );

  const exportReady = !!grid && !loading && exportSheetRows.length > 0 && pendingChanges.size === 0;

  const handleDownloadRoster = useCallback(() => {
    if (!grid || !siteConfig || !canExportRoster) return;
    setExporting(true);
    try {
      const blob = generateShiftRosterSheetPDF({
        siteName: siteConfig.name,
        periodLabel,
        days: exportCalendarDays,
        rows: exportSheetRows,
        generatedBy: user?.name,
        rosterSiteRules: siteConfig.rosterSiteRules,
        rosterSheetNotes: siteConfig.rosterSheetNotes,
        rosterDayShiftGender: siteConfig.rosterDayShiftGender,
        rosterNightShiftGender: siteConfig.rosterNightShiftGender,
        rosterDayShiftGuardsRequired: siteConfig.rosterDayShiftGuardsRequired,
        rosterNightShiftGuardsRequired: siteConfig.rosterNightShiftGuardsRequired,
      });
      downloadPdfBlob(blob, rosterExportFilename(siteConfig.name, periodStart));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to download roster");
    } finally {
      setExporting(false);
    }
  }, [
    grid,
    siteConfig,
    periodLabel,
    periodStart,
    exportCalendarDays,
    exportSheetRows,
    user?.name,
    canExportRoster,
  ]);

  const handleAddGuardToSite = async (guardId: string) => {
    if (!token || !siteConfig || !canEditSite) return;
    if (
      pendingChangesRef.current.size > 0 &&
      !(await confirm({
        title: "Discard unsaved changes?",
        message: "Adding a guard reloads this roster period. Your unsaved cell changes will be discarded.",
        confirmLabel: "Discard and add guard",
        danger: true,
      }))
    ) {
      return;
    }
    setAddingGuard(true);
    setError(null);
    try {
      const nextIds = [...new Set([...siteConfig.assignedGuardIds, guardId])];
      await updateSiteAssignedGuards(token, siteId, nextIds);
      await loadConfig();
      await fetchGrid();
      setStatusMsg("Guard added to site.");
      setTimeout(() => setStatusMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add guard");
    } finally {
      setAddingGuard(false);
    }
  };

  const handleAddPlaceholderGuard = async (type: "unknown" | "reliever") => {
    if (!token || !siteConfig || !canCreateRoster) return;
    if (
      pendingChangesRef.current.size > 0 &&
      !(await confirm({
        title: "Discard unsaved changes?",
        message: "Adding a planning slot reloads this roster period. Your unsaved cell changes will be discarded.",
        confirmLabel: "Discard and add slot",
        danger: true,
      }))
    ) {
      return;
    }
    setAddingPlaceholder(true);
    setError(null);
    try {
      const created = await addPlaceholderGuardToSite(token, siteId, type);
      await loadConfig();
      await fetchGrid();
      setStatusMsg(
        `${created.guardName} added for monthly planning — capture the real guard in attendance when known.`
      );
      setTimeout(() => setStatusMsg(null), 5000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add placeholder guard");
    } finally {
      setAddingPlaceholder(false);
    }
  };

  const applyGuardPattern = useCallback(
    (guardId: string, cycleCodes: RosterShiftCode[]) => {
      if (!grid || cycleCodes.length === 0 || !canEditRoster) return;
      const cycleLength = cycleCodes.length;
      const anchorDate = periodStart;

      setGrid((current) => {
        if (!current) return current;
        const updatedRows = current.rows.map((row) => {
          if (row.guardId !== guardId) return row;
          const cells = row.cells.map((cell) => {
            if (!cell.dateKey) return cell;
            const idx = patternDayIndexForDate(anchorDate, cell.dateKey, cycleLength);
            return { ...cell, shiftCode: cycleCodes[idx]! };
          });
          return { ...row, cells, totals: recalcRowTotals(cells) };
        });

        const nextGrid = { ...current, rows: updatedRows };
        const cfg = siteConfigRef.current;
        if (cfg) {
          nextGrid.coverageByDay = recalcCoverage(
            current.calendarDays,
            updatedRows,
            cfg.rosterDayShiftGuardsRequired,
            cfg.rosterNightShiftGuardsRequired
          );
        }
        return nextGrid;
      });
      setError(null);

      const targetRow = grid.rows.find((row) => row.guardId === guardId);
      if (targetRow) {
        setPendingChanges((prev) => {
          const next = new Map(prev);
          for (const cell of targetRow.cells) {
            if (!cell.dateKey) continue;
            const idx = patternDayIndexForDate(anchorDate, cell.dateKey, cycleLength);
            const shiftCode = cycleCodes[idx]!;
            const cellKey = `${guardId}:${cell.dateKey}`;
            const original = baselineCellsRef.current.get(cellKey) ?? "blank";
            if (shiftCode === original) next.delete(cellKey);
            else {
              next.set(cellKey, {
                guardId,
                rosterDate: cell.dateKey,
                overrideShiftCode: shiftCode,
              });
            }
          }
          pendingChangesRef.current = next;
          return next;
        });
      }

      setPublishSummary(null);
      setStatusMsg("Pattern applied to guard row — save roster to keep changes.");
      setTimeout(() => setStatusMsg(null), 4000);
    },
    [grid, periodStart, canEditRoster]
  );

  const applyPatternToAll = useCallback(
    (cycleCodes: RosterShiftCode[]) => {
      if (!grid || cycleCodes.length === 0 || !canEditRoster) return;
      const anchorDate = periodStart;
      const guardIds = new Set(grid.rows.map((row) => row.guardId));

      setGrid((current) => {
        if (!current) return current;
        const updatedRows = current.rows.map((row, guardIndex) => {
          const cells = row.cells.map((cell) => {
            if (!cell.dateKey) return cell;
            const shiftCode = shiftCodeForStaggeredPattern(
              anchorDate,
              cell.dateKey,
              cycleCodes,
              guardIndex,
              current.rows.length
            );
            return { ...cell, shiftCode };
          });
          return { ...row, cells, totals: recalcRowTotals(cells) };
        });

        const nextGrid = { ...current, rows: updatedRows };
        const cfg = siteConfigRef.current;
        if (cfg) {
          nextGrid.coverageByDay = recalcCoverage(
            current.calendarDays,
            updatedRows,
            cfg.rosterDayShiftGuardsRequired,
            cfg.rosterNightShiftGuardsRequired
          );
        }
        return nextGrid;
      });

      setPendingChanges((prev) => {
        const next = new Map(prev);
        for (const [guardIndex, row] of grid.rows.entries()) {
          if (!guardIds.has(row.guardId)) continue;
          for (const cell of row.cells) {
            if (!cell.dateKey) continue;
            const shiftCode = shiftCodeForStaggeredPattern(
              anchorDate,
              cell.dateKey,
              cycleCodes,
              guardIndex,
              grid.rows.length
            );
            const cellKey = `${row.guardId}:${cell.dateKey}`;
            const original = baselineCellsRef.current.get(cellKey) ?? "blank";
            if (shiftCode === original) next.delete(cellKey);
            else {
              next.set(cellKey, {
                guardId: row.guardId,
                rosterDate: cell.dateKey,
                overrideShiftCode: shiftCode,
              });
            }
          }
        }
        pendingChangesRef.current = next;
        return next;
      });

      setPublishSummary(null);
      setError(null);
      setStatusMsg("Staggered pattern applied to all guards — save roster to keep changes.");
      setTimeout(() => setStatusMsg(null), 4000);
    },
    [grid, periodStart, canEditRoster]
  );

  useImperativeHandle(
    ref,
    () => ({
      saveRoster: handleSaveRoster,
      saveOngoingPattern: handleSaveOngoingPattern,
      discardChanges: handleDiscardChanges,
      publishRoster: handlePublishRoster,
      applyGuardPattern,
      applyPatternToAll,
      addGuardToSite: handleAddGuardToSite,
      addPlaceholderGuard: handleAddPlaceholderGuard,
    }),
    [handleSaveRoster, handleSaveOngoingPattern, handleDiscardChanges, handlePublishRoster, applyGuardPattern, applyPatternToAll, handleAddGuardToSite, handleAddPlaceholderGuard]
  );

  useEffect(() => {
    onPatternContextChange?.(
      grid && !loading
        ? {
            rows: grid.rows,
            availableGuards,
            cycleLengthDays: siteConfig?.activePattern?.cycleLengthDays ?? 6,
            addingGuard,
          }
        : null
    );
  }, [grid, loading, availableGuards, siteConfig?.activePattern?.cycleLengthDays, addingGuard, onPatternContextChange]);

  return (
    <div className="space-y-4">
      {siteConfig && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-neutral-50/60 dark:bg-neutral-900/40 px-4 py-3">
          <div>
            <p className="font-medium text-neutral-800 dark:text-neutral-100">{siteConfig.name}</p>
            <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">
              {siteConfig.assignedGuardIds.length} guards assigned · {columnKeys.length} days in period
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {pendingChanges.size > 0 ? (
              <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                {pendingChanges.size} unsaved change{pendingChanges.size === 1 ? "" : "s"} — save before
                distributing
              </p>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 hidden sm:block">
                Assign shifts in the grid, then save when ready
              </p>
            )}
            {canEditRoster && pendingChanges.size > 0 && siteConfig.activePattern && !ongoingMode && (
              <button
                type="button"
                onClick={async () => {
                  if (await confirm({
                    title: "Change the ongoing schedule?",
                    message: "These edits will create a new repeating schedule from the first changed date. Historical roster periods will stay unchanged.",
                    confirmLabel: "Change ongoing schedule",
                    danger: false,
                  })) {
                    void handleSaveOngoingPattern();
                  }
                }}
                disabled={isSaving}
                className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50"
              >
                Change ongoing schedule
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowPreview(true)}
              disabled={!exportReady}
              title={
                pendingChanges.size > 0
                  ? "Save draft before previewing"
                  : !exportSheetRows.length
                    ? "Add guards to preview the roster"
                    : undefined
              }
              className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Preview
            </button>
            {canExportRoster && <button
              type="button"
              onClick={handleDownloadRoster}
              disabled={!exportReady || exporting}
              title={
                pendingChanges.size > 0
                  ? "Save draft before downloading"
                  : !exportSheetRows.length
                    ? "Add guards to download the roster"
                    : undefined
              }
              className="btn-secondary text-xs px-3 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {exporting ? "Preparing…" : "Download PDF"}
            </button>}
            {!exportReady && (
              <p className="basis-full text-[11px] text-neutral-500 dark:text-neutral-400 sm:text-right">
                {pendingChanges.size > 0
                  ? "Save the draft before previewing or downloading."
                  : "Add guards and shifts before sharing the roster."}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 text-[11px]">
        {MANUAL_SHIFT_CODE_OPTIONS.map((o) => (
          <span
            key={o.code}
            className="px-2 py-1 rounded-md bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300"
          >
            <strong>{o.code === "blank" ? "—" : o.code}</strong> {o.label}
          </span>
        ))}
      </div>

      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 dark:bg-red-950/30 px-4 py-3 text-sm text-red-800 dark:text-red-200">
          {error}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          {statusMsg}
        </div>
      )}
      {publishSummary && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            publishSummary.success
              ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
              : "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
          }`}
        >
          <p className="font-semibold">{publishSummary.success ? "Roster published" : "Publish blocked"}</p>
          <p className="mt-1">{publishSummary.message}</p>
          {publishSummary.success && (
            <>
              <p className="mt-1 text-xs opacity-80">
                Published {publishSummary.publishedCount} shifts, replaced {publishSummary.replacedCount}, skipped{" "}
                {publishSummary.skippedCount} non-working entries.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-xs">Next step: capture attendance against these shifts.</span>
                <Link
                  href={`/attendance?siteId=${siteId}&start=${periodStart}&end=${periodEnd}`}
                  className="btn-primary"
                >
                  Capture attendance
                </Link>
              </div>
            </>
          )}
        </div>
      )}

      {grid && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Review roster</p>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Fix red issues before publishing shifts. Amber notes are helpful checks.
              </p>
            </div>
            {pendingChanges.size > 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-800">
                Save draft before review is final
              </span>
            )}
          </div>
          <RosterIssuesPanel warnings={grid.warnings} />
        </section>
      )}

      {canEditSite && availableGuards.some((g) => !g.onSite) && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-600 bg-neutral-50/50 dark:bg-neutral-900/30 p-3">
          <label className="flex-1 min-w-[12rem] space-y-1">
            <span className="text-xs font-medium text-neutral-500">Add guard to this site</span>
            <select
              className="w-full rounded-lg border border-neutral-300 dark:border-neutral-600 px-3 py-2 text-sm bg-white dark:bg-neutral-900"
              defaultValue=""
              onChange={(e) => {
                const id = e.target.value;
                if (id) {
                  void handleAddGuardToSite(id);
                  e.target.value = "";
                }
              }}
              disabled={addingGuard}
            >
              <option value="">Select guard…</option>
              {availableGuards
                .filter((g) => !g.onSite)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      )}

      {loading && !grid ? (
        <div className="h-64 flex items-center justify-center text-neutral-500">Loading roster…</div>
      ) : grid ? (
        <RosterSpreadsheet
          rows={grid.rows}
          columnKeys={columnKeys}
          coverageByDay={grid.coverageByDay}
          editable={canEditRoster}
          shiftOptions={MANUAL_SHIFT_CODE_OPTIONS}
          onCellChange={handleCellChange}
          onAddPlaceholderGuard={canCreateRoster ? (type) => void handleAddPlaceholderGuard(type) : undefined}
          addingPlaceholder={addingPlaceholder}
        />
      ) : (
        <div className="h-64 flex items-center justify-center text-neutral-500">No roster data.</div>
      )}

      {siteConfig && grid && (
        <RosterSheetPreviewModal
          open={showPreview}
          onClose={() => setShowPreview(false)}
          siteName={siteConfig.name}
          periodLabel={periodLabel}
          days={exportCalendarDays}
          rows={exportSheetRows}
          rosterSiteRules={siteConfig.rosterSiteRules}
          rosterSheetNotes={siteConfig.rosterSheetNotes}
          rosterDayShiftGender={siteConfig.rosterDayShiftGender}
          rosterNightShiftGender={siteConfig.rosterNightShiftGender}
          rosterDayShiftGuardsRequired={siteConfig.rosterDayShiftGuardsRequired}
          rosterNightShiftGuardsRequired={siteConfig.rosterNightShiftGuardsRequired}
        />
      )}
      {confirmDialog}
    </div>
  );
});
