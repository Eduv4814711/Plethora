"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  fetchComplianceSummary,
  syncComplianceAlerts,
  type ComplianceSummary,
} from "@/lib/compliance-api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  PageHeader,
  SkeletonBlock,
} from "@/components/ui";

export default function ComplianceHubPage() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<ComplianceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncResult, setSyncResult] = useState<string | null>(null);

  const loadData = async () => {
    if (!token) return;
    try {
      setLoading(true);
      setError("");
      const data = await fetchComplianceSummary(token);
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compliance summary");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [token]);

  const handleSyncAlerts = async () => {
    if (!token) return;
    try {
      setSyncing(true);
      const res = await syncComplianceAlerts(token);
      setSyncResult(`Scanned ${res.scannedCount} obligations/liabilities, created ${res.createdCount} new alerts.`);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Alert sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-700 border-emerald-500/30 bg-emerald-50";
    if (score >= 60) return "text-amber-700 border-amber-500/30 bg-amber-50";
    return "text-red-700 border-red-500/30 bg-red-50";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Compliance & Risk Register"
        description="South African private security regulatory compliance, PSIRA & SARS obligation registers, and legal case tracking."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSyncAlerts}
            disabled={syncing}
          >
            {syncing ? "Scanning..." : "Sync Compliance Alerts"}
          </Button>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}
      {syncResult && <AlertBanner variant="info">{syncResult}</AlertBanner>}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <SkeletonBlock className="h-44" />
          <SkeletonBlock className="h-44" />
          <SkeletonBlock className="h-44" />
        </div>
      ) : summary ? (
        <>
          {/* Top Row: Overall Score & Operational Compliance Highlights */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Health Score Card */}
            <Card className="p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
                  Health Index
                </span>
                <span className="text-sm font-bold text-security-amber-600">PSiRA / SARS</span>
              </div>
              <div className="my-3 flex items-baseline space-x-2">
                <span className="text-4xl font-extrabold tracking-tight text-security-navy-900">
                  {summary.overallHealthScore}
                </span>
                <span className="text-security-navy-400 text-sm font-medium">/ 100</span>
              </div>
              <div>
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-semibold border ${getScoreColor(
                    summary.overallHealthScore
                  )}`}
                >
                  {summary.overallHealthScore >= 80
                    ? "Tender Ready"
                    : summary.overallHealthScore >= 60
                    ? "Attention Required"
                    : "High Regulatory Risk"}
                </span>
              </div>
            </Card>

            {/* Company Obligations Overview */}
            <Card className="p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
                  Company Obligations
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl font-bold text-security-navy-900">
                  {summary.obligations.compliant} / {summary.obligations.total} Compliant
                </div>
                <div className="text-xs text-security-navy-500 mt-0.5">
                  {summary.obligations.nonCompliant} non-compliant · {summary.obligations.attentionRequired} attention required
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-security-navy-600">
                  {summary.obligations.pendingVerification} pending verification
                </span>
                <Link
                  href="/compliance/company"
                  className="text-security-amber-700 hover:underline font-medium"
                >
                  Register →
                </Link>
              </div>
            </Card>

            {/* Legal & Remediation Risk */}
            <Card className="p-5 flex flex-col justify-between">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-security-navy-500 uppercase tracking-wider">
                  Disputes & Arrears
                </span>
              </div>
              <div className="my-2">
                <div className="text-2xl font-bold text-security-navy-900">
                  {summary.legalCases.openCount} Open Cases
                </div>
                <div className="text-xs text-security-navy-500 mt-0.5">
                  {summary.legalCases.highRiskCount} High/Critical exposure
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-security-navy-600">
                  AOD ({summary.remediations.activeCount}): R {summary.remediations.totalDebt.toLocaleString()}
                </span>
                <Link
                  href="/compliance/legal"
                  className="text-security-amber-700 hover:underline font-medium"
                >
                  Cases →
                </Link>
              </div>
            </Card>
          </div>

          {/* Bottom Grid: Quick Modules Navigation */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Obligations Breakdown */}
            <Card className="p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-security-navy-900">
                    Company Obligations
                  </h3>
                  <Badge variant="neutral">{summary.obligations.total} total</Badge>
                </div>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1 border-b border-security-navy-100">
                    <span className="text-emerald-700 font-medium">Compliant / Verified</span>
                    <span className="font-semibold">{summary.obligations.compliant}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-security-navy-100">
                    <span className="text-amber-700 font-medium">Attention Required</span>
                    <span className="font-semibold">{summary.obligations.attentionRequired}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-security-navy-100">
                    <span className="text-red-700 font-medium">Non-Compliant</span>
                    <span className="font-semibold">{summary.obligations.nonCompliant}</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-security-navy-500">Pending Verification</span>
                    <span className="font-semibold">{summary.obligations.pendingVerification}</span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-security-navy-100">
                <Link href="/compliance/company" className="w-full">
                  <Button variant="secondary" size="sm" className="w-full">
                    Open Obligations Register
                  </Button>
                </Link>
              </div>
            </Card>

            {/* Tender & Audit Reports */}
            <Card className="p-5 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-sm text-security-navy-900">
                    Tender Compliance Pack
                  </h3>
                </div>
                <p className="text-xs text-security-navy-500 mb-4">
                  One-click export of state tender compliance pack: PSiRA license, SARS Tax Clearance status, COIDA Letter of Good Standing, and company register proof.
                </p>
                <div className="bg-security-navy-50/70 rounded-security p-3 text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-security-navy-500">Tender Readiness:</span>
                    <span className="font-semibold text-emerald-700">
                      {summary.overallHealthScore >= 80 ? "Qualified" : "Deficiencies Detected"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-4 pt-3 border-t border-security-navy-100">
                <Link href="/compliance/reports" className="w-full">
                  <Button variant="secondary" size="sm" className="w-full">
                    Generate Tender Pack
                  </Button>
                </Link>
              </div>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
