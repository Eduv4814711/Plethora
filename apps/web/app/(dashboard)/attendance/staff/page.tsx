"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { StaffRollCall } from "@/components/staff-rollcall";
import { parseAttendanceDate } from "@/lib/attendance-navigation";
import { PageHeader, PageShell, SkeletonBlock } from "@/components/ui";

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
    <PageShell width="wide" className="animate-fade-in">
      <PageHeader
        title="Office staff attendance"
        description="Mark who was at the office today. Security officers are captured against their site instead."
        actions={
          <Link href="/attendance" className="btn-secondary no-underline">
            Guard attendance
          </Link>
        }
      />

      {token && <StaffRollCall token={token} date={date} onDateChange={changeDate} />}
    </PageShell>
  );
}

export default function StaffAttendancePage() {
  return (
    <Suspense fallback={<SkeletonBlock className="h-32 w-full" />}>
      <StaffAttendancePageInner />
    </Suspense>
  );
}
