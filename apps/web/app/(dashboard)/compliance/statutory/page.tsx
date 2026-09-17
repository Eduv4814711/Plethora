"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  fetchStatutoryPeriods,
  advanceStatutoryPeriod,
  recordStatutoryPayment,
  type StatutoryPeriod,
  type StatutoryScheme,
} from "@/lib/compliance-api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SkeletonBlock,
} from "@/components/ui";

const SCHEMES: StatutoryScheme[] = ["PAYE", "UIF", "SDL", "PSSPF", "NBCPSS", "COIDA"];

export default function StatutoryReconciliationPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/compliance/statutory", "create"));
  const canApprove = Boolean(user && hasCapability(user, "/compliance/statutory", "approve"));

  const [periods, setPeriods] = useState<StatutoryPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [schemeFilter, setSchemeFilter] = useState<string>("");

  // Payment modal
  const [paymentPeriod, setPaymentPeriod] = useState<StatutoryPeriod | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentRef, setPaymentRef] = useState("");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));

  // Advance modal
  const [advancePeriod, setAdvancePeriod] = useState<StatutoryPeriod | null>(null);
  const [declaredTotal, setDeclaredTotal] = useState("");
  const [advanceNotes, setAdvanceNotes] = useState("");

  const loadPeriods = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const res = await fetchStatutoryPeriods(token, {
        scheme: schemeFilter || undefined,
      });
      setPeriods(res.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load statutory periods");
    } finally {
      setLoading(false);
    }
  }, [token, schemeFilter]);

  useEffect(() => {
    loadPeriods();
  }, [loadPeriods]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !paymentPeriod) return;
    try {
      await recordStatutoryPayment(token, paymentPeriod.id, {
        amount: parseFloat(paymentAmount),
        paymentDate: new Date(paymentDate).toISOString(),
        paymentReference: paymentRef || undefined,
        status: "SUCCESS",
      });
      setPaymentPeriod(null);
      setPaymentAmount("");
      setPaymentRef("");
      await loadPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record statutory payment");
    }
  };

  const handleAdvanceStatus = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !advancePeriod) return;
    try {
      await advanceStatutoryPeriod(token, advancePeriod.id, {
        targetStatus: "DECLARED",
        declaredTotal: declaredTotal ? parseFloat(declaredTotal) : undefined,
        notes: advanceNotes || undefined,
      });
      setAdvancePeriod(null);
      setDeclaredTotal("");
      setAdvanceNotes("");
      await loadPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to declare period");
    }
  };

  const getStatusBadgeVariant = (status: string): "neutral" | "success" | "warning" | "error" => {
    switch (status) {
      case "PAID":
        return "success";
      case "DECLARED":
      case "PARTIALLY_PAID":
        return "warning";
      case "OVERDUE":
      case "FAILED":
        return "error";
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Reconciliation & EMP201 Lifecycle"
        description="Verify calculated liabilities against SARS EMP201, uFiling, and Bargaining Council declarations and record verified payments."
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Scheme selector */}
      <Card className="p-4">
        <div className="flex items-center space-x-2 overflow-x-auto no-scrollbar">
          <Button
            variant={schemeFilter === "" ? "primary" : "secondary"}
            size="sm"
            onClick={() => setSchemeFilter("")}
          >
            All Schemes
          </Button>
          {SCHEMES.map((scheme) => (
            <Button
              key={scheme}
              variant={schemeFilter === scheme ? "primary" : "secondary"}
              size="sm"
              onClick={() => setSchemeFilter(scheme)}
            >
              {scheme}
            </Button>
          ))}
        </div>
      </Card>

      {/* Periods Table */}
      {loading ? (
        <SkeletonBlock className="h-64" />
      ) : periods.length === 0 ? (
        <EmptyState
          title="No statutory periods found"
          description="Statutory periods are automatically synced from approved payroll runs or can be captured manually."
        />
      ) : (
        <Card className="overflow-hidden border border-security-navy-100">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                <tr>
                  <th className="px-4 py-3">Scheme & Period</th>
                  <th className="px-4 py-3">Due Date</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Expected (Payroll)</th>
                  <th className="px-4 py-3">Declared (EMP201)</th>
                  <th className="px-4 py-3">Paid Total</th>
                  <th className="px-4 py-3">Outstanding</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {periods.map((p) => (
                  <tr key={p.id} className="hover:bg-security-navy-50/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-security-navy-900">{p.scheme}</div>
                      <div className="text-xs text-security-navy-500">
                        {p.periodStart.slice(0, 7)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className={new Date(p.dueDate) < new Date() && p.status !== "PAID" ? "text-red-600 font-semibold" : ""}>
                        {p.dueDate.slice(0, 10)}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={getStatusBadgeVariant(p.status)}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      R {p.expectedTotal.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {p.declaredTotal != null ? (
                        <span>R {p.declaredTotal.toLocaleString()}</span>
                      ) : (
                        <span className="text-security-navy-400">—</span>
                      )}
                      {p.varianceExpectedVsDeclared != null && p.varianceExpectedVsDeclared !== 0 && (
                        <div
                          className={`text-[10px] ${
                            p.varianceExpectedVsDeclared > 0 ? "text-red-600" : "text-emerald-700"
                          }`}
                        >
                          Var: {p.varianceExpectedVsDeclared > 0 ? "+" : ""}R{" "}
                          {p.varianceExpectedVsDeclared.toLocaleString()}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-emerald-700 font-medium">
                      R {p.successfulPaidTotal.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs font-semibold">
                      {p.outstandingAmount > 0 ? (
                        <span className="text-red-600">
                          R {p.outstandingAmount.toLocaleString()}
                        </span>
                      ) : (
                        <span className="text-emerald-700">R 0.00</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-1">
                      {canApprove && p.status === "CALCULATED" && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setAdvancePeriod(p);
                            setDeclaredTotal(String(p.expectedTotal));
                          }}
                        >
                          Declare
                        </Button>
                      )}
                      {canCreate && p.outstandingAmount > 0 && (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setPaymentPeriod(p);
                            setPaymentAmount(String(p.outstandingAmount));
                          }}
                        >
                          Record Pay
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Record Payment Modal */}
      {paymentPeriod && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Record Statutory Payment</h2>
            <p className="text-xs text-security-navy-500">
              Capturing payment against {paymentPeriod.scheme} period ending {paymentPeriod.periodEnd.slice(0, 10)}.
            </p>
            <form onSubmit={handleRecordPayment} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Amount (ZAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  className="input-modern w-full font-mono"
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Payment Date *</label>
                <input
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Bank Reference / SARS PRN #</label>
                <input
                  type="text"
                  placeholder="e.g. 19-digit SARS payment reference"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setPaymentPeriod(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Confirm Payment
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Advance / Declare Modal */}
      {advancePeriod && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Declare {advancePeriod.scheme} Return</h2>
            <p className="text-xs text-security-navy-500">
              Confirm the filed total submitted via eFiling / uFiling / NBCPSS portal.
            </p>
            <form onSubmit={handleAdvanceStatus} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Declared Total (ZAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  value={declaredTotal}
                  onChange={(e) => setDeclaredTotal(e.target.value)}
                  className="input-modern w-full font-mono"
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Notes</label>
                <textarea
                  rows={2}
                  value={advanceNotes}
                  onChange={(e) => setAdvanceNotes(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setAdvancePeriod(null)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Mark Declared
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
