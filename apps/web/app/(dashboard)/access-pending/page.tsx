"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForUser, hasAnyModuleView } from "@/lib/permissions";

export default function AccessPendingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    if (hasAnyModuleView(user)) {
      router.replace(getDefaultRouteForUser(user));
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 rounded-sm bg-security-navy-50 dark:bg-security-navy-900/30 animate-pulse" />
      </div>
    );
  }

  if (hasAnyModuleView(user)) {
    return null;
  }

  return (
    <div className="max-w-lg mx-auto card-wireframe p-8 text-center space-y-4">
      <h1 className="text-xl font-semibold text-security-navy-900 dark:text-white">No app access yet</h1>
      <p className="text-sm text-security-navy-600 dark:text-security-navy-400 leading-relaxed">
        Your account is active, but the company owner or an access manager has not assigned any application modules to it. You cannot open
        payroll, team, or other areas until they do. If you believe this is a mistake, contact your company admin.
      </p>
      <p className="text-xs text-security-navy-500 dark:text-security-navy-500">You can still sign out from the profile menu.</p>
    </div>
  );
}
