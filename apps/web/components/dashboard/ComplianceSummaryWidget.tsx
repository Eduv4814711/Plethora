"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getCompanyComplianceSummary, type CompanyComplianceSummary } from "@/lib/msr-api";
import { clsx } from "clsx";

export function ComplianceSummaryWidget() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<CompanyComplianceSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    getCompanyComplianceSummary(token)
      .then(setSummary)
      .catch(() => setSummary(null))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return <div className="h-44 bg-security-navy-100 rounded-security-lg animate-pulse" />;
  }

  if (!summary || summary.totalEmployees === 0) {
    return null;
  }

  return (
    <div className="card-elevated p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="p-1.5 rounded-security bg-security-navy-50 text-security-navy-700 border border-security-navy-200">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </span>
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-security-navy-900">
              Workforce Compliance
            </h3>
            <p className="text-xs text-security-navy-500">
              {summary.totalEmployees} Active Personnel · {summary.complianceRatePercent}% Compliant
            </p>
          </div>
        </div>

        <Link
          href="/employees/compliance"
          className="text-xs font-bold uppercase tracking-wider text-security-navy-900 hover:underline flex items-center gap-1"
        >
          View Full Report →
        </Link>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Link
          href="/employees/compliance?complianceStatus=COMPLIANT"
          className="p-3 rounded-security border border-security-emerald-200 bg-security-emerald-50/50 hover:bg-security-emerald-100/60 transition-colors text-center"
        >
          <span className="text-xl font-extrabold text-security-emerald-800 block">
            {summary.fullyCompliantCount}
          </span>
          <span className="text-[11px] font-semibold text-security-emerald-900 uppercase tracking-wide">
            Fully Compliant
          </span>
        </Link>

        <Link
          href="/employees/compliance?expiryFilter=expiring_30d"
          className="p-3 rounded-security border border-security-amber-200 bg-security-amber-50/50 hover:bg-security-amber-100/60 transition-colors text-center"
        >
          <span className="text-xl font-extrabold text-security-amber-800 block">
            {summary.documentsExpiringSoonCount}
          </span>
          <span className="text-[11px] font-semibold text-security-amber-900 uppercase tracking-wide">
            Expiring Soon (30d)
          </span>
        </Link>

        <Link
          href="/employees/compliance?expiryFilter=missing_required"
          className="p-3 rounded-security border border-red-200 bg-red-50/50 hover:bg-red-100/60 transition-colors text-center"
        >
          <span className="text-xl font-extrabold text-red-800 block">
            {summary.employeesMissingDocumentsCount}
          </span>
          <span className="text-[11px] font-semibold text-red-900 uppercase tracking-wide">
            Missing Docs
          </span>
        </Link>

        <Link
          href="/employees/compliance?expiryFilter=expired"
          className="p-3 rounded-security border border-red-200 bg-red-50/50 hover:bg-red-100/60 transition-colors text-center"
        >
          <span className="text-xl font-extrabold text-red-800 block">
            {summary.employeesWithExpiredDocumentsCount}
          </span>
          <span className="text-[11px] font-semibold text-red-900 uppercase tracking-wide">
            Expired Records
          </span>
        </Link>
      </div>
    </div>
  );
}

