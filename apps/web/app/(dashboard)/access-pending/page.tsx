"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForUser, normalizeUserModuleAccess } from "@/lib/permissions";

export default function AccessPendingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    if (user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) {
      router.replace(getDefaultRouteForUser(user));
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 rounded-full bg-security-navy-200 animate-pulse" aria-hidden />
      </div>
    );
  }

  if (user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) {
    return null;
  }

  return (
    <div className="max-w-lg mx-auto module-shell">
      <div className="card-feature-orange p-6 sm:p-8 text-center space-y-4">
        <div className="mx-auto w-14 h-14 rounded-security-lg bg-white border border-security-navy-300 flex items-center justify-center shadow-security-card" aria-hidden>
          <svg className="w-7 h-7 text-black" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3m0 3.75h.008v.008H12V15.75zm9-3.75a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h1 className="page-title">No app access yet</h1>
        <p className="body-sm">
          Your account is active, but an administrator has not assigned any application modules to it. You cannot open
          payroll, team, or other areas until they do. If you believe this is a mistake, contact your company admin.
        </p>
        <p className="caption font-medium">You can still sign out from the profile menu.</p>
      </div>
    </div>
  );
}
