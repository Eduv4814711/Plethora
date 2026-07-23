"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { useConfirmDialog } from "@/components/ui";

interface Branch {
  id: string;
  name: string;
  city?: string | null;
  province?: string | null;
  createdAt: string;
}

const BRANCH_ADD_FORM_ID = "academy-branch-add-form";
type SortKey = "name" | "createdAt";
type StatusFilter = "all" | "active";

function formatDateAdded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

function cityProvince(b: Branch): string {
  const c = b.city?.trim() || "";
  const p = b.province?.trim() || "";
  if (c && p) return `${c} / ${p}`;
  if (c) return c;
  if (p) return p;
  return "—";
}

function matchSearch(b: Branch, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return (
    b.name.toLowerCase().includes(s) ||
    (b.city ?? "").toLowerCase().includes(s) ||
    (b.province ?? "").toLowerCase().includes(s)
  );
}

function BuildingIcon() {
  return (
    <span
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-security-navy-50 text-security-navy-700"
      aria-hidden
    >
      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
        />
      </svg>
    </span>
  );
}

function BranchHintIllustration() {
  return (
    <svg aria-hidden="true" className="h-20 w-20" fill="none" viewBox="0 0 80 80">
      <path d="M13 66h39M19 66V30h27v36M27 39h4m7 0h4m-15 9h4m7 0h4M30 66V55h8v11" stroke="#CBD5E1" strokeLinecap="round" strokeWidth="4" />
      <path d="M67 47c0 9-10 18-10 18S47 56 47 47a10 10 0 1 1 20 0Z" fill="#FFF7ED" stroke="#FB923C" strokeWidth="3" />
      <circle cx="57" cy="47" r="3" fill="#FB923C" />
    </svg>
  );
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 font-semibold uppercase tracking-wide text-left hover:text-security-navy-700"
    >
      {label}
      <span className="text-neutral-400" aria-hidden>
        {active ? (direction === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

export default function AcademyBranchesPage() {
  const { token, user } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const canCreate = Boolean(user && hasCapability(user, "/academy", "create"));
  const canDelete = Boolean(user && hasCapability(user, "/academy", "delete"));
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const addCardRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!token) return;
    setLoading(true);
    academyApi
      .listBranches(token)
      .then((d) => {
        setBranches(
          (d.branches as Branch[]).map((b) => ({
            ...b,
            createdAt: String((b as { createdAt?: unknown }).createdAt ?? ""),
          }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (openMenuId == null) return;
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if ((e.target as Element | null)?.closest?.("[data-branch-menu]")) return;
      setOpenMenuId(null);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [openMenuId]);

  const filtered = useMemo(() => {
    let list = branches.filter((b) => matchSearch(b, search));
    if (statusFilter === "active") {
      list = list; // all are Active in data model
    }
    return list;
  }, [branches, search, statusFilter]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
        return sortDir === "asc" ? cmp : -cmp;
      }
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      const cmp = (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !name.trim() || !canCreate) return;
    setError(null);
    try {
      await academyApi.createBranch(token, { name: name.trim() });
      setName("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    }
  };

  const focusAddForm = () => {
    addCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => nameInputRef.current?.focus(), 200);
  };

  const remove = async (id: string) => {
    if (!token || !canDelete) return;
    const confirmed = await confirm({
      title: "Delete branch?",
      message: "Only branches with no course runs can be deleted.",
      confirmLabel: "Delete branch",
    });
    if (!confirmed) return;
    setError(null);
    setOpenMenuId(null);
    try {
      await academyApi.deleteBranch(token, id);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  return (
    <div className="w-full min-w-0 space-y-6">
      {confirmDialog}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/academy" className="text-sm text-security-navy-700 hover:underline lg:hidden">
            ← Academy
          </Link>
          <h1 className="mt-0 text-2xl font-semibold tracking-tight text-security-navy-900 sm:mt-1">Branches</h1>
          <p className="mt-1 max-w-xl text-sm text-neutral-600">
            Manage your training venues and academy locations.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={focusAddForm}
            className="btn-primary shrink-0 gap-1 rounded-xl shadow-sm"
          >
            <span className="text-lg leading-none">+</span>
            Add branch
          </button>
        )}
      </div>

      {canCreate && <div
        ref={addCardRef}
        className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm"
      >
        <form id={BRANCH_ADD_FORM_ID} onSubmit={create}>
          <div className="grid gap-6 p-5 sm:grid-cols-[1fr_minmax(12rem,20rem)] sm:items-stretch sm:gap-8 md:p-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-security-navy-800" htmlFor="new-branch-name">
                New branch name
              </label>
              <input
                id="new-branch-name"
                ref={nameInputRef}
                className="input-modern w-full max-w-md rounded-xl border-neutral-300 bg-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Johannesburg campus"
                autoComplete="off"
              />
              <p className="mt-2 text-xs text-neutral-500 sm:hidden">Use a clear name. You can add more detail later in settings.</p>
            </div>
            <div className="hidden sm:flex sm:flex-col sm:justify-center">
              <div className="flex gap-3 rounded-xl border border-sky-200/80 bg-sky-50/90 p-4 text-sm text-security-navy-800">
                <div className="shrink-0 text-sky-600" aria-hidden>
                  <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p>
                    Add a new training venue or location. This will be available when scheduling course runs and generating
                    reports.
                  </p>
                </div>
                <div className="hidden h-20 w-20 shrink-0 sm:block">
                  <BranchHintIllustration />
                </div>
              </div>
            </div>
          </div>
          <div className="border-t border-neutral-200/80 bg-neutral-100/20 px-5 py-3 sm:px-6 sm:text-right">
            <button
              type="submit"
              form={BRANCH_ADD_FORM_ID}
              className="btn-primary px-3 py-1.5 text-xs rounded-full px-5"
              disabled={!name.trim()}
            >
              Add branch
            </button>
          </div>
        </form>
      </div>}

      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-neutral-200/80 p-4 sm:flex-row sm:items-center sm:justify-between md:p-5">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-security-navy-900">All branches</h2>
            <span className="rounded-full bg-security-navy-50 px-2.5 py-0.5 text-sm font-medium text-security-navy-700">
              {loading ? "…" : sorted.length}
            </span>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <div className="relative w-full min-w-0 sm:max-w-xs">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-400" aria-hidden>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </span>
              <input
                className="input-compact w-full rounded-xl pl-9"
                type="search"
                placeholder="Search branches…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-neutral-500" aria-hidden>
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
              </span>
              <select
                className="input-compact max-w-full rounded-lg"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
              </select>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="p-4 md:p-5">
            <div className="space-y-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded-lg bg-neutral-100" />
              ))}
            </div>
            <p className="mt-3 text-center text-sm text-neutral-500">Loading branches…</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="p-10 text-center text-sm text-neutral-500">
            {branches.length === 0 ? "No branches yet. Add your first training venue above." : "No branches match your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-neutral-200 text-sm">
              <thead>
                <tr className="text-xs text-neutral-500">
                  <th>
                    <SortHeader
                      label="Branch name"
                      active={sortKey === "name"}
                      direction={sortKey === "name" ? sortDir : "asc"}
                      onClick={() => toggleSort("name")}
                    />
                  </th>
                  <th>City / Province</th>
                  <th>Status</th>
                  <th>
                    <SortHeader
                      label="Date added"
                      active={sortKey === "createdAt"}
                      direction={sortKey === "createdAt" ? sortDir : "asc"}
                      onClick={() => toggleSort("createdAt")}
                    />
                  </th>
                  <th className="w-14" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((b) => (
                  <tr key={b.id} className="text-sm">
                    <td>
                      <div className="flex min-w-0 max-w-md items-center gap-3">
                        <BuildingIcon />
                        <span className="font-medium text-security-navy-900">{b.name}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-neutral-700">{cityProvince(b)}</td>
                    <td>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-2.5 py-0.5 text-xs font-medium text-success">
                        <span className="h-1.5 w-1.5 rounded-full bg-success" />
                        Active
                      </span>
                    </td>
                    <td className="whitespace-nowrap text-neutral-700">{formatDateAdded(b.createdAt)}</td>
                    <td className="relative w-12 text-right">
                      {canDelete && (
                      <div ref={openMenuId === b.id ? menuRef : null} className="inline-block text-left">
                        <button
                          type="button"
                          data-branch-menu
                          className="btn-ghost px-3 py-1.5 text-xs min-h-8 w-8 p-0"
                          aria-label="Row actions"
                          aria-expanded={openMenuId === b.id}
                          onClick={() => setOpenMenuId((id) => (id === b.id ? null : b.id))}
                        >
                          <svg className="h-5 w-5 text-neutral-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M12 8a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm0 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
                          </svg>
                        </button>
                        {openMenuId === b.id && (
                          <ul className="menu absolute right-0 z-20 mt-1 w-40 rounded-box border border-neutral-200 bg-white p-1 shadow-lg">
                            <li>
                              <button type="button" className="text-red-700" onClick={() => remove(b.id)}>
                                Delete
                              </button>
                            </li>
                          </ul>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
