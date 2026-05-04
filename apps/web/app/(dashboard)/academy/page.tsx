"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AcademyActivityRow, type AcademyActivityItem } from "@/components/academy-activity";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { academyApi } from "@/lib/api";
import { clsx } from "clsx";

const quickLinks: {
  href: string;
  label: string;
  description: string;
  iconWrap: string;
}[] = [
  {
    href: "/academy/finance",
    label: "Finance",
    description: "Billed vs collected, outstanding, pending verification",
    iconWrap: "bg-security-emerald-100 text-black border border-security-emerald-300",
  },
  {
    href: "/academy/invoices",
    label: "Invoices",
    description: "Draft, issue, and track course fees",
    iconWrap: "bg-security-navy-50 text-black border border-security-navy-200",
  },
  {
    href: "/academy/branches",
    label: "Branches",
    description: "Training venues and academy locations",
    iconWrap: "bg-security-navy-100 text-black border border-security-navy-300",
  },
  {
    href: "/academy/students",
    label: "Students",
    description: "Learner profiles and documents",
    iconWrap: "bg-security-amber-100 text-black border border-security-amber-300",
  },
  {
    href: "/academy/courses",
    label: "Courses",
    description: "Course catalogue and management",
    iconWrap: "bg-security-navy-200 text-black border border-security-navy-400",
  },
  {
    href: "/academy/enrolments",
    label: "Enrolments",
    description: "Link students to course runs",
    iconWrap: "bg-white text-black border border-[var(--hairline-strong)]",
  },
];

const shortcuts: { href: string; label: string }[] = [
  { href: "/academy/students", label: "Add student" },
  { href: "/academy/course-runs", label: "Create course run" },
  { href: "/academy/finance", label: "Record payment" },
  { href: "/academy/invoices", label: "Issue invoice" },
];

interface HubDeltas {
  /** % of stock added this month (new / stock at month start). */
  totalStudents: number | null;
  newEnrolments: number | null;
  /** MoM % change in new course runs created. */
  activeCourseRuns: number | null;
  /** MoM % new students vs last month. */
  newStudents: number | null;
  outstanding: null;
}

function formatDelta(pct: number | null): { text: string; tone: "up" | "down" | "none" } {
  if (pct == null || Number.isNaN(pct)) return { text: "—", tone: "none" };
  const s = (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
  if (Math.abs(pct) < 0.05) return { text: "0%", tone: "none" };
  return { text: s, tone: pct > 0 ? "up" : "down" };
}

function formatMoney(fmt: Intl.NumberFormat, raw: string): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return fmt.format(n);
}

function ChevronRight() {
  return (
    <svg className="h-4 w-4 shrink-0 text-black/40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function MortarboardIcon() {
  return (
    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-security-lg bg-security-navy-100 text-2xl" aria-hidden>
      <span>🎓</span>
    </div>
  );
}

function QuickIcon({ kind }: { kind: "coin" | "file" | "map" | "user" | "book" | "link" }) {
  const c = "h-5 w-5";
  switch (kind) {
    case "coin":
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
      );
    case "file":
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "map":
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
          />
        </svg>
      );
    case "user":
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
          />
        </svg>
      );
    case "book":
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253" />
        </svg>
      );
    default:
      return (
        <svg className={c} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.8}
            d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
          />
        </svg>
      );
  }
}

const quickIcons = ["coin", "file", "map", "user", "book", "link"] as const;

export default function AcademyHubPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const currency = settings?.settings?.currency ?? "ZAR";
  const moneyFmt = new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 });

  const [summary, setSummary] = useState<{
    totalStudents: number;
    activeCourseRunCount: number;
    enrolmentsInCurrentMonth: number;
    outstanding: string;
    overdueInvoiceCount: number;
    deltas: HubDeltas;
  } | null>(null);
  const [activityPreview, setActivityPreview] = useState<AcademyActivityItem[]>([]);
  const [profileReadiness, setProfileReadiness] = useState<{ compliant: boolean; blockers: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    setError(null);
    Promise.all([academyApi.getHubSummary(token), academyApi.getActivity(token, { limit: 3 }), academyApi.getProfile(token)])
      .then(([hub, act, profile]) => {
        setSummary({
          totalStudents: hub.totalStudents,
          activeCourseRunCount: hub.activeCourseRunCount,
          enrolmentsInCurrentMonth: hub.enrolmentsInCurrentMonth,
          outstanding: hub.outstanding,
          overdueInvoiceCount: hub.overdueInvoiceCount,
          deltas: hub.deltas as HubDeltas,
        });
        setActivityPreview(
          act.items.map((a) => ({
            id: a.id,
            at: a.at,
            label: a.label,
            userName: a.userName,
            link: a.link,
          }))
        );
        setProfileReadiness(profile.readiness ?? null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [token]);

  const stockDelta = formatDelta(summary?.deltas.totalStudents ?? null);
  const eDelta = formatDelta(summary?.deltas.newEnrolments ?? null);
  const rDelta = formatDelta(summary?.deltas.activeCourseRuns ?? null);

  return (
    <div className="module-shell">
      {error && (
        <div className="notice-error mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <MortarboardIcon />
          <div>
            <h1 className="page-title">Academy</h1>
            <p className="mt-1 text-sm text-black">
              Manage students, courses, intakes, and enrolments in one place. Grant the <code className="code-chip">/academy</code> module to
              give users access.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_17.5rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          <div className="card-feature-orange overflow-hidden">
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_minmax(9rem,11rem)] sm:items-center">
              <div>
                <h2 className="text-lg sm:text-xl font-semibold text-black">New student intake</h2>
                <p className="mt-2 text-sm text-black">
                  Walk through details, admin fee, and enrolment in open course runs — best for front desk.
                </p>
                <Link
                  href="/academy/intake"
                  className="btn-primary mt-4"
                >
                  Start new intake
                  <span className="text-base leading-none" aria-hidden>
                    →
                  </span>
                </Link>
              </div>
              <div className="relative flex justify-end sm:justify-end">
                <div className="relative h-28 w-36 sm:h-32 sm:w-44">
                  <Image
                    src="/academy-hero-illustration.png"
                    alt=""
                    fill
                    className="object-contain"
                    priority
                    sizes="(max-width: 640px) 160px, 176px"
                  />
                </div>
              </div>
            </div>
          </div>

          <div>
            {profileReadiness && !profileReadiness.compliant && (
              <div className="notice-warn mb-4">
                <div>
                  <p className="font-semibold">Academy profile setup incomplete</p>
                  <p className="mt-1">Some workflows are blocked until profile compliance is complete.</p>
                  <Link href="/academy/profile" className="link-inline mt-2 inline-flex">
                    Complete profile setup
                  </Link>
                </div>
              </div>
            )}
            <h3 className="section-title">Quick access</h3>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {quickLinks.map((item, i) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="group flex items-start gap-3 rounded-security-lg border border-[var(--hairline)] bg-white p-4 shadow-security-card transition hover:-translate-y-0.5 hover:border-security-navy-400 hover:shadow-security-card-hover focus-ring"
                  >
                    <span
                      className={clsx(
                        "inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-security",
                        item.iconWrap
                      )}
                      aria-hidden
                    >
                      <span className="text-current">
                        <QuickIcon kind={quickIcons[i] ?? "link"} />
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-black">{item.label}</span>
                      <span className="mt-0.5 block text-sm text-black">{item.description}</span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3 className="section-title">Shortcuts</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {shortcuts.map((s) => (
                <Link
                  key={s.href + s.label}
                  href={s.href}
                  className="btn-secondary"
                >
                  <span aria-hidden>+</span>
                  {s.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="shrink-0 space-y-6 min-w-0 w-full max-w-sm lg:max-w-none lg:w-auto mx-auto lg:mx-0">
          <div>
            <h3 className="section-title">At a glance</h3>
            <ul className="mt-3 space-y-3">
              {summary ? (
                <>
                  <Kpi
                    label="Total students"
                    value={String(summary.totalStudents.toLocaleString())}
                    delta={stockDelta}
                  />
                  <Kpi label="Active course runs" value={String(summary.activeCourseRunCount)} delta={rDelta} />
                  <Kpi
                    label="New enrolments (month)"
                    value={String(summary.enrolmentsInCurrentMonth.toLocaleString())}
                    delta={eDelta}
                  />
                  <Kpi
                    label="Outstanding (invoices)"
                    value={formatMoney(moneyFmt, summary.outstanding)}
                    delta={null}
                    sub={summary.overdueInvoiceCount > 0 ? `${summary.overdueInvoiceCount} overdue` : undefined}
                  />
                </>
              ) : (
                <KpiRowSkeleton />
              )}
            </ul>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="section-title">Recent activity</h3>
              <Link
                href="/academy/activity"
                className="link-inline shrink-0 min-h-9 text-xs font-semibold"
              >
                View all
              </Link>
            </div>
            {activityPreview.length === 0 && summary ? (
              <p className="mt-3 text-sm text-black">No activity yet.</p>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {activityPreview.length === 0
                  ? [0, 1, 2].map((i) => (
                      <li key={i} className="h-12 animate-pulse rounded-security bg-[var(--bg-nav-hover)]" />
                    ))
                  : activityPreview.map((a) => (
                      <li key={a.id}>
                        <AcademyActivityRow item={a} compact />
                      </li>
                    ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiRowSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="h-16 rounded-security border border-[var(--hairline)] bg-white animate-pulse" />
      ))}
    </>
  );
}

function Kpi({
  label,
  value,
  delta,
  sub,
  inverseGood,
}: {
  label: string;
  value: string;
  delta: { text: string; tone: "up" | "down" | "none" } | null;
  sub?: string;
  /** When true, negative trend is "good" (e.g. less outstanding). */
  inverseGood?: boolean;
}) {
  const chip =
    delta && delta.tone !== "none" ? (
      <span
        className={clsx(
          "ml-auto rounded-full px-1.5 py-0.5 text-xs font-semibold border",
          !inverseGood
            ? delta.tone === "up"
              ? "bg-security-emerald-50 text-black border-security-emerald-200"
              : "bg-red-50 text-black border-red-200"
            : delta.tone === "down"
              ? "bg-security-emerald-50 text-black border-security-emerald-200"
              : "bg-security-amber-100 text-black border-security-amber-200"
        )}
      >
        {delta.text}
      </span>
    ) : delta ? (
      <span className="ml-auto text-xs text-black">{delta.text}</span>
    ) : null;
  return (
    <li className="kpi-tile">
      <div className="flex items-start justify-between gap-2">
        <p className="kpi-label">{label}</p>
        {chip}
      </div>
      <p className="kpi-value mt-1">{value}</p>
      {sub && <p className="mt-0.5 caption">{sub}</p>}
    </li>
  );
}
