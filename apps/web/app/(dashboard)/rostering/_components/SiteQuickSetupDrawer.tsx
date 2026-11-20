"use client";

import { useEffect, useRef, useState } from "react";
import {
  getRosterFrameworks,
  updateSiteRosterSetup,
  type SaSecurityFrameworkDefinition,
  type SaSecurityFrameworkId,
} from "@/lib/roster-api";

export interface SiteQuickSetupGuardOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  status: string;
  psiraGrade?: string | null;
}

export interface SiteQuickSetupDrawerProps {
  open: boolean;
  onClose: () => void;
  token: string;
  siteId: string;
  siteName: string;
  initialFramework?: string | null;
  initialObBookMode?: string | null;
  initialPsiraMode?: string | null;
  initialMealPaid?: boolean;
  initialDayGuards?: number;
  initialNightGuards?: number;
  initialDayStart?: string | null;
  initialDayEnd?: string | null;
  initialNightStart?: string | null;
  initialNightEnd?: string | null;
  initialAssignedGuardIds?: string[];
  allGuards: SiteQuickSetupGuardOption[];
  onSaved: () => void;
}

export function SiteQuickSetupDrawer({
  open,
  onClose,
  token,
  siteId,
  siteName,
  initialFramework,
  initialObBookMode,
  initialPsiraMode,
  initialMealPaid = true,
  initialDayGuards = 1,
  initialNightGuards = 1,
  initialDayStart = "06:00",
  initialDayEnd = "18:00",
  initialNightStart = "18:00",
  initialNightEnd = "06:00",
  initialAssignedGuardIds = [],
  allGuards,
  onSaved,
}: SiteQuickSetupDrawerProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [frameworks, setFrameworks] = useState<SaSecurityFrameworkDefinition[]>([]);
  const [frameworkId, setFrameworkId] = useState<SaSecurityFrameworkId>(
    (initialFramework as SaSecurityFrameworkId) || "4on4off_12h"
  );
  const [dayGuards, setDayGuards] = useState(initialDayGuards);
  const [nightGuards, setNightGuards] = useState(initialNightGuards);
  const [dayStart, setDayStart] = useState(initialDayStart || "06:00");
  const [dayEnd, setDayEnd] = useState(initialDayEnd || "18:00");
  const [nightStart, setNightStart] = useState(initialNightStart || "18:00");
  const [nightEnd, setNightEnd] = useState(initialNightEnd || "06:00");
  const [obBookMode, setObBookMode] = useState<"" | "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL">(
    (initialObBookMode as "" | "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL") || ""
  );
  const [psiraMode, setPsiraMode] = useState<"" | "BLOCK" | "WARN" | "OFF">(
    (initialPsiraMode as "" | "BLOCK" | "WARN" | "OFF") || ""
  );
  const [mealPaid, setMealPaid] = useState(initialMealPaid);
  const [selectedGuards, setSelectedGuards] = useState<string[]>(initialAssignedGuardIds);
  const [guardSearch, setGuardSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open || !token) return;
    setFrameworkId((initialFramework as SaSecurityFrameworkId) || "4on4off_12h");
    setDayGuards(initialDayGuards);
    setNightGuards(initialNightGuards);
    setDayStart(initialDayStart || "06:00");
    setDayEnd(initialDayEnd || "18:00");
    setNightStart(initialNightStart || "18:00");
    setNightEnd(initialNightEnd || "06:00");
    setObBookMode((initialObBookMode as "" | "REQUIRED" | "OPTIONAL_WHEN_DIGITAL" | "OPTIONAL") || "");
    setPsiraMode((initialPsiraMode as "" | "BLOCK" | "WARN" | "OFF") || "");
    setMealPaid(initialMealPaid);
    setSelectedGuards(initialAssignedGuardIds);
    setError(null);

    getRosterFrameworks(token)
      .then((res) => setFrameworks(res.frameworks))
      .catch(() => {});
  }, [
    open,
    token,
    initialFramework,
    initialDayGuards,
    initialNightGuards,
    initialDayStart,
    initialDayEnd,
    initialNightStart,
    initialNightEnd,
    initialObBookMode,
    initialPsiraMode,
    initialMealPaid,
    initialAssignedGuardIds,
  ]);

  const handleSelectFramework = (fw: SaSecurityFrameworkDefinition) => {
    setFrameworkId(fw.id);
    setDayStart(fw.defaultDayStart);
    setDayEnd(fw.defaultDayEnd);
    setNightStart(fw.defaultNightStart);
    setNightEnd(fw.defaultNightEnd);
    if (fw.id === "5on2off_day") {
      setNightGuards(0);
      if (dayGuards === 0) setDayGuards(1);
    }
  };

  const toggleGuard = (id: string) => {
    setSelectedGuards((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const filteredGuards = allGuards.filter((g) => {
    if (!guardSearch.trim()) return true;
    const q = guardSearch.toLowerCase();
    return `${g.firstName} ${g.lastName} ${g.employeeNumber}`.toLowerCase().includes(q);
  });

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSiteRosterSetup(token, siteId, {
        operatingFramework: frameworkId,
        obBookMode: obBookMode === "" ? null : obBookMode,
        psiraEnforcementMode: psiraMode === "" ? null : psiraMode,
        mealIntervalPaid: mealPaid,
        dayGuardsRequired: dayGuards,
        nightGuardsRequired: nightGuards,
        dayStartTime: dayStart,
        dayEndTime: dayEnd,
        nightStartTime: nightStart,
        nightEndTime: nightEnd,
        assignedGuardIds: selectedGuards,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save site setup");
    } finally {
      setSaving(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) onClose();
      }}
      className="m-auto w-full max-w-2xl rounded-2xl border border-security-navy-200 dark:border-security-navy-700 bg-white dark:bg-security-navy-900 p-0 text-security-navy-900 dark:text-white shadow-2xl"
    >
      <div className="flex items-center justify-between border-b border-security-navy-200 dark:border-security-navy-800 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold">Quick Site Setup · {siteName}</h2>
          <p className="text-xs text-security-navy-500 dark:text-security-navy-400">
            Pick your shift style, guard counts, OB book rule, and site team in one place.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-3 py-2 text-sm text-security-navy-500 hover:bg-security-navy-100 dark:hover:bg-security-navy-800 min-h-[40px]"
        >
          Close
        </button>
      </div>

      <div className="max-h-[75vh] overflow-y-auto px-6 py-5 space-y-5">
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/30 dark:text-red-300">
            {error}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2">1. Choose South African Shift Style</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {frameworks.map((fw) => {
              const selected = fw.id === frameworkId;
              return (
                <button
                  key={fw.id}
                  type="button"
                  onClick={() => handleSelectFramework(fw)}
                  className={`text-left rounded-xl border p-3 transition-colors min-h-[44px] ${
                    selected
                      ? "border-[var(--accent-primary)] bg-amber-50/70 dark:bg-amber-950/20"
                      : "border-security-navy-200 dark:border-security-navy-700 hover:border-security-navy-300"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{fw.shortLabel}</span>
                    <span className="text-[11px] rounded-full px-2 py-0.5 bg-security-navy-100 dark:bg-security-navy-800">
                      ~{fw.avgWeeklyHoursPerGuard}h/wk
                    </span>
                  </div>
                  <p className="text-xs text-security-navy-500 dark:text-security-navy-400 mt-1">
                    {fw.tagline}
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-700 p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-security-navy-500">
              Day Shift
            </h4>
            <div>
              <label className="block text-xs font-medium mb-1">Guards needed per day</label>
              <input
                type="number"
                min={0}
                max={50}
                value={dayGuards}
                onChange={(e) => setDayGuards(Math.max(0, Number(e.target.value) || 0))}
                className="input-modern w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Start</label>
                <input
                  type="time"
                  value={dayStart}
                  onChange={(e) => setDayStart(e.target.value)}
                  className="input-modern w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">End</label>
                <input
                  type="time"
                  value={dayEnd}
                  onChange={(e) => setDayEnd(e.target.value)}
                  className="input-modern w-full"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-security-navy-200 dark:border-security-navy-700 p-3.5 space-y-2.5">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-security-navy-500">
              Night Shift
            </h4>
            <div>
              <label className="block text-xs font-medium mb-1">Guards needed per night</label>
              <input
                type="number"
                min={0}
                max={50}
                value={nightGuards}
                onChange={(e) => setNightGuards(Math.max(0, Number(e.target.value) || 0))}
                className="input-modern w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-medium mb-1">Start</label>
                <input
                  type="time"
                  value={nightStart}
                  onChange={(e) => setNightStart(e.target.value)}
                  className="input-modern w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">End</label>
                <input
                  type="time"
                  value={nightEnd}
                  onChange={(e) => setNightEnd(e.target.value)}
                  className="input-modern w-full"
                />
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium mb-1">
              Occurrence Book (OB) Rule on this Site
            </label>
            <select
              value={obBookMode}
              onChange={(e) => setObBookMode(e.target.value as typeof obBookMode)}
              className="input-modern w-full"
            >
              <option value="">Use Company Default</option>
              <option value="REQUIRED">Always Required</option>
              <option value="OPTIONAL_WHEN_DIGITAL">Optional if clocked via App/WhatsApp</option>
              <option value="OPTIONAL">Optional / Digital Sign-Off Only</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">
              PSIRA Credential Check
            </label>
            <select
              value={psiraMode}
              onChange={(e) => setPsiraMode(e.target.value as typeof psiraMode)}
              className="input-modern w-full"
            >
              <option value="">Use Company Default</option>
              <option value="WARN">Warn on expired/missing PSIRA</option>
              <option value="BLOCK">Block expired/under-graded guards</option>
              <option value="OFF">Off</option>
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={mealPaid}
            onChange={(e) => setMealPaid(e.target.checked)}
            className="rounded border-security-navy-300"
          />
          <span>
            Paid continuous meal break (standard SA guarding where guard remains on post for 12h)
          </span>
        </label>

        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm font-semibold">
              2. Site Guards ({selectedGuards.length} selected)
            </h3>
            <input
              type="search"
              value={guardSearch}
              onChange={(e) => setGuardSearch(e.target.value)}
              placeholder="Search guard name or ID..."
              className="input-modern max-w-xs text-xs"
            />
          </div>
          <div className="max-h-44 overflow-y-auto rounded-xl border border-security-navy-200 dark:border-security-navy-700 divide-y divide-security-navy-100 dark:divide-security-navy-800">
            {filteredGuards.map((g) => {
              const checked = selectedGuards.includes(g.id);
              return (
                <label
                  key={g.id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs hover:bg-security-navy-50 dark:hover:bg-security-navy-800/50 cursor-pointer min-h-[40px]"
                >
                  <span className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleGuard(g.id)}
                      className="rounded border-security-navy-300"
                    />
                    <span className="font-medium">
                      {g.firstName} {g.lastName}
                    </span>
                    <span className="text-security-navy-500">({g.employeeNumber})</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    {g.status === "reliever" && (
                      <span className="rounded bg-amber-100 text-amber-900 px-1.5 py-0.5 text-[10px] font-semibold">
                        Reliever
                      </span>
                    )}
                    {g.psiraGrade && (
                      <span className="rounded bg-security-navy-100 dark:bg-security-navy-800 px-1.5 py-0.5 text-[10px] font-semibold">
                        Grade {g.psiraGrade}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-security-navy-200 dark:border-security-navy-800 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          disabled={saving}
          className="rounded-lg border border-security-navy-300 dark:border-security-navy-600 px-4 py-2 text-sm font-medium min-h-[40px]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="btn-primary min-h-[40px]"
        >
          {saving ? "Saving..." : "Save Site Setup"}
        </button>
      </div>
    </dialog>
  );
}
