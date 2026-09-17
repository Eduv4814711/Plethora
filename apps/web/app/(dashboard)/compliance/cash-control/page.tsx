"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  fetchCashFloor,
  fetchCashCommitments,
  createCashCommitment,
  deleteCashCommitment,
  recordCashSnapshot,
  type CashCommitment,
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

export default function CashFloorPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/compliance/cash-control", "create"));

  const [cashFloor, setCashFloor] = useState<any | null>(null);
  const [commitments, setCommitments] = useState<CashCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Snapshot modal
  const [showSnapshotModal, setShowSnapshotModal] = useState(false);
  const [availableCash, setAvailableCash] = useState("");
  const [snapshotNotes, setSnapshotNotes] = useState("");

  // Commitment modal
  const [showCommitmentModal, setShowCommitmentModal] = useState(false);
  const [commName, setCommName] = useState("");
  const [commCategory, setCommCategory] = useState("CRITICAL_SUPPLIER");
  const [commAmount, setCommAmount] = useState("");
  const [commFrequency, setCommFrequency] = useState("MONTHLY");
  const [commProtected, setCommProtected] = useState(true);
  const [commPayee, setCommPayee] = useState("");

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const [floorRes, commsRes] = await Promise.all([
        fetchCashFloor(token),
        fetchCashCommitments(token),
      ]);
      setCashFloor(floorRes);
      setCommitments(commsRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cash floor data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleRecordSnapshot = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await recordCashSnapshot(token, parseFloat(availableCash), snapshotNotes || undefined);
      setShowSnapshotModal(false);
      setAvailableCash("");
      setSnapshotNotes("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record cash snapshot");
    }
  };

  const handleCreateCommitment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createCashCommitment(token, {
        name: commName,
        category: commCategory,
        amount: parseFloat(commAmount),
        frequency: commFrequency,
        protected: commProtected,
        supplierOrPayee: commPayee || undefined,
        active: true,
      });
      setShowCommitmentModal(false);
      setCommName("");
      setCommAmount("");
      setCommPayee("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add commitment");
    }
  };

  const handleDeleteCommitment = async (id: string) => {
    if (!token || !confirm("Are you sure you want to remove this commitment?")) return;
    try {
      await deleteCashCommitment(token, id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete commitment");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Protected 30-Day Cash Floor & Commitments"
        description="Ring-fence essential payroll wages, statutory withholdings, and critical security fleet/supplier obligations against operational cash drains."
        actions={
          canCreate ? (
            <div className="flex space-x-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSnapshotModal(true)}
              >
                Capture Bank Balance
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCommitmentModal(true)}
              >
                + Add Commitment
              </Button>
            </div>
          ) : undefined
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Cash Floor Health Cards */}
      {loading ? (
        <SkeletonBlock className="h-44" />
      ) : cashFloor ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-4 flex flex-col justify-between">
            <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
              Protected 30-Day Floor
            </span>
            <div className="my-2">
              <div className="text-2xl font-bold font-mono text-security-navy-900">
                R {cashFloor.protectedCashFloor.toLocaleString()}
              </div>
              <div className="text-xs text-security-navy-500 mt-0.5">
                Total protected liabilities
              </div>
            </div>
            <div className="text-xs text-security-navy-600">
              Runway: <span className="font-semibold text-security-navy-900">{cashFloor.runwayMonths} month(s)</span>
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
              Available Cash Balance
            </span>
            <div className="my-2">
              <div className="text-2xl font-bold font-mono text-emerald-700">
                R {cashFloor.availableCash.toLocaleString()}
              </div>
              <div className="text-xs text-security-navy-500 mt-0.5">
                {cashFloor.latestSnapshotAt
                  ? `Snapshot: ${cashFloor.latestSnapshotAt.slice(0, 10)}`
                  : "No snapshot captured yet"}
              </div>
            </div>
            <div className="text-xs text-security-navy-600">
              {cashFloor.bufferOrShortfall >= 0 ? "Surplus Position" : "Deficit Position"}
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
              Protected Buffer
            </span>
            <div className="my-2">
              <div
                className={`text-2xl font-bold font-mono ${
                  cashFloor.bufferOrShortfall >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {cashFloor.bufferOrShortfall >= 0 ? "+" : ""}R{" "}
                {cashFloor.bufferOrShortfall.toLocaleString()}
              </div>
              <div className="text-xs text-security-navy-500 mt-0.5">
                Available cash vs 30-day floor
              </div>
            </div>
            <div>
              <Badge
                variant={
                  cashFloor.status === "HEALTHY"
                    ? "success"
                    : cashFloor.status === "TIGHT"
                    ? "warning"
                    : "error"
                }
              >
                {cashFloor.status}
              </Badge>
            </div>
          </Card>

          <Card className="p-4 flex flex-col justify-between">
            <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
              Floor Decomposition
            </span>
            <div className="text-xs space-y-1 my-1">
              <div className="flex justify-between">
                <span>Payroll:</span>
                <span className="font-mono font-medium">
                  R {cashFloor.breakdown.monthlyPayrollRequirement.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Commitments:</span>
                <span className="font-mono font-medium">
                  R {cashFloor.breakdown.protectedCommitmentsMonthly.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Statutory Due:</span>
                <span className="font-mono font-medium text-amber-700">
                  R {cashFloor.breakdown.totalOutstandingStatutory.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="text-[11px] text-security-navy-500">
              Based on corrected payroll burden
            </div>
          </Card>
        </div>
      ) : null}

      {/* Commitments Table */}
      <Card className="overflow-hidden border border-security-navy-100">
        <div className="p-4 border-b border-security-navy-100 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-security-navy-900">
              Recurring Commitments & Protected Outflows
            </h3>
            <p className="text-xs text-security-navy-500">
              Guard wages, vehicle leases, armed response insurance, firearm licenses, and critical communications.
            </p>
          </div>
          <Badge variant="neutral">{commitments.length} commitments</Badge>
        </div>

        {commitments.length === 0 ? (
          <EmptyState
            title="No commitments registered"
            description="Add recurring commitments like armed response fuel, control room connectivity, and insurance."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                <tr>
                  <th className="px-4 py-3">Commitment Name</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Payee</th>
                  <th className="px-4 py-3 text-right">Amount (ZAR)</th>
                  <th className="px-4 py-3">Frequency</th>
                  <th className="px-4 py-3">Protected Floor</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {commitments.map((c) => (
                  <tr key={c.id} className="hover:bg-security-navy-50/30 transition-colors">
                    <td className="px-4 py-3 font-semibold text-security-navy-900">{c.name}</td>
                    <td className="px-4 py-3 text-xs">{c.category.replace("_", " ")}</td>
                    <td className="px-4 py-3 text-xs text-security-navy-500">
                      {c.supplierOrPayee || "—"}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-medium">
                      R {Number(c.amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-xs">{c.frequency}</td>
                    <td className="px-4 py-3">
                      {c.protected ? (
                        <Badge variant="success">Protected</Badge>
                      ) : (
                        <Badge variant="neutral">Discretionary</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="btn-ghost text-xs text-red-600 hover:text-red-700"
                        onClick={() => handleDeleteCommitment(c.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Snapshot Modal */}
      {showSnapshotModal && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Capture Current Bank Balance</h2>
            <p className="text-xs text-security-navy-500">
              Record verified operational bank account balance to evaluate against the 30-day protected cash floor.
            </p>
            <form onSubmit={handleRecordSnapshot} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Total Available Cash (ZAR) *</label>
                <input
                  type="number"
                  step="0.01"
                  required
                  placeholder="e.g. 850000.00"
                  value={availableCash}
                  onChange={(e) => setAvailableCash(e.target.value)}
                  className="input-modern w-full font-mono"
                />
              </div>

              <div>
                <label className="label-text mb-1 block">Notes / Source Bank Statement</label>
                <textarea
                  rows={2}
                  placeholder="e.g. FNB Main Operating Account as of 09:00"
                  value={snapshotNotes}
                  onChange={(e) => setSnapshotNotes(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setShowSnapshotModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Save Snapshot
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Create Commitment Modal */}
      {showCommitmentModal && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-md p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Add Cash Commitment</h2>
            <form onSubmit={handleCreateCommitment} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Commitment Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Vehicle Fleet Tracker Leases"
                  value={commName}
                  onChange={(e) => setCommName(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Category</label>
                  <select
                    value={commCategory}
                    onChange={(e) => setCommCategory(e.target.value)}
                    className="input-modern w-full"
                  >
                    <option value="CRITICAL_SUPPLIER">Critical Supplier</option>
                    <option value="PAYROLL">Payroll Related</option>
                    <option value="STATUTORY">Statutory</option>
                    <option value="OPERATING_EXPENSE">Operating Expense</option>
                    <option value="CAPEX">CapEx / Equipment</option>
                    <option value="OTHER">Other</option>
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Amount (ZAR) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={commAmount}
                    onChange={(e) => setCommAmount(e.target.value)}
                    className="input-modern w-full font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Frequency</label>
                  <select
                    value={commFrequency}
                    onChange={(e) => setCommFrequency(e.target.value)}
                    className="input-modern w-full"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Biweekly</option>
                    <option value="QUARTERLY">Quarterly</option>
                    <option value="ANNUAL">Annual</option>
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Payee / Supplier</label>
                  <input
                    type="text"
                    value={commPayee}
                    onChange={(e) => setCommPayee(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="checkbox"
                  id="protectedCheckbox"
                  checked={commProtected}
                  onChange={(e) => setCommProtected(e.target.checked)}
                  className="rounded border-security-navy-300 text-security-amber-600 focus:ring-security-amber-500"
                />
                <label htmlFor="protectedCheckbox" className="text-xs font-medium cursor-pointer">
                  Protect in 30-Day Cash Floor calculation
                </label>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setShowCommitmentModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Save Commitment
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
