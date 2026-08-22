"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { StaffRollCall } from "@/components/staff-rollcall";
import { parseAttendanceDate } from "@/lib/attendance-navigation";

function StaffAttendancePageInner() {
  const { token } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [date, setDate] = useState(
    () => parseAttendanceDate(searchParams.get("date")) ?? new Date().toISOString().slice(0, 10)
  );

  const changeDate = (next: string) => {
    setDate(next);
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", next);
    router.replace(`${pathname}?${params}`, { scroll: false });
  };

  return (
    <main className="animate-fade-in space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-security-navy-600 dark:text-security-navy-300">
            Daily operations
          </p>
          <h1 className="page-title mt-1">Office staff attendance</h1>
          <p className="mt-1 max-w-2xl text-sm text-security-navy-600 dark:text-security-navy-400">
            Mark who was at the office today. Security officers are captured against their site
            instead.
          </p>
        </div>
        <Link href="/attendance" className="btn-secondary min-h-11 shrink-0 self-start text-sm">
          Guard attendance
        </Link>
      </header>

      {token && <StaffRollCall token={token} date={date} onDateChange={changeDate} />}
    </main>
  );
}

export default function StaffAttendancePage() {
  return (
    <Suspense fallback={<div className="h-32 animate-pulse rounded-security-lg bg-security-navy-100 dark:bg-security-navy-700" />}>
      <StaffAttendancePageInner />
    </Suspense>
  );
}
