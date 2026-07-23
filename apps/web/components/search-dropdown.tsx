"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { canAccessRoute } from "@/lib/permissions";
import { search, type SearchResults } from "@/lib/api";

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

interface SearchDropdownProps {
  onClose?: () => void;
}

export function SearchDropdown({ onClose }: SearchDropdownProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { token, user } = useAuth();
  const showEmployees = user ? canAccessRoute("/employees", user) : false;
  const showSites = user ? canAccessRoute("/sites", user) : false;
  const router = useRouter();
  const debouncedQuery = useDebounce(query, 300);

  const fetchResults = useCallback(async () => {
    if (!token || debouncedQuery.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    try {
      const data = await search(token, debouncedQuery);
      setResults(data);
      setFocusedIndex(-1);
    } catch {
      setResults({ employees: [], sites: [] });
    } finally {
      setLoading(false);
    }
  }, [token, debouncedQuery]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  useEffect(() => {
    setOpen(debouncedQuery.length >= 2);
  }, [debouncedQuery]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const employeesRaw = results?.employees ?? [];
  const employees = showEmployees ? employeesRaw : [];
  const sitesRaw = results?.sites ?? [];
  const sites = showSites ? sitesRaw : [];
  const totalItems = employees.length + sites.length;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || totalItems === 0) {
      if (e.key === "Escape") {
        setOpen(false);
        onClose?.();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((i) => (i < totalItems - 1 ? i + 1 : i));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((i) => (i > 0 ? i - 1 : -1));
    } else if (e.key === "Enter" && focusedIndex >= 0) {
      e.preventDefault();
      const idx = focusedIndex;
      if (idx < employees.length) {
        router.push(debouncedQuery ? `/employees?q=${encodeURIComponent(debouncedQuery)}` : "/employees");
        setOpen(false);
        setQuery("");
        onClose?.();
      } else {
        const site = sites[idx - employees.length];
        router.push(`/sites/${site.id}`);
        setOpen(false);
        setQuery("");
        onClose?.();
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setFocusedIndex(-1);
      onClose?.();
    }
  };

  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const el = listRef.current.children[focusedIndex] as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  const handleSelectEmployee = () => {
    router.push(debouncedQuery ? `/employees?q=${encodeURIComponent(debouncedQuery)}` : "/employees");
    setOpen(false);
    setQuery("");
    onClose?.();
  };

  const handleSelectSite = (id: string) => {
    router.push(`/sites/${id}`);
    setOpen(false);
    setQuery("");
    onClose?.();
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="search"
        placeholder={showSites ? "Search team, sites..." : "Search team..."}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => debouncedQuery.length >= 2 && setOpen(true)}
        onKeyDown={handleKeyDown}
        className="w-[min(18rem,calc(100vw-10rem))] min-w-0 max-w-[calc(100vw-2rem)] pl-10 pr-3 py-2 sm:w-72 sm:max-w-none rounded-security border-2 border-security-navy-300 bg-white text-sm text-security-navy placeholder-security-navy-400 focus:border-security-navy-500 outline-none transition-all"
        aria-label="Search"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-security-navy-500"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        viewBox="0 0 24 24"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>

      {open && (
        <div
          ref={listRef}
          className="absolute top-full left-0 right-0 mt-1 py-1 bg-white border-2 border-neutral-200 rounded-security-lg shadow-security-elevated z-50 max-h-80 overflow-y-auto"
          role="listbox"
        >
          {loading ? (
            <div className="px-4 py-3 text-sm text-security-navy-600">Searching...</div>
          ) : totalItems === 0 ? (
            <div className="px-4 py-3 text-sm text-security-navy-500">No results found</div>
          ) : (
            <>
              {employees.length > 0 && (
                <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-security-navy-500 bg-security-navy-50 border-b border-neutral-200">
                  Team
                </div>
              )}
              {employees.map((emp, i) => (
                <button
                  key={emp.id}
                  type="button"
                  role="option"
                  aria-selected={focusedIndex === i}
                  className={`
                    w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 transition-colors
                    ${focusedIndex === i ? "bg-security-navy-50" : "hover:bg-security-navy-50"}
                  `}
                  onClick={handleSelectEmployee}
                >
                  <span className="font-medium text-security-navy">
                    {emp.firstName} {emp.lastName}
                  </span>
                  <span className="text-security-navy-500 text-xs">{emp.employeeNumber}</span>
                </button>
              ))}
              {sites.length > 0 && (
                <div className="px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-security-navy-500 bg-security-navy-50 border-t border-neutral-200 mt-1 pt-1">
                  Sites
                </div>
              )}
              {sites.map((site, i) => (
                <button
                  key={site.id}
                  type="button"
                  role="option"
                  aria-selected={focusedIndex === employees.length + i}
                  className={`
                    w-full text-left px-4 py-2.5 text-sm flex flex-col gap-0.5 transition-colors
                    ${focusedIndex === employees.length + i ? "bg-security-navy-50" : "hover:bg-security-navy-50"}
                  `}
                  onClick={() => handleSelectSite(site.id)}
                >
                  <span className="font-medium text-security-navy">{site.name}</span>
                  {site.location && (
                    <span className="text-security-navy-500 text-xs truncate">{site.location}</span>
                  )}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
