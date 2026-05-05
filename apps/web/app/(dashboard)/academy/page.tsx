"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AcademyActivityRow, type AcademyActivityItem } from "@/components/academy-activity";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { academyApi } from "@/lib/api";
import { clsx } from "clsx";

type QuickIconKey = "students" | "courses" | "courseRuns" | "enrolments" | "finance" | "branches";

const QUICK_LINKS: {
  href: string;
  label: string;
  description: string;
  icon: QuickIconKey;
  tint: string;
}[] = [
  {
    href: "/academy/students",
    label: "Students",
    description: "Learner profiles, documents, and admin fees",
    icon: "students",
    tint: "bg-security-amber-100 border-security-amber-300",
  },
  {
    href: "/academy/courses",
    label: "Courses",
    description: "Course catalogue and curriculum",
    icon: "courses",
    tint: "bg-security-navy-100 border-security-navy-300",
  },
  {
    href: "/academy/course-runs",
    label: "Course runs",
    description: "Open intakes and scheduled cohorts",
    icon: "courseRuns",
    tint: "bg-security-navy-50 border-security-navy-200",
  },
  {
    href: "/academy/enrolments",
    label: "Enrolments",
    description: "Link students to scheduled course runs",
    icon: "enrolments",
    tint: "bg-security-emerald-50 border-security-emerald-200",
  },
  {
    href: "/academy/finance",
    label: "Finance",
    description: "Billing, invoices, payments, and verification",
    icon: "finance",
    tint: "bg-security-emerald-100 border-security-emerald-300",
  },
  {
    href: "/academy/branches",
    label: "Branches",
    description: "Training venues and academy locations",
    icon: "branches",
    tint: "bg-white border-[var(--hairline-strong)]",
  },
];

const SHORTCUTS: { href: string; label: string }[] = [
  { href: "/academy/intake", label: "Start new intake" },
  { href: "/academy/students", label: "Add student" },
  { href: "/academy/course-runs", label: "Create course run" },
  { href: "/academy/finance", label: "Record payment" },
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

type DeltaTone = "up" | "down" | "none";
type Delta = { text: string; tone: DeltaTone } | null;

function formatDelta(pct: number | null): { text: string; tone: DeltaTone } {
  if (pct == null || Number.isNaN(pct)) return { text: "—", tone: "none" };
  if (Math.abs(pct) < 0.05) return { text: "0%", tone: "none" };
  const s = (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
  return { text: s, tone: pct > 0 ? "up" : "down" };
}

function formatMoney(fmt: Intl.NumberFormat, raw: string): string {
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return fmt.format(n);
}

function ChevronRight() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-black/40 transition-transform group-hover:translate-x-0.5 group-hover:text-black/70"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function MortarboardBadge() {
  return (
    <span
      aria-hidden
      className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-security-lg bg-gradient-to-br from-security-navy-500 to-security-navy-600 text-white shadow-security-card"
    >
      <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l9-5-9-5-9 5 9 5z" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M12 14l6.16-3.422a12 12 0 01.665 5.516A11.95 11.95 0 0112 18.057a11.95 11.95 0 01-6.824-1.962 12 12 0 01.665-5.515L12 14z"
        />
      </svg>
    </span>
  );
}

function QuickIcon({ kind }: { kind: QuickIconKey }) {
  const c = "h-5 w-5";
  switch (kind) {
    case "students":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 14a4 4 0 10-8 0M12 7a3 3 0 110 6 3 3 0 010-6zm-9 14a9 9 0 0118 0H3z" />
        </svg>
      );
    case "courses":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13M12 6.253C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5s3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18s-3.332.477-4.5 1.253" />
        </svg>
      );
    case "courseRuns":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3M5 11h14M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "enrolments":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "finance":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "branches":
      return (
        <svg className={c} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16M9 7h1m4 0h1M9 11h1m4 0h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5M3 21h18" />
        </svg>
      );
  }
}

function DeltaChip({ delta, inverseGood }: { delta: Delta; inverseGood?: boolean }) {
  if (!delta || delta.tone === "none") return null;
  const positive = inverseGood ? delta.tone === "down" : delta.tone === "up";
  return (
    <span
      className={clsx(
        "ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold border tabular-nums",
        positive
          ? "bg-security-emerald-50 text-black border-security-emerald-200"
          : "bg-red-50 text-black border-red-200"
      )}
    >
      <svg className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24" aria-hidden>
        {positive ? (
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        ) : (
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        )}
      </svg>
      {delta.text}
    </span>
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
  delta: Delta;
  sub?: string;
  inverseGood?: boolean;
}) {
  return (
    <li className="kpi-tile">
      <div className="flex items-start justify-between gap-2">
        <p className="kpi-label">{label}</p>
        <DeltaChip delta={delta} inverseGood={inverseGood} />
      </div>
      <p className="kpi-value mt-1">{value}</p>
      {sub && <p className="mt-0.5 caption">{sub}</p>}
    </li>
  );
}

function KpiSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="kpi-tile animate-pulse" aria-hidden>
          <div className="h-2.5 w-24 rounded-full bg-[var(--bg-nav-hover)]" />
          <div className="mt-2 h-6 w-20 rounded-md bg-[var(--bg-nav-hover)]" />
        </li>
      ))}
    </>
  );
}

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
    Promise.all([
      academyApi.getHubSummary(token),
      academyApi.getActivity(token, { limit: 4 }),
      academyApi.getProfile(token),
    ])
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
        <div className="notice-error" role="alert">
          {error}
        </div>
      )}

      {/* Header */}
      <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <MortarboardBadge />
          <div>
            <p className="label-text">Module</p>
            <h1 className="page-title leading-tight">Academy</h1>
            <p className="mt-1 max-w-xl text-sm text-black">
              Manage students, courses, intakes, and enrolments. Module access is granted via the{" "}
              <code className="code-chip">/academy</code> permission.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/academy/intake" className="btn-primary text-sm">
            Start new intake
            <span aria-hidden>→</span>
          </Link>
          <Link href="/academy/activity" className="btn-secondary text-sm">
            View activity
          </Link>
        </div>
      </header>

      {/* Profile readiness banner */}
      {profileReadiness && !profileReadiness.compliant && (
        <div className="notice-warn">
          <div>
            <p className="font-semibold">Academy profile setup incomplete</p>
            <p className="mt-1 text-sm">Some workflows are blocked until profile compliance is complete.</p>
            {profileReadiness.blockers && profileReadiness.blockers.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {profileReadiness.blockers.slice(0, 3).map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
            <Link href="/academy/profile" className="link-inline mt-2 inline-flex">
              Complete profile setup
            </Link>
          </div>
        </div>
      )}

      {/* KPIs */}
      <section aria-label="Academy key metrics">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {summary ? (
            <>
              <Kpi
                label="Total students"
                value={summary.totalStudents.toLocaleString()}
                delta={stockDelta}
              />
              <Kpi
                label="Active course runs"
                value={String(summary.activeCourseRunCount)}
                delta={rDelta}
              />
              <Kpi
                label="New enrolments (month)"
                value={summary.enrolmentsInCurrentMonth.toLocaleString()}
                delta={eDelta}
              />
              <Kpi
                label="Outstanding (invoices)"
                value={formatMoney(moneyFmt, summary.outstanding)}
                delta={null}
                sub={summary.overdueInvoiceCount > 0 ? `${summary.overdueInvoiceCount} overdue` : undefined}
                inverseGood
              />
            </>
          ) : (
            <KpiSkeleton />
          )}
        </ul>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_19rem] lg:items-start">
        <div className="min-w-0 space-y-6">
          {/* Hero intake card */}
          <div className="card-feature-orange overflow-hidden">
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_minmax(9rem,11rem)] sm:items-center sm:p-6">
              <div>
                <p className="label-text">Front desk workflow</p>
                <h2 className="mt-1 text-lg font-semibold text-black sm:text-xl">New student intake</h2>
                <p className="mt-2 max-w-md text-sm text-black">
                  Step through learner details, admin fee, and enrolment in open course runs in one
                  guided flow.
                </p>
                <Link href="/academy/intake" className="btn-primary mt-4 text-sm">
                  Start new intake
                  <span aria-hidden>→</span>
                </Link>
              </div>
              <div className="relative flex justify-end">
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

          {/* Quick access */}
          <section aria-labelledby="academy-quick-access">
            <div className="flex items-baseline justify-between">
              <h3 id="academy-quick-access" className="section-title">
                Quick access
              </h3>
            </div>
            <ul className="mt-3 grid gap-3 sm:grid-cols-2">
              {QUICK_LINKS.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="card-dashboard group flex items-start gap-3 p-4 transition-transform focus-ring hover:-translate-y-0.5"
                  >
                    <span
                      className={clsx(
                        "inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-security border text-black",
                        item.tint
                      )}
                      aria-hidden
                    >
                      <QuickIcon kind={item.icon} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-black">{item.label}</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-black/80">{item.description}</span>
                    </span>
                    <ChevronRight />
                  </Link>
                </li>
              ))}
            </ul>
          </section>

          {/* Shortcuts */}
          <section aria-labelledby="academy-shortcuts">
            <h3 id="academy-shortcuts" className="section-title">
              Shortcuts
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {SHORTCUTS.map((s) => (
                <Link key={s.href + s.label} href={s.href} className="btn-secondary text-xs">
                  <span aria-hidden>+</span>
                  {s.label}
                </Link>
              ))}
            </div>
          </section>
        </div>

        {/* Right column: recent activity */}
        <aside className="space-y-6 lg:sticky lg:top-2">
          <section aria-labelledby="academy-recent-activity">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id="academy-recent-activity" className="section-title">
                Recent activity
              </h3>
              <Link href="/academy/activity" className="link-inline shrink-0 text-xs font-semibold">
                View all
              </Link>
            </div>
            {!summary ? (
              <ul className="mt-3 space-y-1.5" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <li key={i} className="h-12 animate-pulse rounded-security bg-[var(--bg-nav-hover)]" />
                ))}
              </ul>
            ) : activityPreview.length === 0 ? (
              <div className="mt-3 rounded-security-lg border border-dashed border-[var(--hairline-strong)] bg-white p-4 text-center text-sm text-black">
                No activity yet.
              </div>
            ) : (
              <ul className="mt-3 space-y-1.5">
                {activityPreview.map((a) => (
                  <li key={a.id}>
                    <AcademyActivityRow item={a} compact />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
