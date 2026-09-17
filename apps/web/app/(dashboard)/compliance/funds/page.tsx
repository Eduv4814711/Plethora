"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchStatutoryPeriods,
  type StatutoryPeriod,
} from "@/lib/compliance-api";
import { authFetch } from "@/lib/api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonBlock,
} from "@/components/ui";

export default function FundsCompliancePage() {
  const { token } = useAuth();
  const [periods, setPeriods] = useState<StatutoryPeriod[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>("");
  const [contributions, setContributions] = useState<any[]>([]);
  const [fundSummary, setFundSummary] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadPeriods = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const res = await fetchStatutoryPeriods(token, { scheme: "PSSPF" });
      setPeriods(res.items);
      if (res.items.length > 0 && !selectedPeriodId) {
        setSelectedPeriodId(res.items[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load fund periods");
    } finally {
      setLoading(false);
    }
  }, [token, selectedPeriodId]);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  useEffect(() => {
    if (!token || !selectedPeriodId) return;
    const loadContributions = async () => {
      try {
        const [contribRes, sumRes] = await Promise.all([
          authFetch(`/compliance/statutory-periods/${selectedPeriodId}/contributions`, token).then((r) => r.json()),
          authFetch(`/compliance/statutory-periods/${selectedPeriodId}/fund-summary`, token).then((r) => r.json()),
        ]);
        setContributions(contribRes.items ?? []);
        setFundSummary(sumRes);
      } catch (err) {
        console.error("Failed to load fund details", err);
      }
    };
    loadContributions();
  }, [token, selectedPeriodId]);

  const exportCsv = () => {
    if (contributions.length === 0) return;
    const headers = ["Employee #", "Name", "ID Number", "Pensionable Earnings", "Employee (7.5%)", "Employer (7.5%)", "Total"];
    const rows = contributions.map((c) => [
      c.employee?.employeeNumber ?? "",
      `"${c.employee?.lastName ?? ""}, ${c.employee?.firstName ?? ""}"`,
      c.employee?.idNumber ?? "",
      c.pensionableOrFundEarnings,
      c.employeeAmount,
      c.employerAmount,
      c.totalAmount,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `PSSPF_Schedule_${selectedPeriodId}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="PSSPF & Provident Fund Schedules"
        description="Private Security Sector Provident Fund compliance, monthly member schedules, and contribution verification."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={exportCsv}
            disabled={contributions.length === 0}
          >
            Export Fund Schedule (CSV)
          </Button>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <div className="text-xs text-security-navy-500 font-medium uppercase tracking-wider">
            Sector Standard Rates
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Employee Share:</span>
              <span className="font-semibold text-security-navy-900">7.50%</span>
            </div>
            <div className="flex justify-between">
              <span>Employer Share:</span>
              <span className="font-semibold text-security-navy-900">7.50%</span>
            </div>
            <div className="flex justify-between text-xs text-security-navy-500 pt-1 border-t border-security-navy-100">
              <span>Governing Body:</span>
              <span>NBCPSS / PSSPF Board</span>
            </div>
          </div>
        </Card>

        <Card className="p-4">
          <div className="text-xs text-security-navy-500 font-medium uppercase tracking-wider">
            Active Period Summary
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span>Members Covered:</span>
              <span className="font-semibold text-security-navy-900">{fundSummary?.totalEmployees ?? 0} guards</span>
            </div>
            <div className="flex justify-between">
              <span>Pensionable Earnings:</span>
              <span className="font-semibold font-mono text-security-navy-900">
                R {(fundSummary?.pensionableEarnings ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between text-xs text-security-navy-500 pt-1 border-t border-security-navy-100">
              <span>Combined Remittance:</span>
              <span className="font-bold text-emerald-700 font-mono">
                R {(fundSummary?.combinedTotal ?? 0).toLocaleString()}
              </span>
            </div>
          </div>
        </Card>

        <Card className="p-4 flex flex-col justify-between">
          <div className="text-xs text-security-navy-500 font-medium uppercase tracking-wider">
            Select Fund Period
          </div>
          <div className="my-2">
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="input-modern w-full font-medium"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  PSSPF — {p.periodStart.slice(0, 7)} (Due: {p.dueDate.slice(0, 10)})
                </option>
              ))}
            </select>
          </div>
          <div className="text-[11px] text-security-navy-500">
            Must be remitted to fund administrators on or before the 7th of the following month.
          </div>
        </Card>
      </div>

      {/* Member Contribution Breakdown */}
      {loading ? (
        <SkeletonBlock className="h-64" />
      ) : contributions.length === 0 ? (
        <EmptyState
          title="No employee contributions recorded for this period"
          description="Contributions are captured automatically from payroll runs during payroll finalisation."
        />
      ) : (
        <Card className="overflow-hidden border border-security-navy-100">
          <div className="p-4 border-b border-security-navy-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-security-navy-900">
              Guard Contribution Schedule ({contributions.length} Members)
            </h3>
            <span className="text-xs text-security-navy-500">
              Calculated on basic salary & qualifying allowances per Bargaining Council agreement
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                <tr>
                  <th className="px-4 py-3">Employee</th>
                  <th className="px-4 py-3">ID Number</th>
                  <th className="px-4 py-3 text-right">Fund Earnings</th>
                  <th className="px-4 py-3 text-right">Employee (7.5%)</th>
                  <th className="px-4 py-3 text-right">Employer (7.5%)</th>
                  <th className="px-4 py-3 text-right">Total Remittance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {contributions.map((c) => (
                  <tr key={c.id} className="hover:bg-security-navy-50/30 transition-colors">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-security-navy-900">
                        {c.employee?.lastName}, {c.employee?.firstName}
                      </div>
                      <div className="text-xs text-security-navy-500 font-mono">
                        {c.employee?.employeeNumber}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-security-navy-500">
                      {c.employee?.idNumber || "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      R {Number(c.pensionableOrFundEarnings).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      R {Number(c.employeeAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs">
                      R {Number(c.employerAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-xs font-semibold text-emerald-700">
                      R {Number(c.totalAmount).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
