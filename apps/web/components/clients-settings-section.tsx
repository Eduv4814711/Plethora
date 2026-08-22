"use client";

import Link from "next/link";
import { PageHeader } from "@/components/ui";

/**
 * Client records now live on their own page — this tab is kept as a signpost so anyone
 * who still looks for them under Settings finds them.
 */
export function ClientsSettingsSection(_props: { token: string }) {
  return (
    <section className="space-y-4">
      <PageHeader
        title="Clients"
        description="Client records have moved to their own page."
      />
      <div className="card-dashboard space-y-3 p-4">
        <p className="text-sm text-security-navy-700 dark:text-security-navy-300">
          Capture client details, link their sites, and download the month-end site report and
          timesheets from the Clients page.
        </p>
        <Link href="/clients" className="btn-primary inline-flex">
          Open Clients
        </Link>
        <p className="text-sm text-security-navy-600 dark:text-security-navy-400">
          Sites can also be linked from{" "}
          <Link href="/sites" className="text-security-navy-800 hover:underline">
            Sites
          </Link>
          . Preview what clients see at{" "}
          <Link href="/client-portal" className="text-security-navy-800 hover:underline">
            Client portal
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
