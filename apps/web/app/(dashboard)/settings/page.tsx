"use client";

import { useAuth } from "@/lib/auth-context";

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-800 dark:text-white mb-6">
        Settings
      </h1>
      <div className="p-4 bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700">
        <h3 className="font-medium mb-4">Profile</h3>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-slate-500">Name</dt>
            <dd>{user?.name}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Email</dt>
            <dd>{user?.email}</dd>
          </div>
          <div>
            <dt className="text-slate-500">Role</dt>
            <dd>{user?.role}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
