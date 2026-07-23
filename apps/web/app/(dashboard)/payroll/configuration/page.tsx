"use client";

import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { hasCapability } from "@/lib/permissions";
import { PageHeader } from "@/components/ui";
import { PayrollConfig } from "../payroll-config";

export default function PayrollConfigurationPage() {
  const { token, user } = useAuth();

  if (!token) return null;

  return (
    <div className="animate-fade-in max-w-6xl mx-auto space-y-6">
      <PageHeader
        title="Payroll configuration"
        description="Configure pay grades, pay rules, earnings, and deductions for your team."
        actions={
          <Link href="/payroll" className="btn-secondary text-sm">
            Back to payroll
          </Link>
        }
      />

      <PayrollConfig
        token={token}
        canCreate={Boolean(user && hasCapability(user, "/payroll", "create"))}
        canEdit={Boolean(user && hasCapability(user, "/payroll", "edit"))}
        canDelete={Boolean(user && hasCapability(user, "/payroll", "delete"))}
      />
    </div>
  );
}
