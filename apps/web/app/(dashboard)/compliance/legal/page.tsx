"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import {
  fetchLegalCases,
  createLegalCase,
  fetchRemediationPlans,
  createRemediationPlan,
  type LegalCase,
  type RemediationPlan,
  type ComplianceRiskLevel,
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

export default function LegalAndRemediationPage() {
  const { token, user } = useAuth();
  const canCreate = Boolean(user && hasCapability(user, "/compliance/legal", "create"));

  const [activeTab, setActiveTab] = useState<"cases" | "remediation">("cases");
  const [cases, setCases] = useState<LegalCase[]>([]);
  const [plans, setPlans] = useState<RemediationPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Create Case Modal
  const [showCaseModal, setShowCaseModal] = useState(false);
  const [caseNumber, setCaseNumber] = useState("");
  const [caseType, setCaseType] = useState("CCMA");
  const [caseTitle, setCaseTitle] = useState("");
  const [riskLevel, setRiskLevel] = useState<ComplianceRiskLevel>("MEDIUM");
  const [dateReceived, setDateReceived] = useState(new Date().toISOString().slice(0, 10));
  const [nextEventDate, setNextEventDate] = useState("");
  const [description, setDescription] = useState("");

  // Create Plan Modal
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [planTitle, setPlanTitle] = useState("");
  const [originalBalance, setOriginalBalance] = useState("");
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [agreementRef, setAgreementRef] = useState("");

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const [casesRes, plansRes] = await Promise.all([
        fetchLegalCases(token),
        fetchRemediationPlans(token),
      ]);
      setCases(casesRes.items);
      setPlans(plansRes.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load legal & remediation data");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      await createLegalCase(token, {
        caseNumber,
        caseType,
        title: caseTitle,
        riskLevel,
        dateReceived: new Date(dateReceived).toISOString(),
        nextEventDate: nextEventDate ? new Date(nextEventDate).toISOString() : undefined,
        description: description || undefined,
        status: "OPEN",
      });
      setShowCaseModal(false);
      setCaseNumber("");
      setCaseTitle("");
      setDescription("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create legal case");
    }
  };

  const handleCreatePlan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    try {
      const orig = parseFloat(originalBalance);
      await createRemediationPlan(token, {
        title: planTitle,
        originalBalance: orig,
        currentBalance: orig,
        installmentAmount: parseFloat(installmentAmount),
        frequency,
        startDate: new Date(startDate).toISOString(),
        externalAgreementReference: agreementRef || undefined,
        status: "ACTIVE",
      });
      setShowPlanModal(false);
      setPlanTitle("");
      setOriginalBalance("");
      setInstallmentAmount("");
      setAgreementRef("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create remediation plan");
    }
  };

  const getRiskBadgeVariant = (risk: string): "neutral" | "success" | "warning" | "error" => {
    switch (risk) {
      case "CRITICAL":
        return "error";
      case "HIGH":
        return "warning";
      default:
        return "neutral";
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Legal Cases, CCMA & AOD Remediation"
        description="Monitor statutory labor disputes, Commission for Conciliation, Mediation and Arbitration (CCMA) hearings, and formal debt repayment arrangements."
        actions={
          canCreate ? (
            <div className="flex space-x-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPlanModal(true)}
              >
                + Add Remediation Plan
              </Button>
              <Button
                size="sm"
                onClick={() => setShowCaseModal(true)}
              >
                + Add Legal Case
              </Button>
            </div>
          ) : undefined
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {/* Tabs */}
      <div className="flex border-b border-security-navy-100 space-x-4 text-sm font-medium">
        <button
          onClick={() => setActiveTab("cases")}
          className={`pb-2 transition-colors border-b-2 ${
            activeTab === "cases"
              ? "border-security-amber-500 text-security-amber-800 font-semibold"
              : "border-transparent text-security-navy-500 hover:text-security-navy-900"
          }`}
        >
          Disputes & CCMA Cases ({cases.length})
        </button>
        <button
          onClick={() => setActiveTab("remediation")}
          className={`pb-2 transition-colors border-b-2 ${
            activeTab === "remediation"
              ? "border-security-amber-500 text-security-amber-800 font-semibold"
              : "border-transparent text-security-navy-500 hover:text-security-navy-900"
          }`}
        >
          Remediation & AOD Plans ({plans.length})
        </button>
      </div>

      {loading ? (
        <SkeletonBlock className="h-64" />
      ) : activeTab === "cases" ? (
        cases.length === 0 ? (
          <EmptyState
            title="No open legal disputes or CCMA cases"
            description="Capture labor court, CCMA, Bargaining Council disputes, or regulatory litigation."
          />
        ) : (
          <Card className="overflow-hidden border border-security-navy-100">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                  <tr>
                    <th className="px-4 py-3">Case #</th>
                    <th className="px-4 py-3">Type & Title</th>
                    <th className="px-4 py-3">Risk Level</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Received Date</th>
                    <th className="px-4 py-3">Next Event Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100">
                  {cases.map((c) => (
                    <tr key={c.id} className="hover:bg-security-navy-50/30 transition-colors">
                      <td className="px-4 py-3 font-mono font-medium">{c.caseNumber}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-security-navy-900">{c.title}</div>
                        <div className="text-xs text-security-navy-500">{c.caseType}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getRiskBadgeVariant(c.riskLevel)}>
                          {c.riskLevel}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={c.status === "OPEN" ? "warning" : "neutral"}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-security-navy-500">
                        {c.dateReceived.slice(0, 10)}
                      </td>
                      <td className="px-4 py-3 text-xs font-medium">
                        {c.nextEventDate ? (
                          <span className="text-security-amber-700 font-medium">
                            {c.nextEventDate.slice(0, 10)}
                          </span>
                        ) : (
                          <span className="text-security-navy-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : (
        /* Remediation Plans */
        plans.length === 0 ? (
          <EmptyState
            title="No active AOD or statutory remediation plans"
            description="Agreements of Debt (AOD) or SARS deferred payment arrangements can be recorded here."
          />
        ) : (
          <Card className="overflow-hidden border border-security-navy-100">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-security-navy-50/70 text-xs font-semibold text-security-navy-600 uppercase border-b border-security-navy-100">
                  <tr>
                    <th className="px-4 py-3">Plan Title</th>
                    <th className="px-4 py-3">Agreement Ref</th>
                    <th className="px-4 py-3 text-right">Original Balance</th>
                    <th className="px-4 py-3 text-right">Current Balance</th>
                    <th className="px-4 py-3 text-right">Installment</th>
                    <th className="px-4 py-3">Frequency</th>
                    <th className="px-4 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-security-navy-100">
                  {plans.map((p) => (
                    <tr key={p.id} className="hover:bg-security-navy-50/30 transition-colors">
                      <td className="px-4 py-3 font-semibold text-security-navy-900">{p.title}</td>
                      <td className="px-4 py-3 text-xs font-mono text-security-navy-500">
                        {p.externalAgreementReference || "—"}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs">
                        R {Number(p.originalBalance).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-bold text-red-600">
                        R {Number(p.currentBalance).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs font-medium">
                        R {Number(p.installmentAmount).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-xs">{p.frequency}</td>
                      <td className="px-4 py-3">
                        <Badge variant={p.status === "ACTIVE" ? "success" : "neutral"}>
                          {p.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {/* Create Case Modal */}
      {showCaseModal && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Add Legal / Dispute Case</h2>
            <form onSubmit={handleCreateCase} className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Case # / Referral # *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. WECT1234-25"
                    value={caseNumber}
                    onChange={(e) => setCaseNumber(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Forum / Case Type</label>
                  <select
                    value={caseType}
                    onChange={(e) => setCaseType(e.target.value)}
                    className="input-modern w-full"
                  >
                    <option value="CCMA">CCMA</option>
                    <option value="LABOUR_COURT">Labour Court</option>
                    <option value="REGULATORY">PSiRA / Regulatory</option>
                    <option value="EMPLOYEE_DISPUTE">Internal Employee Dispute</option>
                    <option value="OTHER">Other Litigation</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="label-text mb-1 block">Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Unfair Dismissal Claim — Guard X"
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-text mb-1 block">Risk Level</label>
                  <select
                    value={riskLevel}
                    onChange={(e) => setRiskLevel(e.target.value as ComplianceRiskLevel)}
                    className="input-modern w-full"
                  >
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Date Received</label>
                  <input
                    type="date"
                    value={dateReceived}
                    onChange={(e) => setDateReceived(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Next Hearing Date</label>
                  <input
                    type="date"
                    value={nextEventDate}
                    onChange={(e) => setNextEventDate(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
              </div>

              <div>
                <label className="label-text mb-1 block">Description</label>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setShowCaseModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Record Case
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}

      {/* Create Plan Modal */}
      {showPlanModal && (
        <div className="fixed inset-0 bg-security-navy-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <Card className="w-full max-w-lg p-6 space-y-4 border border-security-navy-200 shadow-xl bg-white">
            <h2 className="text-lg font-bold text-security-navy-900">Add Remediation / AOD Plan</h2>
            <form onSubmit={handleCreatePlan} className="space-y-3 text-sm">
              <div>
                <label className="label-text mb-1 block">Plan Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NBCPSS Arrears Settlement AOD"
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  className="input-modern w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-text mb-1 block">Original Balance (ZAR) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={originalBalance}
                    onChange={(e) => setOriginalBalance(e.target.value)}
                    className="input-modern w-full font-mono"
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Installment Amount (ZAR) *</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={installmentAmount}
                    onChange={(e) => setInstallmentAmount(e.target.value)}
                    className="input-modern w-full font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="label-text mb-1 block">Frequency</label>
                  <select
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value)}
                    className="input-modern w-full"
                  >
                    <option value="MONTHLY">Monthly</option>
                    <option value="WEEKLY">Weekly</option>
                    <option value="BIWEEKLY">Biweekly</option>
                    <option value="QUARTERLY">Quarterly</option>
                  </select>
                </div>
                <div>
                  <label className="label-text mb-1 block">Start Date</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Agreement Ref #</label>
                  <input
                    type="text"
                    value={agreementRef}
                    onChange={(e) => setAgreementRef(e.target.value)}
                    className="input-modern w-full"
                  />
                </div>
              </div>

              <div className="flex justify-end space-x-2 pt-2">
                <Button variant="secondary" size="sm" type="button" onClick={() => setShowPlanModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit">
                  Save Plan
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
