"use client";

function formatDate(value?: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function label(daysRemaining: number | null): string {
  if (daysRemaining == null) return "Missing";
  if (daysRemaining < 0) return "Expired";
  if (daysRemaining <= 30) return "Expiring Soon";
  return "Valid";
}

function tone(daysRemaining: number | null): string {
  if (daysRemaining == null) return "border-security-navy-100 bg-security-navy-50 text-security-navy-700";
  if (daysRemaining < 0) return "border-red-200 bg-red-50 text-red-700";
  if (daysRemaining <= 30) return "border-security-amber-200 bg-security-amber-50 text-security-amber-700";
  return "border-security-emerald-200 bg-security-emerald-50 text-security-emerald-700";
}

export function ContractExpiryIndicator({
  contractEndDate,
  daysRemaining,
}: {
  contractEndDate?: string | null;
  daysRemaining: number | null;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-security-navy-600">{formatDate(contractEndDate)}</span>
      <span className={`inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone(daysRemaining)}`}>
        {label(daysRemaining)}
      </span>
    </div>
  );
}
