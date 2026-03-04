"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { PayrollConfig } from "../payroll-config";

export default function PayrollConfigurationPage() {
  const { token } = useAuth();

  if (!token) return null;

  return (
    <div className="animate-fade-in">
      <div className="flex items-center gap-4 mb-8">
        <Link
          href="/payroll"
          className="p-2.5 rounded-lg border-2 border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-600 transition-all"
          aria-label="Back to payroll"
        >
          <svg className="w-5 h-5 text-neutral-600 dark:text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <div>
          <h1 className="page-title">Payroll Configuration</h1>
          <p className="text-neutral-500 dark:text-neutral-400 mt-0.5 text-sm">
            Configure pay grades, pay rules, earnings, and deductions
          </p>
        </div>
      </div>

      <PayrollConfig token={token} />
    </div>
  );
}
