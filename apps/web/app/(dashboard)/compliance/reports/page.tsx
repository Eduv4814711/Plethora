"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import {
  fetchTenderPack,
  fetchExecutiveRiskReport,
} from "@/lib/compliance-api";
import {
  AlertBanner,
  Badge,
  Button,
  Card,
  PageHeader,
  SkeletonBlock,
} from "@/components/ui";

export default function ComplianceReportsPage() {
  const { token } = useAuth();
  const [tenderPack, setTenderPack] = useState<any | null>(null);
  const [executiveRisk, setExecutiveRisk] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const loadReports = async () => {
      try {
        setLoading(true);
        setError("");
        const [tender, risk] = await Promise.all([
          fetchTenderPack(token),
          fetchExecutiveRiskReport(token),
        ]);
        setTenderPack(tender);
        setExecutiveRisk(risk);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load reports");
      } finally {
        setLoading(false);
      }
    };
    loadReports();
  }, [token]);

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tender Readiness & Executive Risk Reports"
        description="Official South African private security tender compliance packs and executive risk governance summaries."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={handlePrint}
            className="flex items-center space-x-1.5"
          >
            <span>🖨️</span>
            <span>Print Report / Save PDF</span>
          </Button>
        }
      />

      {error && <AlertBanner variant="error">{error}</AlertBanner>}

      {loading ? (
        <SkeletonBlock className="h-96" />
      ) : tenderPack ? (
        <>
          {/* Tender Readiness Overview */}
          <Card className="p-6 border border-border">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Official Tender Evaluation Pack
                </div>
                <h2 className="text-xl font-extrabold text-foreground mt-0.5">
                  {tenderPack.company?.name || "Company"}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generated {new Date(tenderPack.generatedAt).toLocaleString()}
                </p>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <div className="text-xs text-muted-foreground font-medium">Tender Score</div>
                  <div className="text-2xl font-bold font-mono text-primary">
                    {tenderPack.tenderReadinessPercentage}%
                  </div>
                </div>
                <Badge
                  variant={tenderPack.tenderReadinessPercentage >= 80 ? "success" : "error"}
                  className="text-xs py-1 px-2.5"
                >
                  {tenderPack.tenderReadinessPercentage >= 80
                    ? "Tender Qualified"
                    : "Action Required"}
                </Badge>
              </div>
            </div>

            {/* Checklist */}
            <div className="mt-4">
              <h3 className="text-sm font-semibold mb-3">Mandatory Statutory Criteria (Security Sector)</h3>
              <div className="divide-y divide-border">
                {tenderPack.checklist.map((item: any) => (
                  <div
                    key={item.type}
                    className="py-3 flex items-center justify-between hover:bg-muted/20 px-2 rounded transition-colors"
                  >
                    <div className="flex items-center space-x-3">
                      <span className={`text-base shrink-0 ${item.isCompliant ? "text-emerald-500" : "text-rose-500"}`}>
                        {item.isCompliant ? "✓" : "✗"}
                      </span>
                      <div>
                        <div className="font-semibold text-sm">{item.requiredTitle}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.referenceNumber ? `Ref: ${item.referenceNumber}` : "Reference not captured"}
                          {item.expiryDate ? ` · Expires: ${item.expiryDate.slice(0, 10)}` : ""}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Badge variant={item.isCompliant ? "success" : "error"}>
                        {item.currentStatus.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Card>

          {/* Executive Risk Dashboard Export */}
          {executiveRisk && (
            <Card className="p-6 border border-border">
              <h2 className="text-lg font-bold mb-1 flex items-center space-x-2">
                <span className="text-amber-500">🛡️</span>
                <span>Executive Risk Audit Summary</span>
              </h2>
              <p className="text-xs text-muted-foreground mb-4">
                Internal compliance liabilities, open labor arbitration exposure, and overdue statutory reconciliation.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="p-4 rounded-lg bg-muted/40 space-y-2">
                  <div className="font-semibold text-sm">High-Risk Obligations</div>
                  <div className="text-2xl font-bold text-rose-500">
                    {executiveRisk.criticalRisks?.obligations?.length ?? 0}
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Non-compliant obligations with High or Critical operational impact.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-muted/40 space-y-2">
                  <div className="font-semibold text-sm">Open Dispute Exposure</div>
                  <div className="text-2xl font-bold text-amber-500">
                    {executiveRisk.criticalRisks?.legalCases?.length ?? 0}
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Active CCMA referrals or labor litigation awaiting settlement.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-muted/40 space-y-2">
                  <div className="font-semibold text-sm">Overdue Statutory Returns</div>
                  <div className="text-2xl font-bold text-rose-500">
                    {executiveRisk.criticalRisks?.statutoryOverdue?.length ?? 0}
                  </div>
                  <p className="text-muted-foreground text-[11px]">
                    Filing periods past statutory cutoff requiring immediate remittance.
                  </p>
                </div>
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
