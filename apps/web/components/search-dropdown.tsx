"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
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

interface FlatSearchResult {
  key: string;
  type: "employee" | "site" | "client" | "task" | "incident" | "invoice";
  category: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: "neutral" | "warning" | "success" | "error";
  href: string;
}

export function SearchDropdown({ onClose }: SearchDropdownProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { token, user } = useAuth();

  const showEmployees = user ? canAccessRoute("/employees", user) : false;
  const showSites = user ? canAccessRoute("/sites", user) : false;
  const showClients = user ? canAccessRoute("/clients", user) : false;
  const showTasks = user ? canAccessRoute("/tasks", user) : false;
  const showIncidents = user ? canAccessRoute("/incidents", user) : false;
  const showInvoices = user
    ? canAccessRoute("/payroll/billing", user) || canAccessRoute("/payroll", user)
    : false;

  const router = useRouter();
  const debouncedQuery = useDebounce(query, 300);

  // Global keyboard shortcut: Cmd+K / Ctrl+K or "/" to focus header search
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      const activeTag = document.activeElement?.tagName ?? "";
      const isInputActive = ["INPUT", "TEXTAREA", "SELECT"].includes(activeTag) ||
        (document.activeElement as HTMLElement)?.isContentEditable;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        if (query.trim().length >= 2) setOpen(true);
      } else if (e.key === "/" && !isInputActive) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        if (query.trim().length >= 2) setOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [query]);

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
      setResults({
        employees: [],
        sites: [],
        clients: [],
        tasks: [],
        incidents: [],
        invoices: [],
      });
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

  const flatItems = useMemo<FlatSearchResult[]>(() => {
    if (!results) return [];
    const items: FlatSearchResult[] = [];

    if (showEmployees && results.employees?.length) {
      for (const emp of results.employees) {
        items.push({
          key: `emp-${emp.id}`,
          type: "employee",
          category: "Team",
          title: `${emp.firstName} ${emp.lastName}`,
          subtitle: emp.employeeNumber ? `No: ${emp.employeeNumber}` : undefined,
          href: debouncedQuery ? `/employees?q=${encodeURIComponent(debouncedQuery)}` : "/employees",
        });
      }
    }

    if (showSites && results.sites?.length) {
      for (const site of results.sites) {
        items.push({
          key: `site-${site.id}`,
          type: "site",
          category: "Sites",
          title: site.name,
          subtitle: site.location ?? undefined,
          href: `/sites/${site.id}`,
        });
      }
    }

    if (showClients && results.clients?.length) {
      for (const client of results.clients) {
        items.push({
          key: `client-${client.id}`,
          type: "client",
          category: "Clients",
          title: client.name,
          subtitle: client.contactPerson
            ? `Contact: ${client.contactPerson}${client.phone ? ` · ${client.phone}` : ""}`
            : client.phone ?? undefined,
          href: `/clients/${client.id}`,
        });
      }
    }

    if (showInvoices && results.invoices?.length) {
      for (const inv of results.invoices) {
        const amountStr = typeof inv.totalAmount === "number"
          ? `R ${inv.totalAmount.toLocaleString()}`
          : `R ${inv.totalAmount}`;
        items.push({
          key: `inv-${inv.id}`,
          type: "invoice",
          category: "Invoices",
          title: inv.invoiceNumber,
          subtitle: inv.client?.name ? `${inv.client.name} · ${amountStr}` : amountStr,
          badge: inv.status,
          badgeVariant: inv.status === "paid" ? "success" : inv.status === "overdue" ? "error" : "neutral",
          href: `/payroll/billing/invoices/${inv.id}`,
        });
      }
    }

    if (showTasks && results.tasks?.length) {
      for (const task of results.tasks) {
        items.push({
          key: `task-${task.id}`,
          type: "task",
          category: "Tasks",
          title: task.title,
          subtitle: task.dueDate ? `Due ${task.dueDate.slice(0, 10)}` : undefined,
          badge: task.priority,
          badgeVariant: task.priority === "urgent" || task.priority === "critical" ? "error" : "neutral",
          href: `/tasks/${task.id}`,
        });
      }
    }

    if (showIncidents && results.incidents?.length) {
      for (const inc of results.incidents) {
        items.push({
          key: `inc-${inc.id}`,
          type: "incident",
          category: "Incidents",
          title: inc.title ? `${inc.incidentNumber} — ${inc.title}` : inc.incidentNumber,
          subtitle: `${inc.incidentType} · ${inc.severity}`,
          badge: inc.status,
          badgeVariant: inc.severity === "CRITICAL" ? "error" : "warning",
          href: `/incidents/${inc.id}`,
        });
      }
    }

    return items;
  }, [results, showEmployees, showSites, showClients, showInvoices, showTasks, showIncidents, debouncedQuery]);

  const totalItems = flatItems.length;

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
    } else if (e.key === "Enter" && focusedIndex >= 0 && flatItems[focusedIndex]) {
      e.preventDefault();
      const item = flatItems[focusedIndex];
      router.push(item.href);
      setOpen(false);
      setQuery("");
      onClose?.();
    } else if (e.key === "Escape") {
      setOpen(false);
      setFocusedIndex(-1);
      onClose?.();
    }
  };

  useEffect(() => {
    if (focusedIndex >= 0 && listRef.current) {
      const el = listRef.current.querySelector(`[data-index="${focusedIndex}"]`) as HTMLElement;
      el?.scrollIntoView({ block: "nearest" });
    }
  }, [focusedIndex]);

  const handleSelectItem = (item: FlatSearchResult) => {
    router.push(item.href);
    setOpen(false);
    setQuery("");
    onClose?.();
  };

  // Group flat items by category for visual sections
  const groupedItems = useMemo(() => {
    const groups: { category: string; items: { item: FlatSearchResult; globalIndex: number }[] }[] = [];
    let currentCategory = "";
    let currentGroup: { category: string; items: { item: FlatSearchResult; globalIndex: number }[] } | null = null;

    flatItems.forEach((item, index) => {
      if (item.category !== currentCategory) {
        currentCategory = item.category;
        currentGroup = { category: item.category, items: [] };
        groups.push(currentGroup);
      }
      currentGroup?.items.push({ item, globalIndex: index });
    });

    return groups;
  }, [flatItems]);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search team, sites, clients, tasks..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => debouncedQuery.length >= 2 && setOpen(true)}
          onKeyDown={handleKeyDown}
          className="peer w-[min(18rem,calc(100vw-10rem))] min-w-0 max-w-[calc(100vw-2rem)] rounded-security border border-white/15 bg-white/10 py-2 pl-10 pr-10 text-sm text-white outline-none transition-[background-color,border-color,width] duration-200 placeholder:text-white/65 hover:border-white/25 hover:bg-white/[0.14] focus:border-security-amber-500 focus:bg-white focus:text-security-navy-900 focus:placeholder:text-security-navy-400 sm:w-64 sm:max-w-none lg:focus:w-84 [&::-webkit-search-cancel-button]:appearance-none"
          aria-label="Global search across modules"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <svg
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/65 peer-focus:text-security-navy-500"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 hidden items-center rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/70 transition-colors peer-focus:border-security-navy-200 peer-focus:bg-security-navy-100 peer-focus:text-security-navy-600 sm:inline-flex">
          ⌘K
        </kbd>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 min-w-[20rem] animate-slide-up overflow-y-auto rounded-security-lg border border-security-navy-100 bg-white py-1 shadow-security-elevated motion-reduce:animate-none"
          role="listbox"
        >
          {loading ? (
            <div className="flex items-center gap-2 px-4 py-3 text-sm text-security-navy-600">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-security-amber-500 border-t-transparent" />
              Searching records...
            </div>
          ) : totalItems === 0 ? (
            <div className="px-4 py-4 text-center text-sm text-security-navy-500">
              No matching records found for &ldquo;{debouncedQuery}&rdquo;
            </div>
          ) : (
            groupedItems.map((group) => (
              <div key={group.category}>
                <div className="bg-security-navy-50 px-4 py-1.5 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.14em] text-security-navy-500">
                  {group.category}
                </div>
                {group.items.map(({ item, globalIndex }) => {
                  const isSelected = focusedIndex === globalIndex;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      role="option"
                      data-index={globalIndex}
                      aria-selected={isSelected}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                        isSelected ? "bg-security-navy-50" : "hover:bg-security-navy-50"
                      }`}
                      onClick={() => handleSelectItem(item)}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-security-navy-900">{item.title}</p>
                        {item.subtitle && (
                          <p className="truncate text-xs text-security-navy-500">{item.subtitle}</p>
                        )}
                      </div>
                      {item.badge && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            item.badgeVariant === "error"
                              ? "bg-red-50 text-red-700 border border-red-200"
                              : item.badgeVariant === "success"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : item.badgeVariant === "warning"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : "bg-security-navy-100 text-security-navy-700"
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
