"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AcademyActivityRow, type AcademyActivityItem } from "@/components/academy-activity";
import { useAuth } from "@/lib/auth-context";
import { academyApi } from "@/lib/api";
import { clsx } from "clsx";

const PAGE_LIMIT = 60;
const AUDIT_LIMIT = 100;

interface LogRow {
  id: string;
  action: string;
  entityType: string;
  timestamp: string;
  user?: { name?: string | null } | null;
}

type ViewId = "feed" | "audit";

const VIEWS: { id: ViewId; label: string; description: string }[] = [
  { id: "feed", label: "Activity feed", description: "Human-friendly stream of recent changes across the academy." },
  { id: "audit", label: "Audit log", description: "Technical events filterable by action and entity type — for compliance review." },
];

function isView(value: string | null | undefined): value is ViewId {
  return value === "feed" || value === "audit";
}

function ActivityFeed() {
  const { token } = useAuth();
  const [items, setItems] = useState<AcademyActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .getActivity(token, { limit: PAGE_LIMIT })
      .then((res) => {
        setItems(
          res.items.map((a) => ({
            id: a.id,
            at: a.at,
            label: a.label,
            userName: a.userName,
            link: a.link,
          }))
        );
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}
      <div>
        <button type="button" className="btn-secondary text-sm" onClick={load} disabled={loading}>
          <svg
            className={clsx("h-4 w-4", loading && "animate-spin")}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5m11 11v-5h-5M5.5 14a8 8 0 0014 4M18.5 10a8 8 0 00-14-4" />
          </svg>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
      {loading && items.length === 0 ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="h-16 animate-pulse rounded-security-lg bg-[var(--bg-nav-hover)]" />
          ))}
        </ul>
      ) : items.length === 0 ? (
        <div className="rounded-security-lg border border-dashed border-[var(--hairline-strong)] bg-white p-6 text-center text-sm text-black">
          No activity yet.
        </div>
      ) : (
        <ul className="max-w-3xl space-y-2">
          {items.map((a) => (
            <li key={a.id}>
              <AcademyActivityRow item={a} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AuditLog() {
  const { token } = useAuth();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    academyApi
      .listAuditLogs(token, {
        limit: AUDIT_LIMIT,
        action: action || undefined,
        entityType: entityType || undefined,
      })
      .then((r) => setRows((r.logs as LogRow[]) ?? []))
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [token]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    load();
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="card-wireframe p-4 sm:p-5">
        <p className="section-title">Filters</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <input
            className="input-compact w-full sm:max-w-xs"
            placeholder="Action (e.g. created, updated)"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          />
          <input
            className="input-compact w-full sm:max-w-xs"
            placeholder="Entity type (e.g. student, invoice)"
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
          />
          <button type="submit" className="btn-primary text-sm">
            Apply
          </button>
          {(action || entityType) && (
            <button
              type="button"
              className="btn-secondary text-sm"
              onClick={() => {
                setAction("");
                setEntityType("");
                setTimeout(load, 0);
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      <div className="table-scroll">
        <table className="table-module">
          <thead>
            <tr>
              <th>Time</th>
              <th>Action</th>
              <th>Entity</th>
              <th>User</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-black">
                  Loading audit events…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-10 text-center text-sm text-black">
                  No audit events match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs">{new Date(r.timestamp).toLocaleString()}</td>
                  <td className="text-xs font-semibold text-black">{r.action}</td>
                  <td className="text-xs">{r.entityType}</td>
                  <td className="text-xs">{r.user?.name ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function AcademyActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const viewParam = searchParams?.get("view") ?? null;
  const activeView: ViewId = isView(viewParam) ? viewParam : "feed";

  const setView = (next: ViewId) => {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (next === "feed") params.delete("view");
    else params.set("view", next);
    const qs = params.toString();
    router.replace(`/academy/activity${qs ? `?${qs}` : ""}`);
  };

  const current = VIEWS.find((v) => v.id === activeView) ?? VIEWS[0];

  return (
    <div className="module-shell">
      <header>
        <Link href="/academy" className="link-inline text-sm font-semibold lg:hidden">
          ← Academy
        </Link>
        <p className="label-text mt-1">Module · Academy</p>
        <h1 className="page-title mt-1">Activity & audit</h1>
        <p className="mt-1 max-w-xl text-sm text-black">{current.description}</p>
      </header>

      <div className="segmented self-start" role="tablist" aria-label="Activity view">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            role="tab"
            aria-selected={activeView === v.id}
            className={clsx("segmented-option", activeView === v.id && "segmented-option-active")}
            onClick={() => setView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {activeView === "feed" ? <ActivityFeed /> : <AuditLog />}
    </div>
  );
}
