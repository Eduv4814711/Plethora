"use client";

import { useEffect, useState } from "react";
import type { PayPeriodOption } from "@/lib/pay-periods";
import { pickPeriodLabel } from "@/lib/pay-periods";
import { fetchPayPeriods } from "@/lib/api";

type PayPeriodSelectProps = {
  token: string;
  variant?: "pay" | "roster";
  value: string;
  onChange: (period: PayPeriodOption) => void;
  className?: string;
  disabled?: boolean;
  showCurrentBadge?: boolean;
};

export function PayPeriodSelect({
  token,
  variant = "pay",
  value,
  onChange,
  className = "input-modern w-full",
  disabled = false,
  showCurrentBadge = true,
}: PayPeriodSelectProps) {
  const [periods, setPeriods] = useState<PayPeriodOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPayPeriods(token, { before: 12, after: 3 })
      .then((data) => {
        if (!cancelled) setPeriods(data);
      })
      .catch(console.error)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!value && periods.length > 0) {
      const current = periods.find((p) => p.isCurrent) ?? periods[periods.length - 1];
      if (current) onChange(current);
    }
  }, [value, periods, onChange]);

  return (
    <select
      value={value}
      onChange={(e) => {
        const next = periods.find((p) => p.periodKey === e.target.value);
        if (next) onChange(next);
      }}
      className={className}
      disabled={disabled || loading || periods.length === 0}
      aria-label={variant === "roster" ? "Roster period" : "Pay period"}
    >
      {loading && <option value="">Loading periods…</option>}
      {!loading && periods.length === 0 && <option value="">No periods</option>}
      {periods.map((p) => (
        <option key={p.periodKey} value={p.periodKey}>
          {pickPeriodLabel(p, variant)}
          {showCurrentBadge && p.isCurrent ? " (current)" : ""}
        </option>
      ))}
    </select>
  );
}
