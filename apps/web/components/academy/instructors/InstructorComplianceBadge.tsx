"use client";

import type { ComplianceStatus } from "./types";

const LABELS: Record<string, string> = {
  compliant: "Compliant",
  attention_needed: "Attention Needed",
  high_risk: "High Risk",
  pending_review: "Pending Review",
  archived: "Archived",
  missing_contract: "Missing Contract",
  missing_certificate: "Missing Certificate",
  expired_contract: "Expired Contract",
  expired_certificate: "Expired Certificate",
};

function tone(status: string): string {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "attention_needed" || status === "pending_review") {
    return "border-amber-200 bg-amber-50 text-amber-700";
  }
  if (
    status === "high_risk" ||
    status === "missing_contract" ||
    status === "missing_certificate" ||
    status === "expired_contract" ||
    status === "expired_certificate"
  ) {
    return "border-red-200 bg-red-50 text-red-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

export function complianceLabel(value: string | ComplianceStatus | null | undefined): string {
  const key = (value ?? "").toString();
  return LABELS[key] ?? "Pending Review";
}

export function InstructorComplianceBadge({
  status,
  className = "",
}: {
  status: string | ComplianceStatus | null | undefined;
  className?: string;
}) {
  const normalized = (status ?? "pending_review").toString();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${tone(normalized)} ${className}`.trim()}
    >
      {complianceLabel(normalized)}
    </span>
  );
}
