"use client";

import Link from "next/link";
import { StatCard, AlertBanner } from "@/components/ui";
import { hasCapability } from "@/lib/permissions";
import type {
  ClientDetail,
  ClientContact,
  ClientContract,
  ClientComplianceEvaluation,
} from "@/lib/msr-api";

interface ClientOverviewTabProps {
  client: ClientDetail;
  compliance: ClientComplianceEvaluation | null;
  contacts: ClientContact[];
  contracts: ClientContract[];
  user: any;
  onTabChange: (tabId: any) => void;
}

export function ClientOverviewTab({
  client,
  compliance,
  contacts,
  contracts,
  user,
  onTabChange,
}: ClientOverviewTabProps) {
  const canAccessBilling = Boolean(
    user && (user.isOwner || hasCapability(user, "/payroll/billing", "view"))
  );

  const activeContracts = contracts.filter((c) => c.status === "ACTIVE");
  const expiringContracts = contracts.filter((c) => {
    if (!c.effectiveTo || c.status !== "ACTIVE") return false;
    const diffDays = (new Date(c.effectiveTo).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 60;
  });

  const primaryContact =
    contacts.find((c) => c.isPrimary) ||
    contacts[0] ||
    (client.contactPersonName
      ? {
          firstName: client.contactPersonName,
          lastName: "",
          jobTitle: client.contactPersonRole || "Contact Person",
          email: client.email || "",
          mobile: client.contactPersonMobile || client.phone || "",
        }
      : null);

  const operationsContact = contacts.find((c) => c.contactType === "OPERATIONS");
  const missingChecks = compliance?.checks.filter((c) => c.status === "MISSING" || c.status === "ATTENTION") || [];

  return (
    <div className="space-y-6">
      {/* Exception Banner if compliance or onboarding requires attention */}
      {missingChecks.length > 0 && (
        <AlertBanner
          variant="warning"
          title={`${missingChecks.length} Compliance & Governance Exception(s) Require Attention`}
        >
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs">
            {missingChecks.slice(0, 4).map((chk) => (
              <li key={chk.key}>
                <strong className="capitalize">{chk.label}:</strong> {chk.message}
              </li>
            ))}
          </ul>
          <div className="mt-3">
            <button
              type="button"
              onClick={() => onTabChange("documents")}
              className="text-xs font-semibold text-security-amber-900 underline hover:text-security-amber-700"
            >
              Review all compliance checks in Documents & Compliance →
            </button>
          </div>
        </AlertBanner>
      )}

      {/* Contract Expiry Warning */}
      {expiringContracts.length > 0 && (
        <AlertBanner
          variant="warning"
          title={`Contract Expiry Warning: ${expiringContracts.length} Agreement(s) Expiring Within 60 Days`}
        >
          <div className="text-xs">
            {expiringContracts.map((c) => (
              <div key={c.id} className="mt-1">
                Agreement <strong>{c.contractNumber}</strong> ({c.title}) ends on{" "}
                {c.effectiveTo ? new Date(c.effectiveTo).toLocaleDateString() : "—"}. Notice period:{" "}
                {c.noticePeriodDays ?? 30} days.
              </div>
            ))}
          </div>
        </AlertBanner>
      )}

      {/* Key Metric Tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard
          label="Onboarding & Readiness"
          value={client.onboardingStatus || "DRAFT"}
          hint={compliance ? `Score: ${compliance.summary.complete}/${compliance.summary.total - compliance.summary.notApplicable} checks passed` : "Initial capture"}
          tone={client.onboardingStatus === "ACTIVE" ? "good" : client.onboardingStatus === "READY" ? "live" : "warn"}
        />
        <StatCard
          label="Active Agreements"
          value={activeContracts.length}
          hint={contracts.length === 0 ? "No agreements on file" : `${contracts.length} total registered`}
          tone={activeContracts.length > 0 ? "good" : "bad"}
        />
        <StatCard
          label="Operational Sites"
          value={client.sites.length}
          hint="Assigned security posts"
          tone={client.sites.length > 0 ? "live" : "idle"}
        />
        <StatCard
          label="Compliance Status"
          value={compliance?.overallStatus || "ATTENTION"}
          hint={missingChecks.length === 0 ? "All verified" : `${missingChecks.length} action items`}
          tone={compliance?.overallStatus === "COMPLETE" ? "good" : "warn"}
        />
      </div>

      {/* 2-Column Summary Cards */}
      <div className="grid gap-6 sm:grid-cols-2">
        {/* Commercial & Contact Profile */}
        <div className="card-dashboard space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-security-navy-800 dark:text-security-navy-200">
              Primary Contacts
            </h2>
            <button
              type="button"
              onClick={() => onTabChange("contacts")}
              className="text-xs text-security-amber-600 hover:underline"
            >
              Manage contacts ({contacts.length}) →
            </button>
          </div>

          <div className="space-y-3">
            {primaryContact ? (
              <div className="rounded-security border border-security-navy-100 bg-security-navy-50/50 p-3 dark:border-security-navy-800 dark:bg-security-navy-900/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-security-navy-900 dark:text-security-navy-100">
                    {primaryContact.firstName} {primaryContact.lastName || ""}
                  </span>
                  <span className="rounded-full bg-security-amber-100 px-2 py-0.5 text-[10px] font-semibold text-security-amber-800">
                    Primary
                  </span>
                </div>
                <div className="mt-1 text-xs text-security-navy-600 dark:text-security-navy-400">
                  {primaryContact.jobTitle || "Representative"}
                </div>
                <div className="mt-2 flex flex-wrap gap-4 text-xs font-mono text-security-navy-700 dark:text-security-navy-300">
                  {primaryContact.mobile && <span>📞 {primaryContact.mobile}</span>}
                  {primaryContact.email && <span>✉️ {primaryContact.email}</span>}
                </div>
              </div>
            ) : (
              <p className="text-xs text-security-navy-500">No primary contact recorded.</p>
            )}

            {operationsContact && operationsContact !== primaryContact && (
              <div className="rounded-security border border-security-navy-100 bg-white p-3 dark:border-security-navy-800 dark:bg-security-navy-900">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-security-navy-900 dark:text-security-navy-100">
                    {operationsContact.firstName} {operationsContact.lastName || ""}
                  </span>
                  <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">
                    Operations
                  </span>
                </div>
                <div className="mt-1 text-xs text-security-navy-500">
                  {operationsContact.mobile || operationsContact.email || "No contact info"}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-security-navy-100 pt-3 text-xs text-security-navy-500 dark:border-security-navy-800">
            <strong>Registered Address:</strong>{" "}
            {client.registeredAddress || client.physicalAddress || "Not specified"}
          </div>
        </div>

        {/* Commercial & Contract Summary */}
        <div className="card-dashboard space-y-4 p-5">
          <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-security-navy-800 dark:text-security-navy-200">
              Commercial & Finance
            </h2>
            {canAccessBilling && (
              <Link
                href={`/payroll/billing/clients/${client.id}`}
                className="text-xs font-medium text-security-emerald-700 hover:underline dark:text-security-emerald-400"
              >
                Open Client Billing →
              </Link>
            )}
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-security-navy-100 dark:border-security-navy-800">
              <span className="text-security-navy-500">VAT Registration:</span>
              <span className="font-mono font-medium text-security-navy-800 dark:text-security-navy-200">
                {client.vatNumber || "Not VAT Registered"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-security-navy-100 dark:border-security-navy-800">
              <span className="text-security-navy-500">Payment Terms:</span>
              <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                {client.paymentTermsDays ?? 30} Days
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-security-navy-100 dark:border-security-navy-800">
              <span className="text-security-navy-500">Billing Email:</span>
              <span className="font-mono text-security-navy-800 dark:text-security-navy-200">
                {client.billingEmail || "Same as primary"}
              </span>
            </div>
            <div className="flex justify-between py-1">
              <span className="text-security-navy-500">Portal User Account:</span>
              <span className="font-medium text-security-navy-800 dark:text-security-navy-200">
                {client.user ? `${client.user.name} (${client.user.email})` : "No portal account linked"}
              </span>
            </div>
          </div>

          {canAccessBilling ? (
            <div className="rounded-security bg-security-emerald-50/60 p-3 text-xs text-security-emerald-900 dark:bg-security-emerald-950/40 dark:text-security-emerald-300">
              <div className="font-semibold">Billing Rate & Invoicing Governance</div>
              <p className="mt-0.5 text-[11px] leading-relaxed">
                Site pricing, billing rates and credit notes are strictly managed under Client Billing.
              </p>
              <Link
                href={`/payroll/billing/clients/${client.id}`}
                className="mt-2 inline-block font-semibold underline"
              >
                Manage Rates & Invoicing in Billing Module
              </Link>
            </div>
          ) : (
            <div className="rounded-security bg-security-navy-50 p-3 text-xs text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-400">
              Pricing and billing rates are restricted to authorised Finance personnel under{" "}
              <code>/payroll/billing</code>.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
