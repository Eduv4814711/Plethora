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
    if (user.isSystemOwner || user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) {
      router.replace(getDefaultRouteForUser(user));
    }
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="w-8 h-8 rounded-sm bg-neutral-100 dark:bg-neutral-900/30 animate-pulse" />
      </div>
    );
  }

  if (user.isSystemOwner || user.role === "admin" || normalizeUserModuleAccess(user.moduleAccess)) {
    return null;
  }

  return (
    <div className="max-w-lg mx-auto card-wireframe p-8 text-center space-y-4">
      <h1 className="text-xl font-semibold text-neutral-900 dark:text-white">No app access yet</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400 leading-relaxed">
        Your account is active, but an administrator has not assigned any application modules to it. You cannot open
        payroll, team, or other areas until they do. If you believe this is a mistake, contact your company admin.
      </p>
      <p className="text-xs text-neutral-500 dark:text-neutral-500">You can still sign out from the profile menu.</p>
    </div>
  );
}
