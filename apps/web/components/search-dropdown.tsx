"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import {
  MODULE_DESCRIPTIONS,
  MODULE_CATEGORIES,
  getModuleCategory,
} from "@/lib/module-presentation";
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
  type: "module" | "employee" | "site" | "client" | "incident" | "invoice";
  category: string;
  title: string;
  subtitle?: string;
  badge?: string;
  badgeVariant?: "neutral" | "warning" | "success" | "error";
  href: string;
}

const EXTRA_SEARCHABLE_PAGES: { href: string; label: string; description: string }[] = [
  { href: "/overview", label: "Overview & Analytics", description: "Live KPIs, charts, and operational alerts" },
  { href: "/attendance/exceptions", label: "Attendance Exceptions", description: "Resolve unconfirmed shifts and export blockers" },
  { href: "/attendance/staff", label: "Staff Attendance", description: "Office and administrative staff roll-call" },
  { href: "/employees/compliance", label: "Workforce Compliance", description: "PSIRA grades, expiring documents, and missing records" },
  { href: "/billing/invoices", label: "Client Invoices", description: "Billing invoices and payment status" },
  { href: "/billing/quotes", label: "Client Quotes", description: "Service quotes for active and prospective clients" },
];

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
  const showIncidents = user ? canAccessRoute("/incidents", user) : false;
  const showInvoices = user ? canAccessRoute("/billing", user) : false;

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
        setOpen(true);
      } else if (e.key === "/" && !isInputActive) {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [query]);

  const accessibleModules = useMemo(() => {
    if (!user) return [];
    const seen = new Set<string>();
    const list: { href: string; label: string; description: string; categoryLabel: string }[] = [];

    const addEntry = (href: string, label: string, description?: string) => {
      if (seen.has(href) || !canAccessRoute(href, user)) return;
      seen.add(href);
      const catKey = getModuleCategory(href);
      list.push({
        href,
        label,
        description: description ?? MODULE_DESCRIPTIONS[href] ?? "System module",
        categoryLabel: MODULE_CATEGORIES[catKey]?.label ?? "Module",
      });
    };

    addEntry("/", "Command Center (Home)", "Daily operations launcher and work queue");
    for (const item of EXTRA_SEARCHABLE_PAGES) {
      addEntry(item.href, item.label, item.description);
    }
    for (const item of NAV_ITEMS) {
      if (item.href !== "/") {
        addEntry(item.href, item.label, MODULE_DESCRIPTIONS[item.href]);
      }
    }
    return list;
  }, [user]);

  const matchingModules = useMemo<FlatSearchResult[]>(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      // Show top quick-jump modules when opened with an empty query
      return accessibleModules.slice(0, 6).map((m) => ({
        key: `mod-${m.href}`,
        type: "module",
        category: "Modules & Pages",
        title: m.label,
        subtitle: m.description,
        badge: m.categoryLabel,
        badgeVariant: "neutral",
        href: m.href,
      }));
    }
    return accessibleModules
      .filter(
        (m) =>
          m.label.toLowerCase().includes(trimmed) ||
          m.description.toLowerCase().includes(trimmed) ||
          m.categoryLabel.toLowerCase().includes(trimmed) ||
          m.href.toLowerCase().includes(trimmed)
      )
      .slice(0, 6)
      .map((m) => ({
        key: `mod-${m.href}`,
        type: "module",
        category: "Modules & Pages",
        title: m.label,
        subtitle: m.description,
        badge: m.categoryLabel,
        badgeVariant: "neutral",
        href: m.href,
      }));
  }, [accessibleModules, query]);

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
    if (query.trim().length >= 1) {
      setOpen(true);
      setFocusedIndex(0);
    }
  }, [query]);

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
    const items: FlatSearchResult[] = [...matchingModules];
    if (!results) return items;

    if (showEmployees && results.employees?.length) {
      for (const emp of results.employees) {
        const subParts = [
          emp.employeeNumber ? `No: ${emp.employeeNumber}` : null,
          emp.externalPayrollCode ? `Sage: ${emp.externalPayrollCode}` : null,
        ].filter(Boolean);
        items.push({
          key: `emp-${emp.id}`,
          type: "employee",
          category: "Team",
          title: `${emp.firstName} ${emp.lastName}`,
          subtitle: subParts.length > 0 ? subParts.join(" · ") : undefined,
          href: debouncedQuery ? `/employees?q=${encodeURIComponent(debouncedQuery)}` : "/employees",
        });
      }
    }

    if (showSites && results.sites?.length) {
      for (const site of results.sites) {
        const subParts = [site.location, site.costCenterCode ? `Cost Ctr: ${site.costCenterCode}` : null].filter(Boolean);
        items.push({
          key: `site-${site.id}`,
          type: "site",
          category: "Sites",
          title: site.name,
          subtitle: subParts.length > 0 ? subParts.join(" · ") : undefined,
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
          href: `/billing/invoices/${inv.id}`,
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
  }, [matchingModules, results, showEmployees, showSites, showClients, showInvoices, showIncidents, debouncedQuery]);

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
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search modules, team, sites, clients..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          className="peer h-8 w-[min(16rem,calc(100vw-9rem))] min-w-0 max-w-[calc(100vw-2rem)] rounded-security border border-security-navy-200/80 bg-security-navy-50/50 py-1.5 pl-8 pr-8 text-xs text-security-navy-900 outline-none transition-[background-color,border-color,width] duration-150 placeholder:text-security-navy-400 hover:border-security-navy-300 focus:border-security-amber-500 focus:bg-white sm:w-60 sm:max-w-none lg:focus:w-72 [&::-webkit-search-cancel-button]:appearance-none"
          aria-label="Global search across modules"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-security-navy-400 peer-focus:text-security-navy-600"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>

        <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 hidden items-center rounded border border-white/15 bg-white/[0.08] px-1 py-0.5 font-mono text-[9px] text-white/60 transition-colors peer-focus:border-security-navy-200 peer-focus:bg-security-navy-100 peer-focus:text-security-navy-600 sm:inline-flex">
          ⌘K
        </kbd>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 min-w-[20rem] animate-slide-up overflow-y-auto rounded-security-lg border border-security-navy-100 bg-white py-1 shadow-security-elevated motion-reduce:animate-none"
          role="listbox"
        >
          {totalItems === 0 && !loading ? (
            <div className="px-4 py-4 text-center text-sm text-security-navy-500">
              No matching modules or records found for &ldquo;{query.trim()}&rdquo;
            </div>
          ) : (
            <>
              {groupedItems.map((group) => (
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
              ))}
              {loading && (
                <div className="flex items-center gap-2 border-t border-security-navy-50 px-4 py-2.5 text-xs text-security-navy-500">
                  <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-security-amber-500 border-t-transparent" />
                  Searching records...
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
