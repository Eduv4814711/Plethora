"use client";

import { SHIFT_TIME_OPTIONS, normalizeShiftTime } from "@/lib/shift-times";

type ShiftTimeSelectProps = {
  value: string;
  disabled?: boolean;
  onChange: (time: string) => void;
  className?: string;
  title?: string;
};

export function ShiftTimeSelect({ value, disabled, onChange, className, title }: ShiftTimeSelectProps) {
  const selected = normalizeShiftTime(value) || value;

  return (
    <select
      disabled={disabled}
      value={selected}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      title={title}
      aria-label={title}
    >
      {SHIFT_TIME_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
