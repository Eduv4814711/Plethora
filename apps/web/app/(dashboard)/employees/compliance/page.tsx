"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import {
  getCompanyComplianceReport,
  getCompanyComplianceSummary,
  type CompanyComplianceSummary,
  type EmployeeComplianceDetail,
  type OverallComplianceStatus,
} from "@/lib/msr-api";
import { authFetch } from "@/lib/api";
import { clsx } from "clsx";

export default function ComplianceReportPage() {
  const { token, user } = useAuth();
  const searchParams = useSearchParams();

  const [summary, setSummary] = useState<CompanyComplianceSummary | null>(null);
  const [report, setReport] = useState<EmployeeComplianceDetail[]>([]);
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [search, setSearch] = useState(searchParams.get("search") ?? searchParams.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [complianceFilter, setComplianceFilter] = useState<string>(searchParams.get("complianceStatus") ?? "ALL");
  const [expiryFilter, setExpiryFilter] = useState<string>(searchParams.get("expiryFilter") ?? "ALL");
  const [groupFilter, setGroupFilter] = useState<string>("ALL");
  const [gradeFilter, setGradeFilter] = useState<string>("ALL");

  const fetchGroups = useCallback(async () => {
    if (!token) return;
    try {
      const res = await authFetch("/employee-groups", token);
      const data = await res.json();
      setGroups(data.data || []);
    } catch {
      setGroups([]);
    }
  }, [token]);

  const fetchData = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const [sumData, repData] = await Promise.all([
        getCompanyComplianceSummary(token),
        getCompanyComplianceReport(token, {
          status: statusFilter !== "all" ? statusFilter : undefined,
          complianceStatus: complianceFilter !== "ALL" ? (complianceFilter as OverallComplianceStatus) : undefined,
          expiryFilter: expiryFilter !== "ALL" ? (expiryFilter as never) : undefined,
          groupId: groupFilter !== "ALL" ? groupFilter : undefined,
          psiraGrade: gradeFilter !== "ALL" ? gradeFilter : undefined,
          search: search.trim() || undefined,
          limit: 200,
        }),
      ]);

      setSummary(sumData);
      setReport(repData.items);
      setTotal(repData.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compliance report");
      setReport([]);
    } finally {
      setLoading(false);
    }
  }, [token, statusFilter, complianceFilter, expiryFilter, groupFilter, gradeFilter, search]);

  useEffect(() => {
    void fetchGroups();
  }, [fetchGroups]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  // Export CSV function
  const handleExportCsv = () => {
    if (report.length === 0) return;

    const headers = [
      "Employee ID",
      "First Name",
      "Last Name",
      "Employee Type",
      "Status",
      "PSiRA Grade",
      "PSiRA Reg Number",
      "Overall Compliance",
      "Total Required",
      "Verified Count",
      "Pending Count",
      "Expiring Count",
      "Expired Count",
      "Missing Count",
      "Required Items Detail",
    ];

    const rows = report.map((item) => {
      const nameParts = item.employeeName.split(" ");
      const firstName = nameParts[0] ?? "";
      const lastName = nameParts.slice(1).join(" ") ?? "";
      const reqDetails = item.requirements
        .map((r) => `${r.rule.label}: ${r.status}${r.expiryLabel ? ` (${r.expiryLabel})` : ""}`)
        .join(" | ");

      return [
        `"${item.employeeNumber}"`,
        `"${firstName}"`,
        `"${lastName}"`,
        `"${item.employeeType}"`,
        `"${item.status}"`,
        `"${item.psiraGrade ?? ""}"`,
        `"${item.psiraRegistrationNumber ?? ""}"`,
        `"${item.overallStatus}"`,
        item.summary.totalRequired,
        item.summary.verifiedCount,
        item.summary.pendingCount,
        item.summary.expiringCount,
        item.summary.expiredCount,
        item.summary.missingCount,
        `"${reqDetails.replace(/"/g, '""')}"`,
      ];
    });

    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `compliance-report-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-in space-y-6 text-security-navy-900">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href="/employees"
              className="text-xs font-bold uppercase tracking-wider text-security-navy-500 hover:text-security-navy-900 transition-colors"
            >
              ← Back to Team
            </Link>
          </div>
          <h1 className="page-title">Compliance & Certificate Management</h1>
          <p className="text-sm text-security-navy-600 mt-1">
            Monitor PSiRA credentials, statutory contracts, firearm competencies, and expiring qualifications across your workforce.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={report.length === 0}
            className="btn-secondary h-11 flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Export Compliance CSV
          </button>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-security border border-red-200 bg-red-50 text-red-700 text-sm" role="alert">
          {error}
        </div>
      )}

      {/* KPI Overview Summary */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-4 rounded-security-lg border-2 border-security-navy-100 bg-white shadow-security-card">
            <span className="text-[11px] font-bold uppercase tracking-wider text-security-navy-500 block">
              Active Staff
            </span>
            <span className="text-2xl font-extrabold text-security-navy-900 block mt-1">
              {summary.totalEmployees}
            </span>
            <span className="text-[10px] text-security-navy-500 font-semibold block mt-0.5">
              {summary.complianceRatePercent}% Compliant
            </span>
          </div>

          <div
            onClick={() => {
              setComplianceFilter("COMPLIANT");
              setExpiryFilter("ALL");
            }}
            className={clsx(
              "p-4 rounded-security-lg border-2 shadow-security-card cursor-pointer transition-colors",
              complianceFilter === "COMPLIANT"
                ? "border-security-emerald-500 bg-security-emerald-100/70"
                : "border-security-emerald-200 bg-security-emerald-50/50 hover:bg-security-emerald-50"
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-security-emerald-900 block">
              Fully Compliant
            </span>
            <span className="text-2xl font-extrabold text-security-emerald-800 block mt-1">
              {summary.fullyCompliantCount}
            </span>
            <span className="text-[10px] text-security-emerald-700 font-medium block mt-0.5">All required docs valid</span>
          </div>

          <div
            onClick={() => {
              setComplianceFilter("ATTENTION_REQUIRED");
              setExpiryFilter("ALL");
            }}
            className={clsx(
              "p-4 rounded-security-lg border-2 shadow-security-card cursor-pointer transition-colors",
              complianceFilter === "ATTENTION_REQUIRED"
                ? "border-security-amber-500 bg-security-amber-100/70"
                : "border-security-amber-200 bg-security-amber-50/50 hover:bg-security-amber-50"
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-security-amber-900 block">
              Attention Required
            </span>
            <span className="text-2xl font-extrabold text-security-amber-800 block mt-1">
              {summary.attentionRequiredCount}
            </span>
            <span className="text-[10px] text-security-amber-700 font-medium block mt-0.5">Pending or expiring</span>
          </div>

          <div
            onClick={() => {
              setComplianceFilter("NON_COMPLIANT");
              setExpiryFilter("ALL");
            }}
            className={clsx(
              "p-4 rounded-security-lg border-2 shadow-security-card cursor-pointer transition-colors",
              complianceFilter === "NON_COMPLIANT"
                ? "border-red-500 bg-red-100/70"
                : "border-red-200 bg-red-50/50 hover:bg-red-50"
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-900 block">
              Non-Compliant
            </span>
            <span className="text-2xl font-extrabold text-red-800 block mt-1">
              {summary.nonCompliantCount}
            </span>
            <span className="text-[10px] text-red-700 font-medium block mt-0.5">Missing or expired</span>
          </div>

          <div
            onClick={() => {
              setExpiryFilter("expiring_30d");
              setComplianceFilter("ALL");
            }}
            className={clsx(
              "p-4 rounded-security-lg border-2 shadow-security-card cursor-pointer transition-colors",
              expiryFilter === "expiring_30d"
                ? "border-security-amber-500 bg-security-amber-100/70"
                : "border-security-amber-200 bg-security-amber-50/50 hover:bg-security-amber-50"
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-security-amber-900 block">
              Expiring (30d)
            </span>
            <span className="text-2xl font-extrabold text-security-amber-800 block mt-1">
              {summary.documentsExpiringSoonCount}
            </span>
            <span className="text-[10px] text-security-amber-700 font-medium block mt-0.5">Urgent renewal</span>
          </div>

          <div
            onClick={() => {
              setExpiryFilter("missing_required");
              setComplianceFilter("ALL");
            }}
            className={clsx(
              "p-4 rounded-security-lg border-2 shadow-security-card cursor-pointer transition-colors",
              expiryFilter === "missing_required"
                ? "border-red-500 bg-red-100/70"
                : "border-red-200 bg-red-50/50 hover:bg-red-50"
            )}
          >
            <span className="text-[11px] font-bold uppercase tracking-wider text-red-900 block">
              Missing Required
            </span>
            <span className="text-2xl font-extrabold text-red-800 block mt-1">
              {summary.employeesMissingDocumentsCount}
            </span>
            <span className="text-[10px] text-red-700 font-medium block mt-0.5">Needs upload</span>
          </div>
        </div>
      )}

      {/* Filter Toolbar */}
      <div className="p-4 rounded-security-lg bg-white border-2 border-security-navy-100 shadow-security-card flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by name, ID, PSiRA registration..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-compact min-w-[200px] flex-1 max-w-sm"
        />

        <select
          value={complianceFilter}
          onChange={(e) => setComplianceFilter(e.target.value)}
          className="input-compact min-w-[150px]"
          aria-label="Compliance Status Filter"
        >
          <option value="ALL">All Compliance</option>
          <option value="COMPLIANT">Compliant</option>
          <option value="ATTENTION_REQUIRED">Attention Required</option>
          <option value="NON_COMPLIANT">Non-Compliant</option>
        </select>

        <select
          value={expiryFilter}
          onChange={(e) => setExpiryFilter(e.target.value)}
          className="input-compact min-w-[160px]"
          aria-label="Expiry Filter"
        >
          <option value="ALL">All Expiries</option>
          <option value="expiring_30d">Expiring in 30 days</option>
          <option value="expiring_60d">Expiring in 60 days</option>
          <option value="expired">Expired records</option>
          <option value="missing_required">Missing required</option>
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="input-compact min-w-[130px]"
          aria-label="Employment Status Filter"
        >
          <option value="all">All Employment</option>
          <option value="active">Active</option>
          <option value="training">Training</option>
          <option value="hired">Hired</option>
          <option value="reliever">Reliever</option>
          <option value="suspended">Suspended</option>
        </select>

        <select
          value={groupFilter}
          onChange={(e) => setGroupFilter(e.target.value)}
          className="input-compact min-w-[130px]"
          aria-label="Group Filter"
        >
          <option value="ALL">All Groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>

        <select
          value={gradeFilter}
          onChange={(e) => setGradeFilter(e.target.value)}
          className="input-compact min-w-[110px]"
          aria-label="PSiRA Grade Filter"
        >
          <option value="ALL">All Grades</option>
          <option value="A">Grade A</option>
          <option value="B">Grade B</option>
          <option value="C">Grade C</option>
          <option value="D">Grade D</option>
          <option value="E">Grade E</option>
        </select>

        {(complianceFilter !== "ALL" || expiryFilter !== "ALL" || statusFilter !== "all" || groupFilter !== "ALL" || gradeFilter !== "ALL" || search.trim()) && (
          <button
            type="button"
            onClick={() => {
              setComplianceFilter("ALL");
              setExpiryFilter("ALL");
              setStatusFilter("all");
              setGroupFilter("ALL");
              setGradeFilter("ALL");
              setSearch("");
            }}
            className="text-xs font-semibold text-security-navy-600 hover:text-security-navy-900 underline ml-auto"
          >
            Clear Filters
          </button>
        )}
      </div>

      {/* Compliance Matrix Table */}
      <div className="rounded-security-lg border-2 border-security-navy-100 bg-white overflow-hidden shadow-security-card">
        <div className="p-4 border-b border-security-navy-100 flex items-center justify-between bg-security-navy-50">
          <h2 className="text-sm font-bold text-security-navy-900">
            Personnel Compliance Audit List ({total} Records)
          </h2>
          <span className="text-xs text-security-navy-600">
            Real-time compliance validation
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-security-navy-500 animate-pulse">
            Loading compliance report…
          </div>
        ) : report.length === 0 ? (
          <div className="p-12 text-center text-security-navy-500">
            <p className="font-semibold text-security-navy-800">No personnel match your filter criteria.</p>
            <p className="text-xs text-security-navy-500 mt-1">Try broadening your search or filter options.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-security-navy-50/70 border-b-2 border-security-navy-100 text-[11px] font-bold uppercase tracking-wider text-security-navy-600">
                  <th className="py-3 px-4">Employee</th>
                  <th className="py-3 px-3">Role & Type</th>
                  <th className="py-3 px-3">PSiRA Details</th>
                  <th className="py-3 px-3">Statutory Requirements Checklist</th>
                  <th className="py-3 px-3">Qualifications / Certs</th>
                  <th className="py-3 px-3">Compliance Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {report.map((emp) => {
                  const isCompliant = emp.overallStatus === "COMPLIANT";
                  const isAttention = emp.overallStatus === "ATTENTION_REQUIRED";
                  const isNonCompliant = emp.overallStatus === "NON_COMPLIANT";

                  return (
                    <tr key={emp.employeeId} className="hover:bg-security-navy-50/60 transition-colors">
                      <td className="py-3.5 px-4">
                        <div>
                          <p className="font-bold text-security-navy-900">{emp.employeeName}</p>
                          <p className="text-[11px] text-security-navy-500 mt-0.5">ID: {emp.employeeNumber}</p>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div>
                          <p className="font-semibold text-security-navy-800">
                            {emp.employeeType === "general" ? "Office Staff" : "Security Officer"}
                          </p>
                          <p className="text-[10px] text-security-navy-500">{emp.jobRole || "—"}</p>
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div>
                          <p className="font-semibold text-security-navy-900">
                            {emp.psiraRegistrationNumber ? `Reg: ${emp.psiraRegistrationNumber}` : "No PSiRA #"}
                          </p>
                          <p className="text-[10px] text-security-navy-500">
                            {emp.psiraGrade ? `Grade: ${emp.psiraGrade}` : "No Grade"}
                          </p>
                        </div>
                      </td>

                      <td className="py-3.5 px-3 max-w-xs">
                        <div className="flex flex-wrap gap-1">
                          {emp.requirements.map((req) => (
                            <span
                              key={req.rule.type}
                              title={`${req.rule.label}: ${req.status}${req.expiryLabel ? ` (${req.expiryLabel})` : ""}`}
                              className={clsx(
                                "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-tight",
                                req.status === "VERIFIED" && "bg-security-emerald-100 text-security-emerald-900",
                                req.status === "VALID" && "bg-security-emerald-50 text-security-emerald-800",
                                req.status === "EXPIRING_SOON" && "bg-security-amber-200 text-security-amber-900",
                                req.status === "PENDING_VERIFICATION" && "bg-security-amber-100 text-security-amber-800",
                                req.status === "EXPIRED" && "bg-red-200 text-red-900",
                                req.status === "MISSING" && "bg-red-100 text-red-800",
                                req.status === "REJECTED" && "bg-red-200 text-red-900"
                              )}
                            >
                              {req.rule.type === "sa_id" && "ID"}
                              {req.rule.type === "employment_contract" && "Contract"}
                              {req.rule.type === "bank_details_proof" && "Bank"}
                              {req.rule.type.startsWith("psira_") && "PSiRA"}
                              {req.rule.type === "firearm_competency_certificate" && "Firearm"}
                              {req.rule.type === "drivers_licence" && "Driver"}
                              {req.rule.type === "prdp" && "PrDP"}
                              {!["sa_id", "employment_contract", "bank_details_proof", "firearm_competency_certificate", "drivers_licence", "prdp"].includes(req.rule.type) &&
                                !req.rule.type.startsWith("psira_") &&
                                req.rule.label.slice(0, 8)}
                              : {req.status === "VERIFIED" ? "✓" : req.status === "MISSING" ? "✕" : req.status === "EXPIRED" ? "!" : "⏳"}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <div className="space-y-0.5">
                          <span className="font-semibold text-security-navy-800">
                            {emp.activeCertificates.length} Certificate(s)
                          </span>
                          {emp.activeCertificates.slice(0, 2).map((c) => (
                            <p key={c.id} className="text-[10px] text-security-navy-500 truncate" title={c.label}>
                              • {c.label} {c.hasExpired ? "(Expired)" : c.isExpiringSoon ? "(Expiring)" : ""}
                            </p>
                          ))}
                        </div>
                      </td>

                      <td className="py-3.5 px-3">
                        <span
                          className={clsx(
                            "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                            isCompliant && "bg-security-emerald-100 text-security-emerald-900 border border-security-emerald-300",
                            isAttention && "bg-security-amber-100 text-security-amber-900 border border-security-amber-300",
                            isNonCompliant && "bg-red-100 text-red-900 border border-red-300"
                          )}
                        >
                          {isCompliant && "✓ "}
                          {isAttention && "⚠ "}
                          {isNonCompliant && "✕ "}
                          {emp.overallStatus.replace(/_/g, " ")}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <Link
                          href={`/employees?q=${encodeURIComponent(emp.employeeNumber)}`}
                          className="btn-secondary text-[11px] py-1 px-2.5 rounded"
                        >
                          Manage File →
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

