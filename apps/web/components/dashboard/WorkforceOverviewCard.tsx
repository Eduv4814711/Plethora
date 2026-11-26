"use client";

interface WorkforceOverviewCardProps {
  totalEmployees: number;
  guardsOnDuty: number;
  onLeaveToday: number;
}

export function WorkforceOverviewCard({
  totalEmployees,
  guardsOnDuty,
  onLeaveToday,
}: WorkforceOverviewCardProps) {
  const onDuty = Math.max(0, guardsOnDuty);
  const onLeave = Math.max(0, onLeaveToday);
  const notOnDuty = Math.max(0, totalEmployees - onDuty - onLeave);
  const totalForShare = Math.max(totalEmployees, onDuty + onLeave + notOnDuty);

  const pct = (value: number) =>
    totalForShare > 0 ? `${((value / totalForShare) * 100).toFixed(1)}%` : "0%";

  const radius = 56;
  const circumference = 2 * Math.PI * radius;

  const segments = [
    { key: "onDuty", label: "On Duty", value: onDuty, color: "#0E9F6E", dotClass: "bg-[#0E9F6E]" },
    { key: "notOnDuty", label: "Not On Duty", value: notOnDuty, color: "#F59E0B", dotClass: "bg-[#F59E0B]" },
    { key: "onLeave", label: "On Leave", value: onLeave, color: "#E2E8F0", dotClass: "bg-[#CBD5E1]" },
  ];

  let accumulatedFraction = 0;
  const arcs = segments
    .filter((s) => s.value > 0 && totalForShare > 0)
    .map((s) => {
      const fraction = s.value / totalForShare;
      const dashLength = Math.max(0, fraction * circumference - 3);
      const dashOffset = -(accumulatedFraction * circumference);
      accumulatedFraction += fraction;
      return { ...s, dashLength, dashOffset };
    });

  return (
    <section
      aria-label="Workforce overview"
      className="flex h-full flex-col justify-between rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-sm font-semibold text-security-navy-950">
          Workforce Overview
        </h2>
        <span className="text-xs text-security-navy-400">Live status</span>
      </div>

      <div className="mt-4 flex flex-col items-center gap-5 sm:flex-row sm:items-center">
        {/* Donut visual (hidden from screen readers in favor of the semantic <dl> beside it) */}
        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center" aria-hidden="true">
          <svg viewBox="0 0 144 144" className="h-full w-full -rotate-90">
            <circle
              cx="72"
              cy="72"
              r={radius}
              fill="none"
              stroke="#F1F5F9"
              strokeWidth="15"
            />
            {arcs.map((arc) => (
              <circle
                key={arc.key}
                cx="72"
                cy="72"
                r={radius}
                fill="none"
                stroke={arc.color}
                strokeWidth="15"
                strokeLinecap="round"
                strokeDasharray={`${arc.dashLength} ${circumference}`}
                strokeDashoffset={arc.dashOffset}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-2xl font-bold tracking-tight text-security-navy-950 tabular-nums">
              {totalEmployees.toLocaleString()}
            </span>
            <span className="text-[11px] font-medium text-security-navy-500">Employees</span>
          </div>
        </div>

        {/* Accessible semantic breakdown list */}
        <dl className="w-full min-w-0 flex-1 space-y-3">
          {segments.map((seg) => (
            <div key={seg.key} className="flex items-center justify-between gap-3 text-xs">
              <dt className="flex items-center gap-2 text-security-navy-600">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${seg.dotClass}`} aria-hidden="true" />
                <span>{seg.label}</span>
              </dt>
              <dd className="flex items-baseline gap-1.5 font-semibold text-security-navy-950 tabular-nums">
                <span>{seg.value.toLocaleString()}</span>
                <span className="font-normal text-security-navy-400">({pct(seg.value)})</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
