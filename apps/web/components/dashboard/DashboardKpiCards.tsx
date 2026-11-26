"use client";

import Link from "next/link";
import { clsx } from "clsx";

interface DashboardKpiCardsProps {
  guardsOnDuty: number;
  activeSitesCount: number;
  activeSitesDelta: number;
  shiftLabel: string;
  shiftWindow: string;
  periodName: string;
  periodDates: string;
  canAttendance: boolean;
  canSites: boolean;
  canRostering: boolean;
}

export function DashboardKpiCards({
  guardsOnDuty,
  activeSitesCount,
  activeSitesDelta,
  shiftLabel,
  shiftWindow,
  periodName,
  periodDates,
  canAttendance,
  canSites,
  canRostering,
}: DashboardKpiCardsProps) {
  const cards = [
    {
      key: "duty",
      label: "On Duty Now",
      value: guardsOnDuty.toLocaleString(),
      sublabel: guardsOnDuty === 0 ? "No active clock-ins" : "Guards actively clocked in",
      href: canAttendance ? "/attendance" : undefined,
      washClass: "kpi-wash-neutral",
      iconBg: "bg-security-navy-100/80 text-security-navy-700",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
        </svg>
      ),
    },
    {
      key: "sites",
      label: "Active Sites",
      value: activeSitesCount.toLocaleString(),
      deltaPill: activeSitesDelta > 0 ? `+${activeSitesDelta} this month` : undefined,
      sublabel: activeSitesDelta > 0 ? undefined : "Across active client portfolios",
      href: canSites ? "/sites" : undefined,
      washClass: "kpi-wash-emerald",
      iconBg: "bg-emerald-100/90 text-emerald-700",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
        </svg>
      ),
    },
    {
      key: "shift",
      label: "Current Shift",
      value: shiftLabel,
      sublabel: shiftWindow,
      href: canAttendance ? "/attendance" : undefined,
      washClass: "kpi-wash-amber",
      iconBg: "bg-amber-100/90 text-amber-700",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    },
    {
      key: "cycle",
      label: "Roster Cycle",
      value: periodName || "Active cycle",
      sublabel: periodDates || "26th–25th pay cycle",
      href: canRostering ? "/rostering" : undefined,
      washClass: "kpi-wash-indigo",
      iconBg: "bg-indigo-100/90 text-indigo-700",
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
      ),
    },
  ];

  return (
    <section aria-label="Operational summary" className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => {
        const inner = (
          <div className="flex h-full flex-col justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className={clsx("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-security", card.iconBg)}>
                {card.icon}
              </span>
              <span className="text-xs font-medium text-security-navy-600">{card.label}</span>
            </div>

            <div className="mt-1">
              <p
                className={clsx(
                  "font-display font-bold tracking-tight text-security-navy-950 tabular-nums",
                  card.key === "duty" || card.key === "sites"
                    ? "text-[1.75rem] leading-tight"
                    : card.key === "shift"
                      ? "text-xl leading-snug"
                      : "text-base leading-snug"
                )}
              >
                {card.value}
              </p>
              {card.deltaPill ? (
                <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-100/90 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                  <span aria-hidden="true">↑</span>
                  {card.deltaPill}
                </span>
              ) : (
                <p className="mt-1 text-xs text-security-navy-500">{card.sublabel}</p>
              )}
            </div>
          </div>
        );

        const sharedClass = clsx(
          "rounded-2xl border border-security-navy-100 p-4 shadow-security-card transition-[border-color,box-shadow,transform] duration-150",
          card.washClass
        );

        if (card.href) {
          return (
            <Link
              key={card.key}
              href={card.href}
              className={clsx(
                sharedClass,
                "block no-underline hover:-translate-y-0.5 hover:border-security-navy-200 hover:shadow-security-card-hover"
              )}
            >
              {inner}
            </Link>
          );
        }

        return (
          <div key={card.key} className={sharedClass}>
            {inner}
          </div>
        );
      })}
    </section>
  );
}
