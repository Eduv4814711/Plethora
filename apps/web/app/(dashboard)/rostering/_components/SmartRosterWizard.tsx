"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getRosterFrameworks,
  smartApplyRoster,
  smartGenerateRoster,
  type SaSecurityFrameworkDefinition,
  type SaSecurityFrameworkId,
  type SmartRosterPreviewResponse,
} from "@/lib/roster-api";
import { SaComplianceBanner } from "./SaComplianceBanner";

export interface WizardGuardOption {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  status: string;
  psiraGrade?: string | null;
}

export interface SmartRosterWizardProps {
  token: string;
  siteId: string;
  siteName: string;
  startDate: string;
  endDate: string;
  initialFramework?: string | null;
  dayGuardsRequired?: number;
  nightGuardsRequired?: number;
  siteGuards: WizardGuardOption[];
  allCompanyGuards: WizardGuardOption[];
  onPublished: () => void;
}

export function SmartRosterWizard({
  token,
  siteId,
  siteName,
  startDate,
  endDate,
  initialFramework,
  dayGuardsRequired = 1,
  nightGuardsRequired = 1,
  siteGuards,
  allCompanyGuards,
  onPublished,
}: SmartRosterWizardProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [frameworks, setFrameworks] = useState<SaSecurityFrameworkDefinition[]>([]);
  const [frameworkId, setFrameworkId] = useState<SaSecurityFrameworkId>(
    (initialFramework as SaSecurityFrameworkId) || "4on4off_12h"
  );
  const [selectedGuardIds, setSelectedGuardIds] = useState<string[]>(() =>
    siteGuards.map((g) => g.id)
  );
  const [includeRelieverPool, setIncludeRelieverPool] = useState(true);
  const [allowOvertime, setAllowOvertime] = useState(false);
  const [preferDedicatedDayNight, setPreferDedicatedDayNight] = useState(true);
  const [preview, setPreview] = useState<SmartRosterPreviewResponse | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guardFilter, setGuardFilter] = useState("");

  useEffect(() => {
    if (!token) return;
    getRosterFrameworks(token)
      .then((res) => setFrameworks(res.frameworks))
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    if (siteGuards.length > 0 && selectedGuardIds.length === 0) {
      setSelectedGuardIds(siteGuards.map((g) => g.id));
    }
  }, [siteGuards, selectedGuardIds.length]);

  const activeFramework = useMemo(
    () => frameworks.find((f) => f.id === frameworkId) ?? frameworks[0] ?? null,
    [frameworks, frameworkId]
  );

  // Quick live client-side headcount hint for Step 1 before hitting solver
  const recommendedGuardsCount = useMemo(() => {
    const dayDays = frameworkId === "5on2off_day" ? 5 : 7;
    const nightDays = frameworkId === "5on2off_day" ? 0 : 7;
    const shiftH = activeFramework?.shiftDurationHours ?? 12;
    const weeklyHours = (dayGuardsRequired * dayDays + nightGuardsRequired * nightDays) * shiftH;
    return Math.max(1, Math.ceil(weeklyHours / 48));
  }, [frameworkId, activeFramework, dayGuardsRequired, nightGuardsRequired]);

  const candidateList = useMemo(() => {
    const q = guardFilter.trim().toLowerCase();
    const siteSet = new Set(siteGuards.map((g) => g.id));
    const combined = [...allCompanyGuards].sort((a, b) => {
      const aSite = siteSet.has(a.id) ? 0 : 1;
      const bSite = siteSet.has(b.id) ? 0 : 1;
      if (aSite !== bSite) return aSite - bSite;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });
    if (!q) return combined;
    return combined.filter((g) =>
      `${g.firstName} ${g.lastName} ${g.employeeNumber}`.toLowerCase().includes(q)
    );
  }, [allCompanyGuards, siteGuards, guardFilter]);

  const handleGeneratePreview = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await smartGenerateRoster(token, siteId, {
        startDate,
        endDate,
        frameworkId,
        guardIds: selectedGuardIds.length > 0 ? selectedGuardIds : undefined,
        includeRelieverPool,
        allowOvertime,
        preferDedicatedDayNight,
      });
      setPreview(res);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate smart roster");
    } finally {
      setGenerating(false);
    }
  };

  const handlePublish = async () => {
    if (!preview) return;
    setApplying(true);
    setError(null);
    try {
      await smartApplyRoster(token, siteId, {
        startDate,
        endDate,
        frameworkId: preview.frameworkId,
        publishImmediately: true,
        assignments: preview.assignments.map((a) => ({
          guardId: a.guardId,
          dateKey: a.dateKey,
          shiftType: a.shiftType,
          shiftCode: a.shiftCode,
          postId: a.postId,
        })),
      });
      onPublished();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to publish schedule");
    } finally {
      setApplying(false);
    }
  };

  const toggleGuard = (id: string) => {
    setSelectedGuardIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <div className="space-y-5">
      {/* Stepper Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-security-navy-200 bg-white p-4">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { n: 1 as const, label: "1. Shift Style" },
            { n: 2 as const, label: "2. Guards & Rules" },
            { n: 3 as const, label: "3. Review & Publish" },
          ].map((s) => {
            const current = step === s.n;
            const unlocked = s.n < 3 || preview !== null;
            return (
              <button
                key={s.n}
                type="button"
                disabled={!unlocked}
                onClick={() => setStep(s.n)}
                className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors min-h-[40px] ${
                  current
                    ? "bg-[var(--accent-primary)] text-white"
                    : unlocked
                      ? "bg-security-navy-100 text-security-navy-700 hover:bg-security-navy-200"
                      : "opacity-45 cursor-not-allowed bg-security-navy-50 text-security-navy-400"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
        <div className="text-xs text-security-navy-500">
          {siteName} · {startDate} to {endDate}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* STEP 1: Pick Operating Framework */}
      {step === 1 && (
        <div className="rounded-xl border border-security-navy-200 bg-white p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-security-navy-900">
                How does this site operate?
              </h3>
              <p className="text-xs text-security-navy-500 mt-0.5">
                Pick a South African security schedule template. Our optimizer enforces 12h rest, 36h weekly rest, and PSIRA rules automatically.
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-900">
              Recommended for zero overtime: <strong>{recommendedGuardsCount} guards</strong>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {frameworks.map((fw) => {
              const selected = fw.id === frameworkId;
              return (
                <button
                  key={fw.id}
                  type="button"
                  onClick={() => setFrameworkId(fw.id)}
                  className={`text-left rounded-xl border p-4 transition-all min-h-[112px] flex flex-col justify-between ${
                    selected
                      ? "border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)]/25 bg-amber-50/60"
                      : "border-security-navy-200 hover:border-security-navy-400"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-security-navy-900">
                        {fw.name}
                      </span>
                    </div>
                    <p className="text-xs text-security-navy-600 mt-1.5">
                      {fw.tagline}
                    </p>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-security-navy-500">
                    <span className="rounded bg-security-navy-100 px-2 py-0.5 font-medium">
                      ~{fw.avgWeeklyHoursPerGuard}h/wk
                    </span>
                    <span className="rounded bg-security-navy-100 px-2 py-0.5">
                      {fw.bestFor}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="btn-primary min-h-[44px]"
            >
              Next: Pick Guards &amp; Rules
            </button>
          </div>
        </div>
      )}

      {/* STEP 2: Pick Guards & Preferences */}
      {step === 2 && (
        <div className="rounded-xl border border-security-navy-200 bg-white p-5 space-y-5">
          <div>
            <h3 className="text-base font-semibold text-security-navy-900">
              Select Guards &amp; Scheduling Preferences
            </h3>
            <p className="text-xs text-security-navy-500 mt-0.5">
              Guards already working at another site or on approved leave are automatically protected from double-booking.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 rounded-xl border border-security-navy-200 p-4 bg-security-navy-50/50">
            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={includeRelieverPool}
                onChange={(e) => setIncludeRelieverPool(e.target.checked)}
                className="mt-0.5 rounded border-security-navy-300"
              />
              <span>
                <strong className="block text-security-navy-900">
                  Use Reliever Pool first before Overtime
                </strong>
                Draws company relievers up to 48h/week before paying 1.5x overtime.
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={preferDedicatedDayNight}
                onChange={(e) => setPreferDedicatedDayNight(e.target.checked)}
                className="mt-0.5 rounded border-security-navy-300"
              />
              <span>
                <strong className="block text-security-navy-900">
                  Keep Guards on Dedicated Day or Night
                </strong>
                Avoids flipping guards back and forth between day and night shifts.
              </span>
            </label>

            <label className="flex items-start gap-2.5 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={allowOvertime}
                onChange={(e) => setAllowOvertime(e.target.checked)}
                className="mt-0.5 rounded border-security-navy-300"
              />
              <span>
                <strong className="block text-security-navy-900">
                  Allow Overtime (&gt;48h/wk) to Fill Gaps
                </strong>
                If off, solver keeps overtime at 0h and highlights open gaps for relievers.
              </span>
            </label>
          </div>

          <div className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-security-navy-700">
                Available Guards ({selectedGuardIds.length} chosen · leaves empty to use site team)
              </div>
              <input
                type="search"
                value={guardFilter}
                onChange={(e) => setGuardFilter(e.target.value)}
                placeholder="Search guard name or ID..."
                className="input-modern max-w-xs text-xs"
              />
            </div>

            <div className="max-h-64 overflow-y-auto rounded-xl border border-security-navy-200 divide-y divide-security-navy-100">
              {candidateList.map((g) => {
                const checked = selectedGuardIds.includes(g.id);
                const isSiteMember = siteGuards.some((sg) => sg.id === g.id);
                return (
                  <label
                    key={g.id}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs hover:bg-security-navy-50 cursor-pointer min-h-[44px]"
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGuard(g.id)}
                        className="rounded border-security-navy-300"
                      />
                      <span className="font-medium text-security-navy-900">
                        {g.firstName} {g.lastName}
                      </span>
                      <span className="text-security-navy-500">({g.employeeNumber})</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      {isSiteMember && (
                        <span className="rounded bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[10px] font-semibold">
                          Site Team
                        </span>
                      )}
                      {g.status === "reliever" && (
                        <span className="rounded bg-amber-100 text-amber-900 px-2 py-0.5 text-[10px] font-semibold">
                          Reliever
                        </span>
                      )}
                      {g.psiraGrade && (
                        <span className="rounded bg-security-navy-100 px-2 py-0.5 text-[10px] font-semibold">
                          Grade {g.psiraGrade}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-lg border border-security-navy-300 px-4 py-2 text-xs font-semibold min-h-[44px]"
            >
              Back
            </button>
            <button
              type="button"
              onClick={handleGeneratePreview}
              disabled={generating}
              className="btn-primary min-h-[44px]"
            >
              {generating ? "Optimizing Schedule…" : "Build Smart Roster Preview"}
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: Review & 1-Click Publish */}
      {step === 3 && preview && (
        <div className="space-y-4">
          <SaComplianceBanner
            coveragePercent={preview.metrics.coveragePercent}
            filledSlots={preview.metrics.totalFilledSlots}
            requiredSlots={preview.metrics.totalRequiredSlots}
            totalOvertimeHours={preview.metrics.totalOvertimeHours}
            restViolationsCount={preview.metrics.restViolationsCount}
            credentialWarningsCount={preview.metrics.credentialWarningsCount}
            solverUsed={preview.solverUsed}
            solveDurationMs={preview.solveDurationMs}
            warnings={preview.unfilledSlots.map((u) => ({
              code: "UNFILLED_SLOT",
              dateKey: u.dateKey,
              message: `${u.shiftType.toUpperCase()} shortfall (${u.shortfall}) at ${u.postName ?? "Site"}: ${u.reasons.join("; ")}`,
            }))}
          />

          {preview.unfilledSlots.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 space-y-2">
              <h4 className="text-sm font-semibold text-amber-950">
                {preview.unfilledSlots.length} Shift Gap{preview.unfilledSlots.length === 1 ? "" : "s"} Left Open (Zero-Overtime Protection)
              </h4>
              <p className="text-xs text-amber-800">
                To fill these automatically, either assign another guard / reliever in Step 2 or enable &ldquo;Allow Overtime&rdquo; and re-run.
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {preview.unfilledSlots.slice(0, 10).map((u, idx) => (
                  <span
                    key={`${u.dateKey}-${u.shiftType}-${idx}`}
                    className="rounded-md bg-white border border-amber-300 px-2.5 py-1 text-xs font-medium"
                  >
                    {u.dateKey} · {u.shiftType === "night" ? "Night" : "Day"} (-{u.shortfall})
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Guard Hours & SA Compliance Summary Table */}
          <div className="rounded-xl border border-security-navy-200 bg-white overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-security-navy-200 px-4 py-3">
              <div>
                <h4 className="text-sm font-semibold text-security-navy-900">
                  Guard Workload &amp; South African Labour Summary
                </h4>
                <p className="text-xs text-security-navy-500">
                  Shows projected ordinary hours (&lt;=48h/wk), overtime, Sundays, and night allowances before publishing.
                </p>
              </div>
              <span className="text-[11px] text-security-navy-500">
                Optimized in {preview.solveDurationMs}ms ({preview.solverStatus})
              </span>
            </div>

            <div role="region" tabIndex={0} aria-label="Guard workload preview table" className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead className="bg-security-navy-50 text-security-navy-600 border-b border-security-navy-200">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 text-left font-semibold">Guard</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Shifts (D / N)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Ordinary (h)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Overtime (h)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Sunday (h)</th>
                    <th scope="col" className="px-3 py-2.5 text-right font-semibold">Night Allow.</th>
                    <th scope="col" className="px-4 py-2.5 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100">
                  {preview.guardSummaries.map((g) => {
                    const warnCount = g.restWarnings.length + g.credentialWarnings.length;
                    return (
                      <tr key={g.guardId}>
                        <th scope="row" className="px-4 py-2.5 text-left font-medium text-security-navy-900">
                          {g.guardName} <span className="text-security-navy-500 font-normal">({g.employeeNumber})</span>
                        </th>
                        <td className="px-3 py-2.5 text-right tabular-nums">
                          {g.totalShifts} <span className="text-security-navy-500">({g.dayShifts}/{g.nightShifts})</span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{g.ordinaryHours}</td>
                        <td className={`px-3 py-2.5 text-right tabular-nums font-medium ${g.overtimeHours > 0 ? "text-amber-700" : ""}`}>
                          {g.overtimeHours}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{g.sundayHours}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">R{g.nightAllowanceRand.toFixed(2)}</td>
                        <td className="px-4 py-2.5">
                          {warnCount === 0 ? (
                            <span className="rounded bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[10px] font-semibold">
                              SA Compliant
                            </span>
                          ) : (
                            <span className="text-amber-700">
                              {[...g.restWarnings, ...g.credentialWarnings][0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-lg border border-security-navy-300 px-4 py-2 text-xs font-semibold min-h-[44px]"
            >
              Adjust Guards &amp; Re-run
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={applying || preview.assignments.length === 0}
              className="btn-primary min-h-[44px]"
            >
              {applying
                ? "Publishing Schedule…"
                : `Publish ${preview.assignments.length} Shifts to Attendance`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
