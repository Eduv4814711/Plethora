"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { format, parse, isValid, addMonths, subDays, getYear, getMonth, setMonth as setMonthOfDate, setYear as setYearOfDate } from "date-fns";
import { DayPicker } from "react-day-picker";
import "react-day-picker/style.css";

const DISPLAY_FORMAT = "dd/MM/yyyy";
const ISO_FORMAT = "yyyy-MM-dd";

interface DateInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** Show "Today" quick action (useful for commencement, etc.) */
  showToday?: boolean;
  /** Restrict to future dates only (e.g. PSIRA expiry) */
  futureOnly?: boolean;
  /** Restrict to past dates only (e.g. DOB) */
  pastOnly?: boolean;
  disabled?: boolean;
  required?: boolean;
}

export function DateInput({
  value,
  onChange,
  placeholder = "DD/MM/YYYY",
  className = "input-compact",
  ariaLabel,
  showToday = true,
  futureOnly = false,
  pastOnly = false,
  disabled = false,
  required = false,
}: DateInputProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [month, setMonth] = useState<Date>(() => {
    if (value) {
      const d = parse(value, ISO_FORMAT, new Date());
      return isValid(d) ? d : new Date();
    }
    return new Date();
  });
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync input display with value prop
  useEffect(() => {
    if (value) {
      const d = parse(value, ISO_FORMAT, new Date());
      setInputValue(isValid(d) ? format(d, DISPLAY_FORMAT) : "");
    } else {
      setInputValue("");
    }
  }, [value]);

  const selectedDate = value ? parse(value, ISO_FORMAT, new Date()) : undefined;
  const selectedValid = selectedDate && isValid(selectedDate);

  const handleSelect = useCallback(
    (date: Date | undefined) => {
      if (!date) {
        onChange("");
        setInputValue("");
      } else {
        onChange(format(date, ISO_FORMAT));
        setInputValue(format(date, DISPLAY_FORMAT));
        setMonth(date);
        setIsOpen(false); // Close on select – pick once and done
      }
    },
    [onChange]
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setInputValue(v);
    // Try parsing DD/MM/YYYY, DD-MM-YYYY, or yyyy-MM-dd (ISO)
    let parsed: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
      parsed = parse(v.trim(), ISO_FORMAT, new Date());
    } else {
      const normalized = v.replace(/-/g, "/");
      parsed = parse(normalized, "d/M/yyyy", new Date());
    }
    if (isValid(parsed)) {
      onChange(format(parsed, ISO_FORMAT));
      setMonth(parsed);
    } else {
      onChange("");
    }
  };

  const today = new Date();
  const handleToday = () => handleSelect(today);
  const handleYesterday = () => handleSelect(subDays(today, 1));
  const handleNextMonth = () => handleSelect(addMonths(new Date(today.getFullYear(), today.getMonth(), 1), 1));

  // Year range for "Go to" dropdown
  const currentYear = getYear(today);
  const yearStart = pastOnly ? currentYear - 100 : futureOnly ? currentYear - 1 : currentYear - 100;
  const yearEnd = futureOnly ? currentYear + 20 : pastOnly ? currentYear : currentYear + 20;
  const years = Array.from({ length: yearEnd - yearStart + 1 }, (_, i) => yearStart + i);
  if (pastOnly) years.reverse();

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const handleGoToMonth = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const m = parseInt(e.target.value, 10);
    if (!isNaN(m)) setMonth(setMonthOfDate(month, m));
  };
  const handleGoToYear = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const y = parseInt(e.target.value, 10);
    if (!isNaN(y)) setMonth(setYearOfDate(month, y));
  };
  const handleClear = () => {
    onChange("");
    setInputValue("");
    setIsOpen(false);
  };

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const disabledMatcher = (date: Date) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    if (futureOnly) return d < today;
    if (pastOnly) return d > today;
    return false;
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-1">
        <input
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={className}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          disabled={disabled}
          required={required}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setIsOpen((o) => !o)}
          className={`shrink-0 px-2.5 rounded-[10px] border-2 border-security-navy-200 bg-white text-black hover:bg-neutral-100 transition-colors outline-none ${className.includes("input-compact") ? "py-2" : "py-2.5"}`}
          aria-label="Open calendar"
          disabled={disabled}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="4" rx="2" ry="2" />
            <line x1="16" x2="16" y1="2" y2="6" />
            <line x1="8" x2="8" y1="2" y2="6" />
            <line x1="3" x2="21" y1="10" y2="10" />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Choose date"
          className="absolute left-0 top-full z-50 mt-1 p-3 min-w-[300px] rounded-[10px] border-2 border-security-navy-200 bg-white"
        >
          <div className="rdp-root">
            <DayPicker
              mode="single"
              selected={selectedValid ? selectedDate : undefined}
              onSelect={handleSelect}
              month={month}
              onMonthChange={setMonth}
              disabled={disabledMatcher}
              defaultMonth={selectedValid ? selectedDate : month}
              showOutsideDays
              captionLayout="label"
              navLayout="around"
              className="text-sm"
              autoFocus
            />
          </div>
          <div className="flex flex-wrap gap-2 mt-2 pt-2 border-t-2 border-security-navy-200">
            <div className="w-full flex gap-2 items-center">
              <span className="text-[10px] font-medium uppercase tracking-wider text-black shrink-0">Go to</span>
              <select
                value={getMonth(month)}
                onChange={handleGoToMonth}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-[8px] border-2 border-security-navy-200 bg-white"
                aria-label="Jump to month"
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={i} value={i}>
                    {name}
                  </option>
                ))}
              </select>
              <select
                value={getYear(month)}
                onChange={handleGoToYear}
                className="flex-1 min-w-0 px-2 py-1 text-xs rounded-[8px] border-2 border-security-navy-200 bg-white"
                aria-label="Jump to year"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            {showToday && (
              <button
                type="button"
                onClick={handleToday}
                className="flex-1 min-w-[4rem] py-1.5 text-xs font-medium rounded-[8px] border-2 border-security-navy-200 bg-white hover:bg-neutral-100 transition-colors"
              >
                Today
              </button>
            )}
            {!futureOnly && (
              <button
                type="button"
                onClick={handleYesterday}
                className="flex-1 min-w-[4rem] py-1.5 text-xs font-medium rounded-[8px] border-2 border-security-navy-200 bg-white hover:bg-neutral-100 transition-colors"
              >
                Yesterday
              </button>
            )}
            {futureOnly && (
              <button
                type="button"
                onClick={handleNextMonth}
                className="flex-1 min-w-[4rem] py-1.5 text-xs font-medium rounded-[8px] border-2 border-security-navy-200 bg-white hover:bg-neutral-100 transition-colors"
              >
                Next month
              </button>
            )}
            <button
              type="button"
              onClick={handleClear}
              className="flex-1 min-w-[4rem] py-1.5 text-xs font-medium rounded-[8px] border-2 border-security-navy-200 bg-white hover:bg-neutral-100 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
