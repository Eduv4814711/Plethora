"use client";

import { useState, useEffect, useCallback } from "react";
import { authFetch } from "@/lib/api";
import { useConfirmDialog } from "@/components/ui";

const CONFIG_SECTION_CLASS = "rounded-security-lg border border-security-navy-100 bg-white p-4 shadow-security-card";

export interface PayGrade {
  id: string;
  name: string;
  hourlyRate: string;
  sortOrder: number;
}

export interface PayRule {
  id: string;
  ruleType: string;
  multiplier: string;
}

export interface EarningsRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
}

export interface DeductionRule {
  id: string;
  name: string;
  type: string;
  amount: string | null;
  rate: string | null;
  appliesTo: string;
  isOptional: boolean;
}

export interface EmployeeGroup {
  id: string;
  name: string;
  description: string | null;
  sortOrder: number;
}

interface PayArea {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface PayGradeDefinition {
  id: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
}

interface PayAreaGradeRate {
  id: string;
  areaId: string;
  gradeId: string;
  hourlyRate: string;
  effectiveFrom: string;
}

interface PricingCatalog {
  rateSource: "legacy_employee_grade" | "site_area_grade";
  areas: PayArea[];
  grades: PayGradeDefinition[];
  rates: PayAreaGradeRate[];
}

interface PricingReadiness {
  rateSource: "legacy_employee_grade" | "site_area_grade";
  ready: boolean;
  activeSites: number;
  configuredActiveSites: number;
  missingSites: Array<{ id: string; name: string; reason: string }>;
  missingPrimaryEmployees: Array<{ id: string; name: string; activeSiteCount: number }>;
  missingGlobalRules: string[];
  unresolvedGroupRuleCounts: { earnings: number; deductions: number };
}

export function PayrollConfig({
  token,
  canCreate,
  canEdit,
  canDelete,
}: {
  token: string;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [catalog, setCatalog] = useState<PricingCatalog>({
    rateSource: "legacy_employee_grade",
    areas: [],
    grades: [],
    rates: [],
  });
  const [readiness, setReadiness] = useState<PricingReadiness | null>(null);
  const [payRules, setPayRules] = useState<PayRule[]>([]);
  const [earnings, setEarnings] = useState<EarningsRule[]>([]);
  const [deductions, setDeductions] = useState<DeductionRule[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    Promise.all([
      authFetch("/payroll/pricing/catalog", token).then((r) => r.json()).catch(() => ({})),
      authFetch("/payroll/pay-rules", token).then((r) => r.json()).catch(() => ({})),
      authFetch("/payroll/earnings-rules", token).then((r) => r.json()).catch(() => ({})),
      authFetch("/payroll/deduction-rules", token).then((r) => r.json()).catch(() => ({})),
      authFetch("/payroll/pricing/readiness", token).then((r) => r.json()).catch(() => null),
    ])
      .then(([c, r, e, d, ready]) => {
        setCatalog({
          rateSource: c?.rateSource ?? "legacy_employee_grade",
          areas: c?.areas || [],
          grades: c?.grades || [],
          rates: c?.rates || [],
        });
        setPayRules(r?.data || []);
        setEarnings(e?.data || []);
        setDeductions(d?.data || []);
        if (ready && !ready.error) {
          setReadiness({
            rateSource: ready.rateSource ?? "legacy_employee_grade",
            ready: Boolean(ready.ready),
            activeSites: ready.activeSites ?? 0,
            configuredActiveSites: ready.configuredActiveSites ?? 0,
            missingSites: Array.isArray(ready.missingSites) ? ready.missingSites : [],
            missingPrimaryEmployees: Array.isArray(ready.missingPrimaryEmployees) ? ready.missingPrimaryEmployees : [],
            missingGlobalRules: Array.isArray(ready.missingGlobalRules) ? ready.missingGlobalRules : [],
            unresolvedGroupRuleCounts: ready.unresolvedGroupRuleCounts || { earnings: 0, deductions: 0 },
          });
        } else {
          setReadiness(null);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="card-wireframe p-4 animate-pulse">
        <div className="h-4 bg-security-navy-100 rounded w-32 mb-3" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-security-navy-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card-wireframe p-5 space-y-5">
      <div>
        <h2 className="section-title">Global payroll pricing</h2>
        <p className="text-sm text-security-navy-600 mt-1">
          Define company-wide Area × Grade prices, then select one Area and Grade on each site.
        </p>
      </div>
      <PricingReadinessPanel
        readiness={readiness}
        token={token}
        canEdit={canEdit}
        onRefresh={load}
      />
      <WageMatrixSection
        catalog={catalog}
        token={token}
        onRefresh={load}
        canCreate={canCreate}
        canEdit={canEdit}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PayRulesSection
          payRules={payRules}
          token={token}
          onRefresh={load}
          groupId={null}
          canEdit={canEdit}
        />
        <EarningsRulesSection
          earnings={earnings}
          token={token}
          onRefresh={load}
          groupId={null}
          canCreate={canCreate}
          canDelete={canDelete}
        />
        <DeductionRulesSection
          deductions={deductions}
          token={token}
          onRefresh={load}
          groupId={null}
          canCreate={canCreate}
          canDelete={canDelete}
        />
      </div>
    </div>
  );
}

function PricingReadinessPanel({
  readiness,
  token,
  canEdit,
  onRefresh,
}: {
  readiness: PricingReadiness | null;
  token: string;
  canEdit: boolean;
  onRefresh: () => void;
}) {
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");
  if (!readiness) return null;
  const active = readiness.rateSource === "site_area_grade";
  const missingSites = Array.isArray(readiness.missingSites) ? readiness.missingSites : [];
  const missingPrimaryEmployees = Array.isArray(readiness.missingPrimaryEmployees) ? readiness.missingPrimaryEmployees : [];
  const missingGlobalRules = Array.isArray(readiness.missingGlobalRules) ? readiness.missingGlobalRules : [];
  const unresolvedGroupRuleCounts = readiness.unresolvedGroupRuleCounts || { earnings: 0, deductions: 0 };

  const activate = async () => {
    setActivating(true);
    setError("");
    try {
      const response = await authFetch("/payroll/pricing/activate", token, { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "Pricing is not ready to activate.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Activation failed.");
    } finally {
      setActivating(false);
    }
  };
  return (
    <div className={`rounded-lg border p-4 ${active ? "border-emerald-200 bg-emerald-50" : readiness.ready ? "border-blue-200 bg-blue-50" : "border-amber-200 bg-amber-50"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-security-navy-900">
            {active ? "Site pricing active" : readiness.ready ? "Ready to activate" : "Site pricing setup in progress"}
          </p>
          <p className="text-xs text-security-navy-600 mt-1">
            {readiness.configuredActiveSites ?? 0} of {readiness.activeSites ?? 0} active sites configured.
          </p>
        </div>
        {!active && canEdit && (
          <button type="button" onClick={activate} disabled={!readiness.ready || activating} className="btn-primary disabled:opacity-50">
            {activating ? "Activating..." : "Activate site pricing"}
          </button>
        )}
      </div>
      {!readiness.ready && (
        <div className="mt-3 text-xs text-security-navy-700 space-y-1">
          {missingSites.slice(0, 5).map((site) => <p key={site.id}>• {site.name}: {site.reason}</p>)}
          {missingSites.length > 5 && <p>• Plus {missingSites.length - 5} more site(s).</p>}
          {missingPrimaryEmployees.slice(0, 3).map((employee) => <p key={employee.id}>• Choose a primary payroll site for {employee.name}.</p>)}
          {missingGlobalRules.length > 0 && <p>• Configure: {missingGlobalRules.join(", ")}.</p>}
          {(unresolvedGroupRuleCounts.earnings > 0 || unresolvedGroupRuleCounts.deductions > 0) && <p>• Resolve legacy group earnings/deductions before cutover.</p>}
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function WageMatrixSection({
  catalog,
  token,
  onRefresh,
  canCreate,
  canEdit,
}: {
  catalog: PricingCatalog;
  token: string;
  onRefresh: () => void;
  canCreate: boolean;
  canEdit: boolean;
}) {
  const [ruleArea, setRuleArea] = useState("");
  const [ruleGrade, setRuleGrade] = useState("");
  const [ruleRate, setRuleRate] = useState("");
  const [ruleEffectiveFrom, setRuleEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [editing, setEditing] = useState<{ areaId: string; gradeId: string; areaName: string; gradeName: string } | null>(null);
  const [cellRate, setCellRate] = useState("");
  const [cellEffectiveFrom, setCellEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [historyKey, setHistoryKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const activeAreas = (catalog?.areas || []).filter((item) => item.isActive);
  const activeGrades = (catalog?.grades || []).filter((item) => item.isActive);
  const today = new Date().toISOString().slice(0, 10);

  const versions = (areaId: string, gradeId: string) =>
    (catalog?.rates || [])
      .filter((item) => item.areaId === areaId && item.gradeId === gradeId)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
  const current = (areaId: string, gradeId: string) =>
    versions(areaId, gradeId).find((item) => item.effectiveFrom.slice(0, 10) <= today);

  const handleAddRule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const trimmedArea = ruleArea.trim();
    const trimmedGrade = ruleGrade.trim();
    const numRate = parseFloat(ruleRate);

    if (!trimmedArea || !trimmedGrade) {
      setError("Please specify both an Area (e.g. Area 1) and a Grade (e.g. Grade C).");
      return;
    }
    if (isNaN(numRate) || numRate <= 0) {
      setError("Please specify a positive hourly rate (e.g. 32.44).");
      return;
    }

    setIsSubmitting(true);
    try {
      // 1. Resolve or create Area
      let targetArea = (catalog?.areas || []).find(
        (a) => a.name.toLowerCase() === trimmedArea.toLowerCase()
      );
      if (!targetArea) {
        const areaRes = await authFetch("/payroll/pricing/areas", token, {
          method: "POST",
          body: JSON.stringify({ name: trimmedArea }),
        });
        const areaData = await areaRes.json().catch(() => ({}));
        if (!areaRes.ok) throw new Error(areaData.message || "Failed to create Area");
        targetArea = areaData;
      } else if (!targetArea.isActive) {
        await authFetch(`/payroll/pricing/areas/${targetArea.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ isActive: true }),
        });
      }

      // 2. Resolve or create Grade
      let targetGrade = (catalog?.grades || []).find(
        (g) => g.name.toLowerCase() === trimmedGrade.toLowerCase()
      );
      if (!targetGrade) {
        const gradeRes = await authFetch("/payroll/pricing/grades", token, {
          method: "POST",
          body: JSON.stringify({ name: trimmedGrade }),
        });
        const gradeData = await gradeRes.json().catch(() => ({}));
        if (!gradeRes.ok) throw new Error(gradeData.message || "Failed to create Grade");
        targetGrade = gradeData;
      } else if (!targetGrade.isActive) {
        await authFetch(`/payroll/pricing/grades/${targetGrade.id}`, token, {
          method: "PUT",
          body: JSON.stringify({ isActive: true }),
        });
      }

      // 3. Save rate
      const rateRes = await authFetch("/payroll/pricing/rates", token, {
        method: "POST",
        body: JSON.stringify({
          areaId: targetArea!.id,
          gradeId: targetGrade!.id,
          hourlyRate: numRate,
          effectiveFrom: ruleEffectiveFrom,
        }),
      });
      const rateData = await rateRes.json().catch(() => ({}));
      if (!rateRes.ok) throw new Error(rateData.message || "Failed to save rate");

      setRuleRate("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save configuration rule.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveCellRate = async () => {
    if (!editing) return;
    try {
      const response = await authFetch("/payroll/pricing/rates", token, {
        method: "POST",
        body: JSON.stringify({
          areaId: editing.areaId,
          gradeId: editing.gradeId,
          hourlyRate: Number(cellRate),
          effectiveFrom: cellEffectiveFrom,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.message || "Unable to save rate.");
      setEditing(null);
      setCellRate("");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save rate.");
    }
  };

  const editItem = async (kind: "areas" | "grades", item: PayArea | PayGradeDefinition, disable = false) => {
    const label = kind === "areas" ? "Area" : "Grade";
    const nextName = disable ? item.name : window.prompt(`Rename ${label} (e.g. ${label} 1 or ${label} A)`, item.name);
    if (!nextName && !disable) return;
    const response = await authFetch(`/payroll/pricing/${kind}/${item.id}`, token, {
      method: "PUT",
      body: JSON.stringify(disable ? { isActive: false } : { name: nextName }),
    });
    if (response.ok) onRefresh();
    else setError(`Unable to update this ${label.toLowerCase()}.`);
  };

  return (
    <div className={CONFIG_SECTION_CLASS}>
      <div className="mb-4">
        <h3 className="text-base font-bold text-security-navy-900">Area × Grade Wage Matrix</h3>
        <p className="text-xs text-security-navy-600 mt-0.5">
          Configure company-wide pricing rules (e.g. <span className="font-semibold text-security-navy-800">Area 1 Grade C = R32.44/hr</span>). Sites will choose an Area and Grade to determine guard pay.
        </p>
      </div>

      {canCreate && (
        <form onSubmit={handleAddRule} className="p-4 bg-security-navy-50 rounded-lg border border-security-navy-200 space-y-3 mb-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-security-navy-800">
              Add Pricing Rule
            </h4>
            <span className="text-[11px] text-security-navy-500">
              Configure an Area, Grade, and Rate in one step
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-1">
                Area *
              </label>
              <input
                list="payroll-area-list"
                value={ruleArea}
                onChange={(e) => setRuleArea(e.target.value)}
                placeholder="e.g. Area 1"
                className="input-compact w-full font-medium"
                required
              />
              <datalist id="payroll-area-list">
                {activeAreas.map((a) => <option key={a.id} value={a.name} />)}
                {!activeAreas.some((a) => a.name === "Area 1") && <option value="Area 1" />}
                {!activeAreas.some((a) => a.name === "Area 2") && <option value="Area 2" />}
                {!activeAreas.some((a) => a.name === "Area 3") && <option value="Area 3" />}
              </datalist>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-1">
                Grade *
              </label>
              <input
                list="payroll-grade-list"
                value={ruleGrade}
                onChange={(e) => setRuleGrade(e.target.value)}
                placeholder="e.g. Grade C"
                className="input-compact w-full font-medium"
                required
              />
              <datalist id="payroll-grade-list">
                {activeGrades.map((g) => <option key={g.id} value={g.name} />)}
                {!activeGrades.some((g) => g.name === "Grade A") && <option value="Grade A" />}
                {!activeGrades.some((g) => g.name === "Grade B") && <option value="Grade B" />}
                {!activeGrades.some((g) => g.name === "Grade C") && <option value="Grade C" />}
                {!activeGrades.some((g) => g.name === "Grade D") && <option value="Grade D" />}
                {!activeGrades.some((g) => g.name === "Grade E") && <option value="Grade E" />}
              </datalist>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-1">
                Hourly Rate (ZAR) *
              </label>
              <div className="relative">
                <span className="absolute left-2.5 top-1.5 text-xs font-bold text-security-navy-500">R</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={ruleRate}
                  onChange={(e) => setRuleRate(e.target.value)}
                  placeholder="32.44"
                  className="input-compact pl-7 w-full font-mono font-bold text-sm"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-1">
                Effective Date *
              </label>
              <input
                type="date"
                value={ruleEffectiveFrom}
                onChange={(e) => setRuleEffectiveFrom(e.target.value)}
                className="input-compact w-full text-xs"
                required
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-security-navy-200/60">
            <div className="text-xs">
              {ruleArea && ruleGrade && ruleRate && !isNaN(Number(ruleRate)) && Number(ruleRate) > 0 ? (
                <span className="font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded border border-emerald-200">
                  Rule Preview: {ruleArea} {ruleGrade} = R{Number(ruleRate).toFixed(2)}/hr (Effective from {ruleEffectiveFrom})
                </span>
              ) : (
                <span className="text-security-navy-500 text-[11px]">
                  Example: Area 1 Grade C = R32.44/hr
                </span>
              )}
            </div>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary text-xs py-2 px-4 font-bold"
            >
              {isSubmitting ? "Adding Rule..." : "+ Add Pricing Rule"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="mb-3 p-2.5 rounded bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")} className="text-red-500 hover:text-red-700 font-bold ml-2">✕</button>
        </div>
      )}

      {activeAreas.length === 0 || activeGrades.length === 0 ? (
        <div className="text-center py-8 px-4 bg-security-navy-50/50 rounded-lg border border-dashed border-security-navy-200">
          <p className="text-sm font-semibold text-security-navy-700">No Pricing Rules Added Yet</p>
          <p className="text-xs text-security-navy-500 mt-1 max-w-md mx-auto">
            Use the form above to add your first Area, Grade, and Rate (e.g. Area 1 Grade C = R32.44/hr).
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="overflow-x-auto rounded-lg border border-security-navy-200 bg-white shadow-sm">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-security-navy-100/70 border-b border-security-navy-200 text-security-navy-900">
                  <th className="text-left p-3 font-bold uppercase text-xs tracking-wider border-r border-security-navy-200 w-44">
                    Area \ Grade
                  </th>
                  {activeGrades.map((grade) => (
                    <th key={grade.id} className="text-left p-3 border-r border-security-navy-200 last:border-r-0 min-w-56">
                      <div className="flex items-center justify-between gap-1">
                        <span className="font-bold text-security-navy-900">{grade.name}</span>
                        {canEdit && (
                          <div className="flex items-center gap-1 text-[11px]">
                            <button
                              type="button"
                              className="text-security-navy-600 hover:text-security-navy-900 hover:underline px-1 py-0.5"
                              onClick={() => editItem("grades", grade)}
                              title="Rename Grade"
                            >
                              Rename
                            </button>
                            <span className="text-security-navy-300">·</span>
                            <button
                              type="button"
                              className="text-red-600 hover:text-red-800 hover:underline px-1 py-0.5"
                              onClick={() => editItem("grades", grade, true)}
                              title="Disable Grade"
                            >
                              Disable
                            </button>
                          </div>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeAreas.map((area, aIdx) => (
                  <tr key={area.id} className={`border-b border-security-navy-200 last:border-b-0 ${aIdx % 2 === 0 ? "bg-white" : "bg-security-navy-50/30"}`}>
                    <th className="text-left p-3 border-r border-security-navy-200 font-bold text-security-navy-900 bg-security-navy-50/50">
                      <div className="flex items-center justify-between gap-1">
                        <span>{area.name}</span>
                        {canEdit && (
                          <div className="flex items-center gap-1 text-[11px] font-normal">
                            <button
                              type="button"
                              className="text-security-navy-600 hover:text-security-navy-900 hover:underline px-1 py-0.5"
                              onClick={() => editItem("areas", area)}
                              title="Rename Area"
                            >
                              Rename
                            </button>
                            <span className="text-security-navy-300">·</span>
                            <button
                              type="button"
                              className="text-red-600 hover:text-red-800 hover:underline px-1 py-0.5"
                              onClick={() => editItem("areas", area, true)}
                              title="Disable Area"
                            >
                              Disable
                            </button>
                          </div>
                        )}
                      </div>
                    </th>
                    {activeGrades.map((grade) => {
                      const key = `${area.id}:${grade.id}`;
                      const value = current(area.id, grade.id);
                      const history = versions(area.id, grade.id);
                      const isEditing = editing?.areaId === area.id && editing?.gradeId === grade.id;

                      return (
                        <td key={grade.id} className="p-3 border-r border-security-navy-200 last:border-r-0 align-top">
                          {isEditing ? (
                            <div className="p-3 bg-security-navy-50 rounded-lg border-2 border-security-navy-400 space-y-2.5 shadow-sm">
                              <div className="text-xs font-semibold text-security-navy-900 flex items-center justify-between">
                                <span>{area.name} × {grade.name}</span>
                                <span className="text-[10px] text-security-navy-500">Hourly Rate</span>
                              </div>
                              <div className="space-y-1.5">
                                <div>
                                  <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-0.5">Rate (R/hr) *</label>
                                  <div className="relative">
                                    <span className="absolute left-2.5 top-1.5 text-xs font-bold text-security-navy-500">R</span>
                                    <input
                                      type="number"
                                      min="0.01"
                                      step="0.01"
                                      value={cellRate}
                                      onChange={(e) => setCellRate(e.target.value)}
                                      placeholder="32.44"
                                      className="input-compact pl-7 w-full font-mono font-bold text-sm"
                                      autoFocus
                                      required
                                    />
                                  </div>
                                </div>
                                <div>
                                  <label className="block text-[10px] uppercase font-bold text-security-navy-600 mb-0.5">Effective Date *</label>
                                  <input
                                    type="date"
                                    value={cellEffectiveFrom}
                                    onChange={(e) => setCellEffectiveFrom(e.target.value)}
                                    className="input-compact w-full text-xs"
                                    required
                                  />
                                </div>
                              </div>
                              {cellRate && !isNaN(Number(cellRate)) && Number(cellRate) > 0 && (
                                <p className="text-xs text-emerald-800 font-semibold bg-emerald-50 px-2 py-1 rounded border border-emerald-200">
                                  {area.name} {grade.name} = R{Number(cellRate).toFixed(2)}/hr
                                </p>
                              )}
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={saveCellRate}
                                  className="btn-primary text-xs py-1 px-3"
                                >
                                  Save Price
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditing(null)}
                                  className="text-xs text-security-navy-600 hover:text-security-navy-900 underline"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5">
                              {value ? (
                                <div className="space-y-1">
                                  <div className="flex items-baseline gap-1.5">
                                    <span className="text-base font-bold font-mono text-emerald-700">
                                      R{Number(value.hourlyRate).toFixed(2)}
                                    </span>
                                    <span className="text-xs text-security-navy-500 font-medium">/hr</span>
                                  </div>
                                  <div className="inline-block px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-[11px] font-semibold text-emerald-900">
                                    {area.name} {grade.name} = R{Number(value.hourlyRate).toFixed(2)}
                                  </div>
                                  <p className="text-[10px] text-security-navy-500">
                                    Effective {value.effectiveFrom.slice(0, 10)}
                                  </p>
                                </div>
                              ) : (
                                <div>
                                  <span className="text-xs font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200 inline-block mb-1">
                                    No price set
                                  </span>
                                  <p className="text-[10px] text-security-navy-400">
                                    {area.name} {grade.name} not priced
                                  </p>
                                </div>
                              )}

                              {canEdit && (
                                <div className="flex items-center gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditing({ areaId: area.id, gradeId: grade.id, areaName: area.name, gradeName: grade.name });
                                      setCellRate(value?.hourlyRate ? String(value.hourlyRate) : "");
                                    }}
                                    className="text-xs font-semibold text-security-navy-900 hover:underline bg-security-navy-100 hover:bg-security-navy-200 px-2 py-1 rounded transition"
                                  >
                                    {value ? "Edit price" : "Set price"}
                                  </button>
                                  {history.length > 0 && (
                                    <button
                                      type="button"
                                      onClick={() => setHistoryKey(historyKey === key ? null : key)}
                                      className="text-[11px] text-security-navy-500 hover:text-security-navy-800 underline"
                                    >
                                      History ({history.length})
                                    </button>
                                  )}
                                </div>
                              )}

                              {historyKey === key && (
                                <div className="mt-2 p-2 bg-security-navy-50 rounded border border-security-navy-200 text-[10px] space-y-1">
                                  <p className="font-bold text-security-navy-700 uppercase tracking-wider text-[9px]">Rate History</p>
                                  {history.map((entry) => (
                                    <div key={entry.id} className="flex justify-between text-security-navy-800">
                                      <span>{entry.effectiveFrom.slice(0, 10)}:</span>
                                      <span className="font-mono font-semibold">R{Number(entry.hourlyRate).toFixed(2)}/hr</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="p-3 bg-security-navy-50/60 rounded-lg border border-security-navy-200">
            <h4 className="text-xs font-bold text-security-navy-900 uppercase tracking-wider mb-2">Active Wage Matrix Summary</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {activeAreas.flatMap((area) =>
                activeGrades.map((grade) => {
                  const rateObj = current(area.id, grade.id);
                  return (
                    <div
                      key={`${area.id}-${grade.id}`}
                      className={`p-2 rounded border text-xs flex justify-between items-center ${
                        rateObj
                          ? "bg-white border-security-navy-200 text-security-navy-900"
                          : "bg-amber-50/50 border-amber-200 text-amber-800"
                      }`}
                    >
                      <span className="font-semibold">{area.name} {grade.name}</span>
                      <span className={`font-mono font-bold ${rateObj ? "text-emerald-700" : "text-amber-700"}`}>
                        {rateObj ? `R${Number(rateObj.hourlyRate).toFixed(2)}/hr` : "Unset"}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PayGradesSection({
  grades,
  token,
  onRefresh,
  groupId,
  canCreate,
  canDelete,
}: {
  grades: PayGrade[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState("");
  const [hourlyRate, setHourlyRate] = useState("");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), hourlyRate: parseFloat(hourlyRate) };
      if (groupId) body.groupId = groupId;
      const res = await authFetch("/payroll/pay-grades", token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName("");
        setHourlyRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    const confirmed = await confirm({
      title: "Delete pay grade?",
      message: "This removes the pay grade if it is not currently in use.",
      confirmLabel: "Delete pay grade",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`/payroll/pay-grades/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Pay grades</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact flex-1 min-w-0"
          required
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={hourlyRate}
          onChange={(e) => setHourlyRate(e.target.value)}
          placeholder="R/hr"
          className="input-compact w-20"
          required
        />
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">
          {saving ? "…" : "Add"}
        </button>
      </form>}
      <div className="space-y-1">
        {grades.map((g) => (
          <div key={g.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{g.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              R{Number(g.hourlyRate).toFixed(2)}/hr
              {canDelete && <button type="button" onClick={() => handleDelete(g.id)} className="text-red-600 hover:text-red-700 text-xs" aria-label={`Delete ${g.name}`}>×</button>}
            </span>
          </div>
        ))}
        {grades.length === 0 && <p className="text-security-navy-500 text-xs py-1">No pay grades yet</p>}
      </div>
    </div>
  );
}

function PayRulesSection({
  payRules,
  token,
  onRefresh,
  groupId,
  canEdit,
}: {
  payRules: PayRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canEdit: boolean;
}) {
  const ruleLabels: Record<string, string> = {
    overtime: "Overtime multiplier",
    sunday: "Sunday multiplier",
    public_holiday: "Public holiday multiplier",
  };
  const defaultMult: Record<string, number> = {
    overtime: 1.5,
    sunday: 2.0,
    public_holiday: 2.0,
  };

  const handleSave = async (ruleType: string, multiplier: number) => {
    if (!canEdit) return;
    try {
      const url = groupId
        ? `/payroll/groups/${groupId}/pay-rules`
        : "/payroll/pay-rules";
      await authFetch(url, token, {
        method: "PUT",
        body: JSON.stringify({ ruleType, multiplier }),
      });
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  const ruleTypesToShow = groupId
    ? (["overtime", "sunday", "public_holiday"] as const).filter((rt) =>
        payRules.some((r) => r.ruleType === rt)
      )
    : (["overtime", "sunday", "public_holiday"] as const);

  return (
    <div className={CONFIG_SECTION_CLASS}>
      <h3 className="label-text mb-3">Pay rules</h3>
      <div className="space-y-2">
        {ruleTypesToShow.map((rt) => {
          const rule = payRules.find((r) => r.ruleType === rt);
          const mult = rule ? Number(rule.multiplier) : defaultMult[rt];
          return (
            <div key={rt} className="flex items-center justify-between text-sm">
              <span className="text-security-navy-600">{ruleLabels[rt]}</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="10"
                  defaultValue={mult}
                  disabled={!canEdit}
                  className="input-compact w-16"
                  onBlur={(e) => {
                    const v = parseFloat(e.target.value);
                    if (!isNaN(v) && v >= 0 && v <= 10) handleSave(rt, v);
                  }}
                />
                <span className="text-security-navy-400 text-xs cursor-default select-none" title="multiplier (edit value to change)">×</span>
              </div>
            </div>
          );
        })}
        {groupId && ruleTypesToShow.length === 0 && (
          <p className="text-security-navy-500 text-xs py-1">
            No pay rules configured for this group.
          </p>
        )}
        {canEdit && groupId && ruleTypesToShow.length < 3 && (
          <AddPayRuleRow
            existingTypes={ruleTypesToShow}
            onRefresh={onRefresh}
            token={token}
            groupId={groupId}
          />
        )}
      </div>
    </div>
  );
}

function AddPayRuleRow({
  existingTypes,
  onRefresh,
  token,
  groupId,
}: {
  existingTypes: readonly string[];
  onRefresh: () => void;
  token: string;
  groupId: string;
}) {
  const [adding, setAdding] = useState(false);
  const [ruleType, setRuleType] = useState<string>("");
  const [multiplier, setMultiplier] = useState("1.5");

  const ruleLabels: Record<string, string> = {
    overtime: "Overtime",
    sunday: "Sunday",
    public_holiday: "Public holiday",
  };
  const defaultMult: Record<string, number> = {
    overtime: 1.5,
    sunday: 2.0,
    public_holiday: 2.0,
  };
  const available = (["overtime", "sunday", "public_holiday"] as const).filter(
    (rt) => !existingTypes.includes(rt)
  );

  const handleAdd = async () => {
    if (!ruleType || available.length === 0) return;
    try {
      await authFetch(`/payroll/groups/${groupId}/pay-rules`, token, {
        method: "PUT",
        body: JSON.stringify({ ruleType, multiplier: parseFloat(multiplier) }),
      });
      setAdding(false);
      setRuleType("");
      setMultiplier("1.5");
      onRefresh();
    } catch (err) {
      console.error(err);
    }
  };

  if (available.length === 0) return null;

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-xs font-medium text-security-amber-700 hover:underline"
      >
        + Add {ruleLabels[available[0]]} rule
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-security-navy-100 pt-2">
      <select
        value={ruleType}
        onChange={(e) => {
          setRuleType(e.target.value);
          setMultiplier(String(defaultMult[e.target.value as keyof typeof defaultMult] ?? 1.5));
        }}
        className="input-compact"
      >
        <option value="">Select rule type</option>
        {available.map((rt) => (
          <option key={rt} value={rt}>
            {ruleLabels[rt]}
          </option>
        ))}
      </select>
      <input
        type="number"
        step="0.1"
        min="0"
        max="10"
        value={multiplier}
        onChange={(e) => setMultiplier(e.target.value)}
        placeholder="×"
        className="input-compact w-16"
      />
      <button
        type="button"
        onClick={handleAdd}
        disabled={!ruleType}
        className="btn-secondary text-xs py-1 px-2"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => setAdding(false)}
        className="text-xs text-security-navy-500 hover:underline"
      >
        Cancel
      </button>
    </div>
  );
}

function EarningsRulesSection({
  earnings,
  token,
  onRefresh,
  groupId,
  canCreate,
  canDelete,
}: {
  earnings: EarningsRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const baseUrl = groupId
    ? `/payroll/groups/${groupId}/earnings-rules`
    : "/payroll/earnings-rules";

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        appliesTo,
      };
      if (type === "fixed") body.amount = parseFloat(amount);
      else body.rate = parseFloat(rate);
      const res = await authFetch(baseUrl, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName("");
        setAmount("");
        setRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    const confirmed = await confirm({
      title: "Delete earnings rule?",
      message: "This removes the earnings rule if it is not currently in use.",
      confirmLabel: "Delete rule",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`${baseUrl}/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Earnings</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact min-w-[80px] flex-1"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="input-compact w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-compact w-16" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="input-compact w-16" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="input-compact w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>}
      <div className="space-y-1">
        {earnings.map((e) => (
          <div key={e.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{e.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              {e.type === "fixed" ? `R${Number(e.amount || 0).toFixed(2)}` : `${Number(e.rate || 0)}%`}
              {canDelete && <button type="button" onClick={() => handleDelete(e.id)} className="text-red-600 hover:text-red-700 text-xs" aria-label={`Delete ${e.name}`}>×</button>}
            </span>
          </div>
        ))}
        {earnings.length === 0 && <p className="text-security-navy-500 text-xs py-1">No earnings rules yet</p>}
      </div>
    </div>
  );
}

function DeductionRulesSection({
  deductions,
  token,
  onRefresh,
  groupId,
  canCreate,
  canDelete,
}: {
  deductions: DeductionRule[];
  token: string;
  onRefresh: () => void;
  groupId?: string | null;
  canCreate: boolean;
  canDelete: boolean;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"fixed" | "percentage">("fixed");
  const [amount, setAmount] = useState("");
  const [rate, setRate] = useState("");
  const [appliesTo, setAppliesTo] = useState("all");
  const [saving, setSaving] = useState(false);
  const { confirm, confirmDialog } = useConfirmDialog();

  const baseUrl = groupId
    ? `/payroll/groups/${groupId}/deduction-rules`
    : "/payroll/deduction-rules";

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canCreate) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        type,
        appliesTo,
      };
      if (type === "fixed") body.amount = parseFloat(amount);
      else body.rate = parseFloat(rate);
      const res = await authFetch(baseUrl, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setName("");
        setAmount("");
        setRate("");
        onRefresh();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!canDelete) return;
    const confirmed = await confirm({
      title: "Delete deduction rule?",
      message: "This removes the deduction rule if it is not currently in use.",
      confirmLabel: "Delete rule",
    });
    if (!confirmed) return;
    try {
      const res = await authFetch(`${baseUrl}/${id}`, token, { method: "DELETE" });
      if (res.ok) onRefresh();
      else alert("Failed to delete. It may be in use.");
    } catch (err) {
      console.error(err);
      alert("Failed to delete.");
    }
  };

  return (
    <div className={CONFIG_SECTION_CLASS}>
      {confirmDialog}
      <h3 className="label-text mb-3">Deductions</h3>
      {canCreate && <form onSubmit={handleAdd} className="flex flex-wrap gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name"
          className="input-compact min-w-[80px] flex-1"
          required
        />
        <select value={type} onChange={(e) => setType(e.target.value as "fixed" | "percentage")} className="input-compact w-20">
          <option value="fixed">R</option>
          <option value="percentage">%</option>
        </select>
        {type === "fixed" ? (
          <input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" className="input-compact w-16" required />
        ) : (
          <input type="number" step="0.01" min="0" max="100" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="0" className="input-compact w-16" required />
        )}
        <select value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} className="input-compact w-20">
          <option value="all">All</option>
          <option value="security">Sec</option>
          <option value="office">Off</option>
        </select>
        <button type="submit" disabled={saving} className="btn-secondary text-xs py-1.5 px-2">{saving ? "…" : "Add"}</button>
      </form>}
      <div className="space-y-1">
        {deductions.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-security-navy-50">
            <span className="text-security-navy-900">{d.name}</span>
            <span className="flex items-center gap-2 font-mono text-security-navy-600">
              {d.type === "fixed" ? `R${Number(d.amount || 0).toFixed(2)}` : `${Number(d.rate || 0)}%`}
              {canDelete && <button type="button" onClick={() => handleDelete(d.id)} className="text-red-600 hover:text-red-700 text-xs" title="Delete" aria-label={`Delete ${d.name}`}>×</button>}
            </span>
          </div>
        ))}
        {deductions.length === 0 && <p className="text-security-navy-500 text-xs py-1">No deduction rules yet</p>}
      </div>
    </div>
  );
}
