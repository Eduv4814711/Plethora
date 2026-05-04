"use client";

import type { InstructorSummary } from "./types";

interface StatCard {
  key: string;
  label: string;
  value: string;
  tone: string;
  filter: Partial<{
    status: string;
    complianceStatus: string;
    contractExpiry: string;
  }>;
}

export function InstructorStatsCards({
  summary,
  onFilterSelect,
}: {
  summary: InstructorSummary | null;
  onFilterSelect: (next: {
    status?: string;
    complianceStatus?: string;
    contractExpiry?: string;
  }) => void;
}) {
  const cards: StatCard[] = [
    {
      key: "total",
      label: "Total Instructors",
      value: String(summary?.totalInstructors ?? 0),
      tone: "border-slate-200 bg-white",
      filter: {},
    },
    {
      key: "active",
      label: "Active Instructors",
      value: String(summary?.activeInstructors ?? 0),
      tone: "border-emerald-200 bg-emerald-50/60",
      filter: { status: "active" },
    },
    {
      key: "expiring",
      label: "Expiring Contracts (30d)",
      value: String(summary?.expiringContracts ?? 0),
      tone: "border-amber-200 bg-amber-50/70",
      filter: { contractExpiry: "expiring_30" },
    },
    {
      key: "missing",
      label: "Missing Documents",
      value: String(summary?.missingDocuments ?? 0),
      tone: "border-red-200 bg-red-50/60",
      filter: { complianceStatus: "missing_contract" },
    },
    {
      key: "risk",
      label: "Suspended / Inactive",
      value: String(summary?.suspendedInactive ?? 0),
      tone: "border-slate-300 bg-slate-100/80",
      filter: { status: "suspended" },
    },
    {
      key: "score",
      label: "PSIRA Compliance Score",
      value: `${summary?.psiraComplianceScore ?? 0}%`,
      tone: "border-security-navy-200 bg-security-navy-50/70",
      filter: { complianceStatus: "high_risk" },
    },
  ];

  return (
    <div className="card-wireframe p-2 sm:p-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            onClick={() => onFilterSelect(card.filter)}
            className={`min-h-[3rem] rounded-security-lg border-2 px-3 py-2 text-left transition hover:shadow-security-card ${card.tone}`}
          >
            <div className="truncate label-text tracking-wide">{card.label}</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-black">{card.value}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
