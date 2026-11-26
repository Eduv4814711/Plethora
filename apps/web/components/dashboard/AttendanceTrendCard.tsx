"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AttendanceTrendDay } from "@/lib/today-work-list-utils";

interface AttendanceTrendCardProps {
  trend14d: AttendanceTrendDay[];
}

export function AttendanceTrendCard({ trend14d }: AttendanceTrendCardProps) {
  const [days, setDays] = useState<7 | 14>(7);

  const visibleData = useMemo(() => {
    const slice = days === 7 ? trend14d.slice(-7) : trend14d;
    return slice.map((item) => ({
      ...item,
      rateValue: item.rate ?? 0,
      hasData: item.scheduled > 0,
    }));
  }, [trend14d, days]);

  const hasAnyScheduled = visibleData.some((d) => d.scheduled > 0);

  return (
    <section
      aria-label="Attendance trend"
      className="flex h-full flex-col justify-between rounded-2xl border border-security-navy-100 bg-white p-5 shadow-security-card"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <h2 className="font-display text-sm font-semibold text-security-navy-950">
            Attendance Trend
          </h2>
          <span className="text-xs text-security-navy-400">Daily rate</span>
        </div>

        <select
          value={days}
          onChange={(e) => setDays(e.target.value === "14" ? 14 : 7)}
          aria-label="Select attendance trend window"
          className="h-8 rounded-security border border-security-navy-200 bg-white px-2.5 text-xs font-medium text-security-navy-700 outline-none transition-colors hover:border-security-navy-300 focus:border-security-amber-500"
        >
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
        </select>
      </div>

      {!hasAnyScheduled ? (
        <div className="mt-4 flex h-[196px] flex-col items-center justify-center rounded-security-lg border border-dashed border-security-navy-100 bg-security-navy-50/40 px-4 text-center">
          <p className="text-xs font-semibold text-security-navy-700">No shift captures yet</p>
          <p className="mt-1 text-xs text-security-navy-500">
            Attendance rate bars appear once site timesheets are generated and captured.
          </p>
        </div>
      ) : (
        <div className="mt-3 h-[196px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={visibleData} margin={{ top: 8, right: 6, left: -18, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#EEF2F6" strokeDasharray="3 3" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 11 }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#64748B", fontSize: 11 }}
              />
              <Tooltip
                cursor={{ fill: "rgba(15, 23, 42, 0.04)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const row = payload[0]?.payload as {
                    date: string;
                    label: string;
                    attended: number;
                    scheduled: number;
                    rate: number | null;
                  };
                  return (
                    <div className="rounded-security bg-security-navy-950 px-3 py-1.5 text-xs text-white shadow-security-elevated">
                      <p className="font-semibold tabular-nums">
                        {row.rate !== null ? `${row.rate.toFixed(1)}%` : "No shifts"}
                      </p>
                      <p className="text-[11px] text-white/75 tabular-nums">
                        {row.label} ({row.date}) · {row.attended}/{row.scheduled} shifts
                      </p>
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="rateValue"
                fill="#0E9F6E"
                radius={[6, 6, 0, 0]}
                maxBarSize={days === 7 ? 32 : 18}
                background={{ fill: "#EEF2F6", radius: 6 }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Accessible data table summary for screen readers */}
      <dl className="sr-only">
        {visibleData.map((d) => (
          <div key={d.date}>
            <dt>{d.date}</dt>
            <dd>{d.rate !== null ? `${d.rate}% (${d.attended} of ${d.scheduled})` : "No scheduled shifts"}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
