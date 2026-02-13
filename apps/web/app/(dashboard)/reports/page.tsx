"use client";

import Link from "next/link";

export default function ReportsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">
        Reports
      </h1>
      <p className="text-slate-600 dark:text-slate-400 mb-4">
        Reports module coming soon. For now, use the following modules:
      </p>
      <ul className="space-y-2">
        <li>
          <Link href="/attendance" className="text-primary-600 hover:underline">
            Attendance
          </Link>
          {" - View attendance records"}
        </li>
        <li>
          <Link href="/payroll" className="text-primary-600 hover:underline">
            Payroll
          </Link>
          {" - View payroll runs and items"}
        </li>
      </ul>
    </div>
  );
}
