"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { getCompanyComplianceSummary, type CompanyComplianceSummary } from "@/lib/msr-api";
import { KpiStrip, Section, SkeletonBlock } from "@/components/ui";

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
    return <SkeletonBlock className="h-28 w-full" />;
  }

  if (!summary || summary.totalEmployees === 0) {
    return null;
  }

  return (
    <Section
      title="Workforce compliance"
      description={`${summary.totalEmployees} active personnel · ${summary.complianceRatePercent}% compliant`}
      action={
        <Link
          href="/employees/compliance"
          className="text-xs font-semibold text-security-navy-800 no-underline hover:underline"
        >
          View full report →
        </Link>
      }
    >
      <KpiStrip
        ariaLabel="Workforce compliance metrics"
        items={[
          {
            label: "Fully compliant",
            value: summary.fullyCompliantCount,
            tone: "success",
            href: "/employees/compliance?complianceStatus=COMPLIANT",
          },
          {
            label: "Expiring soon (30d)",
            value: summary.documentsExpiringSoonCount,
            tone: summary.documentsExpiringSoonCount > 0 ? "warning" : "default",
            href: "/employees/compliance?expiryFilter=expiring_30d",
          },
          {
            label: "Missing docs",
            value: summary.employeesMissingDocumentsCount,
            tone: summary.employeesMissingDocumentsCount > 0 ? "danger" : "default",
            href: "/employees/compliance?expiryFilter=missing_required",
          },
          {
            label: "Expired records",
            value: summary.employeesWithExpiredDocumentsCount,
            tone: summary.employeesWithExpiredDocumentsCount > 0 ? "danger" : "default",
            href: "/employees/compliance?expiryFilter=expired",
          },
        ]}
      />
    </Section>
  );
}
