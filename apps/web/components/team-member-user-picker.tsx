"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { searchTeamMemberCandidates, type TeamMemberCandidate } from "@/lib/api";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

function memberName(member: TeamMemberCandidate) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function memberLabel(member: TeamMemberCandidate) {
  const name = memberName(member);
  return member.employeeNumber ? `${name} (${member.employeeNumber})` : name;
}

type TeamMemberUserPickerProps = {
  token: string;
  selectedId: string | null;
  existingUserEmails?: string[];
  onSelect: (candidate: TeamMemberCandidate) => void;
  onClear: () => void;
  disabled?: boolean;
  className?: string;
};

export function TeamMemberUserPicker({
  token,
  selectedId,
  existingUserEmails = [],
  onSelect,
  onClear,
  disabled = false,
  className = "input-modern",
}: TeamMemberUserPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<TeamMemberCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedMember, setSelectedMember] = useState<TeamMemberCandidate | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(search, 300);
  const existingEmails = useRef(new Set(existingUserEmails.map((e) => e.toLowerCase())));

  useEffect(() => {
    existingEmails.current = new Set(existingUserEmails.map((e) => e.toLowerCase()));
  }, [existingUserEmails]);

  useEffect(() => {
    if (!selectedId) setSelectedMember(null);
  }, [selectedId]);

  const fetchResults = useCallback(async () => {
    if (debouncedSearch.trim().length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const data = await searchTeamMemberCandidates(token, debouncedSearch);
      setResults(data);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [token, debouncedSearch]);

  useEffect(() => {
    if (open) fetchResults();
  }, [open, fetchResults]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => searchRef.current?.focus(), 0);
      return () => window.clearTimeout(t);
    }
    setSearch("");
  }, [open]);

  const hasUserAccount = (member: TeamMemberCandidate) => {
    if (member.hasUserAccount) return true;
    if (!member.email) return false;
    return existingEmails.current.has(member.email.toLowerCase());
  };

  const displayText = selectedMember
    ? memberLabel(selectedMember)
    : "Search team member by name, number, or email…";

  const handleSelect = (member: TeamMemberCandidate) => {
    if (hasUserAccount(member)) return;
    setSelectedMember(member);
    onSelect(member);
    setOpen(false);
    setSearch("");
  };

  const handleClear = () => {
    setSelectedMember(null);
    onClear();
    setOpen(false);
    setSearch("");
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => !disabled && setOpen((o) => !o)}
          className={`flex-1 text-left ${className} flex items-center justify-between gap-2 disabled:opacity-50`}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className={`min-w-0 truncate ${!selectedMember ? "text-security-navy-500 dark:text-security-navy-400" : ""}`}>
            {displayText}
          </span>
          <svg
            className={`h-4 w-4 shrink-0 text-security-navy-400 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {selectedMember && (
          <button
            type="button"
            disabled={disabled}
            onClick={handleClear}
            className="btn-secondary shrink-0 text-sm px-3"
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full min-w-[320px] overflow-hidden rounded-lg border border-security-navy-100 bg-white shadow-lg dark:border-security-navy-700 dark:bg-security-navy-900"
          role="listbox"
        >
          <div className="border-b border-security-navy-100 p-2 dark:border-security-navy-700">
            <input
              ref={searchRef}
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Type at least 2 characters…"
              className="input-modern w-full"
              aria-label="Search team members"
            />
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {search.trim().length < 2 ? (
              <p className="px-3 py-2 text-sm text-security-navy-500 dark:text-security-navy-400">
                Type a name, employee number, or email to search.
              </p>
            ) : loading ? (
              <p className="px-3 py-2 text-sm text-security-navy-500 dark:text-security-navy-400">Searching…</p>
            ) : results.length === 0 ? (
              <p className="px-3 py-2 text-sm text-security-navy-500 dark:text-security-navy-400">
                No team members match your search.
              </p>
            ) : (
              results.map((member) => {
                const unavailable = hasUserAccount(member);
                return (
                  <button
                    key={member.id}
                    type="button"
                    role="option"
                    aria-selected={selectedId === member.id}
                    aria-disabled={unavailable}
                    disabled={unavailable}
                    onClick={() => handleSelect(member)}
                    className={`w-full rounded px-3 py-2 text-left text-sm ${
                      unavailable
                        ? "cursor-not-allowed opacity-60"
                        : "hover:bg-security-navy-50 dark:hover:bg-security-navy-900"
                    } ${selectedId === member.id ? "bg-security-navy-50 font-medium dark:bg-security-navy-900" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-security-navy-900 dark:text-security-navy-100">
                          {memberName(member)}
                        </div>
                        <div className="truncate text-xs text-security-navy-500 dark:text-security-navy-400">
                          {member.employeeNumber}
                          {member.email ? ` · ${member.email}` : " · No email on file"}
                        </div>
                        {member.jobRole && (
                          <div className="truncate text-xs text-security-navy-500 dark:text-security-navy-400">
                            {member.jobRole}
                          </div>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <span className="rounded bg-security-navy-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-300">
                          {member.status}
                        </span>
                        {unavailable && (
                          <span className="text-[10px] font-medium text-security-amber-700 dark:text-security-amber-400">
                            Already has account
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
