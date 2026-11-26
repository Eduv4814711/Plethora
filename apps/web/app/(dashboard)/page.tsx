"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { clsx } from "clsx";
import { format, parseISO } from "date-fns";
import { useAuth } from "@/lib/auth-context";
import { useSettings } from "@/lib/settings-context";
import { NAV_ITEMS, canAccessRoute } from "@/lib/permissions";
import {
  MODULE_DESCRIPTIONS,
  MODULE_ICONS,
  MODULE_ICON_FALLBACK,
} from "@/lib/module-presentation";
import { PageShell } from "@/components/ui";
import { DashboardKpiCards } from "@/components/dashboard/DashboardKpiCards";
import { WorkforceOverviewCard } from "@/components/dashboard/WorkforceOverviewCard";
import { AttendanceTrendCard } from "@/components/dashboard/AttendanceTrendCard";
import { PlethoraAiPanel } from "@/components/dashboard/PlethoraAiPanel";
import { useDashboardOperationalSummary } from "@/lib/use-dashboard-operational-summary";

const CORE_WORKFLOW_HREFS = [
  "/rostering",
  "/attendance",
  "/payroll-exports",
  "/billing",
] as const;

function getGreeting(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function ModuleIcon({ href }: { href: string }) {
  return <>{MODULE_ICONS[href] ?? MODULE_ICON_FALLBACK}</>;
}

export default function OperationsHome() {
  const { user } = useAuth();
  const { settings } = useSettings();
  const [today, setToday] = useState<Date | null>(null);

  useEffect(() => setToday(new Date()), []);

  const operationalSummary = useDashboardOperationalSummary();
  const {
    dashboard,
    workItems,
    periodLabel,
    shiftInfo,
    moduleStatus,
    guardsOnDuty,
    activeSitesCount,
    activeSitesDelta,
    totalEmployees,
    onLeaveToday,
    totalPosts,
    activeClientsCount,
    attendanceTrend14d,
    pendingSiteTimesheetRows,
    rosterAttentionCount,
  } = operationalSummary;

  const coreWorkflows = useMemo(() => {
    if (!user) return [];
    const navMap = new Map(NAV_ITEMS.map((item) => [item.href, item]));
    const preferred = CORE_WORKFLOW_HREFS.filter((href) => canAccessRoute(href, user))
      .map((href) => navMap.get(href))
      .filter((item): item is { href: string; label: string } => Boolean(item));

    if (preferred.length > 0) return preferred;

    return NAV_ITEMS.filter((item) => item.href !== "/" && canAccessRoute(item.href, user)).slice(0, 4);
  }, [user]);

  const anyAccessibleModule = useMemo(() => {
    if (!user) return false;
    return NAV_ITEMS.some((item) => item.href !== "/" && canAccessRoute(item.href, user));
  }, [user]);

  if (!user) return null;

  const firstName = user.name?.trim().split(/\s+/)[0] ?? "";
  const companyName = settings?.name ?? "Plethora Security";
  const formattedDate = today
    ? today.toLocaleDateString(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "";

  const payPeriod = dashboard?.currentPayPeriod;
  const periodParts = periodLabel.split(" · ");
  const cycleName = payPeriod?.label ? `${payPeriod.label} Pay Period` : periodParts[0] || "Current cycle";
  const cycleDates = periodParts[1] || "26th–25th cycle";

  const cycleEndDisplay = (() => {
    if (!payPeriod?.periodEnd) return "25th cycle cut-off";
    try {
      return format(parseISO(payPeriod.periodEnd.slice(0, 10)), "EEE, d MMM yyyy");
    } catch {
      return payPeriod.periodEnd.slice(0, 10);
    }
  })();

  const upcomingItems = [
    {
      id: "auto-roster",
      title: "Auto Roster Generation",
      subtitle: "Daily coverage verification (02:00)",
      badge: "Scheduled",
      badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
      dotClass: "bg-security-amber-500",
      href: canAccessRoute("/rostering", user) ? "/rostering" : undefined,
    },
    {
      id: "cycle-close",
      title: payPeriod?.label ? `${payPeriod.label} Cycle Cut-Off` : "Pay Cycle Cut-Off",
      subtitle: cycleEndDisplay,
      badge:
        dashboard?.exportReadiness?.status === "READY"
          ? "Ready"
          : (dashboard?.exportReadiness?.openExceptions ?? 0) > 0
            ? "Needs Review"
            : "Pending",
      badgeClass:
        dashboard?.exportReadiness?.status === "READY"
          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
          : (dashboard?.exportReadiness?.openExceptions ?? 0) > 0
            ? "bg-amber-50 text-amber-800 border-amber-200"
            : "bg-security-navy-100 text-security-navy-700 border-security-navy-200",
      dotClass:
        dashboard?.exportReadiness?.status === "READY"
          ? "bg-emerald-500"
          : "bg-security-navy-400",
      href: canAccessRoute("/payroll-exports", user) ? "/payroll-exports" : undefined,
    },
  ];

  const canOverview = canAccessRoute("/", user);
  const canRostering = canAccessRoute("/rostering", user);
  const canAttendance = canAccessRoute("/attendance", user);
  const canSites = canAccessRoute("/sites", user);

  return (
    <PageShell width="wide" className="max-w-[1440px]">
      {/* Greeting Header */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="h-9 w-[3px] shrink-0 rounded-full bg-security-amber-500" aria-hidden="true" />
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-security-navy-950 sm:text-[1.7rem]">
              {getGreeting(today ? today.getHours() : 9)}
              {firstName ? `, ${firstName}` : ""}
            </h1>
            <p className="mt-0.5 text-sm text-security-navy-500">
              {companyName}
              {formattedDate ? ` · ${formattedDate}` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {canOverview && (
            <Link
              href="/overview"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-security-navy-200 bg-white px-3.5 text-xs font-semibold text-security-navy-800 no-underline shadow-security-card transition-colors hover:border-security-navy-300 hover:bg-security-navy-50"
            >
              <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden="true" />
              <span>Live Analytics</span>
            </Link>
          )}
          {canRostering && (
            <Link
              href="/rostering"
              className="inline-flex h-9 items-center gap-2 rounded-full border border-security-navy-200 bg-white px-3.5 text-xs font-semibold text-security-navy-700 no-underline shadow-security-card transition-colors hover:border-security-navy-300 hover:bg-security-navy-50"
            >
              <svg className="h-3.5 w-3.5 text-security-navy-500" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
              </svg>
              <span>{payPeriod?.label ?? "Active Cycle"}</span>
              <span className="text-security-navy-400" aria-hidden="true">›</span>
            </Link>
          )}
        </div>
      </header>

      {/* Top Executive Bento Grid + Plethora AI */}
      <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
        <div className="flex flex-col gap-4 xl:col-span-9">
          <DashboardKpiCards
            guardsOnDuty={guardsOnDuty}
            activeSitesCount={activeSitesCount}
            activeSitesDelta={activeSitesDelta}
            shiftLabel={shiftInfo.currentShift === "day" ? "Day shift" : "Night shift"}
            shiftWindow={shiftInfo.timeWindow}
            periodName={cycleName}
            periodDates={cycleDates}
            canAttendance={canAttendance}
            canSites={canSites}
            canRostering={canRostering}
          />

          <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <WorkforceOverviewCard
                totalEmployees={totalEmployees}
                guardsOnDuty={guardsOnDuty}
                onLeaveToday={onLeaveToday}
              />
            </div>
            <div className="lg:col-span-7">
              <AttendanceTrendCard trend14d={attendanceTrend14d} />
            </div>
          </div>
        </div>

        <div className="flex xl:col-span-3">
          <PlethoraAiPanel
            companyName={companyName}
            workItems={workItems}
            rosterAttentionCount={rosterAttentionCount}
            pendingTimesheetsCount={pendingSiteTimesheetRows}
            openExceptionsCount={dashboard?.exportReadiness?.openExceptions ?? 0}
            guardsOnDuty={guardsOnDuty}
            activeSitesCount={activeSitesCount}
          />
        </div>
      </div>

      {/* Core Daily Workflows */}
      {!anyAccessibleModule ? (
        <div className="rounded-2xl border border-dashed border-security-navy-200 bg-white px-6 py-10 text-center">
          <p className="text-sm font-semibold text-security-navy-900">No modules assigned yet</p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm text-security-navy-500">
            Ask your company owner to grant module access in Settings → User Access.
          </p>
        </div>
      ) : (
        coreWorkflows.length > 0 && (
          <section aria-label="Core workflows" className="space-y-2.5">
            <h2 className="font-display text-sm font-semibold text-security-navy-900">
              Core Workflows
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {coreWorkflows.map((item) => {
                const status = moduleStatus[item.href];
                const description = MODULE_DESCRIPTIONS[item.href];

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group flex flex-col justify-between rounded-2xl border border-security-navy-100 bg-white p-4 text-security-navy-900 no-underline shadow-security-card transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:border-security-navy-200 hover:shadow-security-card-hover"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-security border border-security-navy-100 bg-security-navy-50 text-security-navy-700 transition-colors group-hover:border-security-amber-200 group-hover:bg-security-amber-50 group-hover:text-security-amber-700 [&_svg]:h-5 [&_svg]:w-5">
                        <ModuleIcon href={item.href} />
                      </span>
                      {status && (
                        <span
                          className={clsx(
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                            status.variant === "critical"
                              ? "bg-red-50 text-red-700"
                              : status.variant === "warning"
                                ? "bg-amber-50 text-amber-800"
                                : status.variant === "success"
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-security-navy-100 text-security-navy-700"
                          )}
                        >
                          {status.label}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 flex items-end justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-display text-sm font-semibold text-security-navy-950">
                          {item.label}
                        </h3>
                        {description && (
                          <p className="mt-0.5 line-clamp-1 text-xs text-security-navy-500">
                            {description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm text-security-navy-400 transition-transform group-hover:translate-x-0.5 group-hover:text-security-navy-700" aria-hidden="true">
                        ›
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )
      )}

      {/* Bottom Operational Summary + Upcoming Row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <section
          aria-label="Company scale summary"
          className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card lg:col-span-7"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-security-navy-950">
              Operational Summary
            </h2>
            <span className="text-xs text-security-navy-400">Tenant totals</span>
          </div>

          <div className="mt-4 grid grid-cols-2 divide-security-navy-100 sm:grid-cols-4 sm:divide-x">
            {[
              {
                label: "Employees",
                value: totalEmployees,
                href: canAccessRoute("/employees", user) ? "/employees" : undefined,
              },
              {
                label: "Sites",
                value: activeSitesCount,
                href: canSites ? "/sites" : undefined,
              },
              {
                label: "Posts",
                value: totalPosts,
                href: canSites ? "/sites" : undefined,
              },
              {
                label: "Active Clients",
                value: activeClientsCount,
                href: canAccessRoute("/clients", user) ? "/clients" : undefined,
              },
            ].map((stat, idx) => {
              const body = (
                <div className={clsx("py-1", idx > 0 && "sm:pl-4", idx < 3 && "sm:pr-3")}>
                  <p className="font-display text-xl font-bold text-security-navy-950 tabular-nums">
                    {stat.value.toLocaleString()}
                  </p>
                  <p className="mt-0.5 text-xs text-security-navy-500">{stat.label}</p>
                </div>
              );
              return stat.href ? (
                <Link key={stat.label} href={stat.href} className="block no-underline transition-opacity hover:opacity-80">
                  {body}
                </Link>
              ) : (
                <div key={stat.label}>{body}</div>
              );
            })}
          </div>
        </section>

        <section
          aria-label="Upcoming schedule and gates"
          className="rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card lg:col-span-5"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-display text-sm font-semibold text-security-navy-950">
              Upcoming
            </h2>
            {canRostering && (
              <Link
                href="/rostering"
                className="text-xs font-semibold text-indigo-700 no-underline hover:underline"
              >
                View Calendar →
              </Link>
            )}
          </div>

          <ul className="mt-3 divide-y divide-security-navy-100">
            {upcomingItems.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-1 last:pb-0">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${item.dotClass}`} aria-hidden="true" />
                  <div className="min-w-0">
                    {item.href ? (
                      <Link
                        href={item.href}
                        className="block truncate text-xs font-semibold text-security-navy-900 no-underline hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      <p className="truncate text-xs font-semibold text-security-navy-900">{item.title}</p>
                    )}
                    <p className="truncate text-[11px] text-security-navy-500">{item.subtitle}</p>
                  </div>
                </div>
                <span className={clsx("shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", item.badgeClass)}>
                  {item.badge}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </PageShell>
  );
}
