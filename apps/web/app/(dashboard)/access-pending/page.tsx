"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForUser, hasAnyModuleView } from "@/lib/permissions";
import { EmptyState, PageShell, SkeletonBlock } from "@/components/ui";

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
      <PageShell width="narrow">
        <div className="flex min-h-[40vh] items-center justify-center">
          <SkeletonBlock className="h-10 w-48" />
        </div>
      </PageShell>
    );
  }

  if (hasAnyModuleView(user)) {
    return null;
  }

  return (
    <PageShell width="narrow" className="py-10">
      <EmptyState
        title="No app access yet"
        description="Your account is active, but the company owner or an access manager has not assigned any application modules yet. Contact your administrator to request access, or sign out from the profile menu."
      />
    </PageShell>
  );
}
