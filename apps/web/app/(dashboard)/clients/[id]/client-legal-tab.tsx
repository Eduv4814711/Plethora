"use client";

import { useState } from "react";
import {
  createClientRelatedParty,
  updateClientRelatedParty,
  deleteClientRelatedParty,
  type ClientDetail,
  type ClientEntityType,
  type ClientOnboardingStatus,
  type ClientRelatedParty,
  type ClientRelationshipType,
} from "@/lib/msr-api";

const ENTITY_TYPE_LABELS: Record<ClientEntityType, string> = {
  PRIVATE_COMPANY: "Private Company (Pty Ltd)",
  CLOSE_CORPORATION: "Close Corporation (CC)",
  TRUST: "Trust",
  PARTNERSHIP: "Partnership",
  SOLE_PROPRIETOR: "Sole Proprietor",
  NATURAL_PERSON: "Natural Person",
  GOVERNMENT: "Government Dept",
  MUNICIPALITY: "Municipality",
  BODY_CORPORATE_HOA: "Body Corporate / HOA",
  NPO: "Non-Profit Org (NPO)",
  OTHER: "Other Entity",
};

const RELATIONSHIP_TYPE_LABELS: Record<ClientRelationshipType, string> = {
  DIRECTOR: "Director",
  MEMBER: "Member (CC)",
  TRUSTEE: "Trustee",
  PARTNER: "Partner",
  BENEFICIAL_OWNER: "Beneficial Owner",
  AUTHORISED_SIGNATORY: "Authorised Signatory",
  OTHER: "Other Representative",
};

interface ClientLegalTabProps {
  client: ClientDetail;
  canEdit: boolean;
  token: string;
  onSaveClient: (data: any) => Promise<void>;
  relatedParties: ClientRelatedParty[];
  onRefreshRelatedParties: () => Promise<void>;
  onError: (err: string) => void;
  onSuccess: (msg: string) => void;
}

export function ClientLegalTab({
  client,
  canEdit,
  token,
  onSaveClient,
  relatedParties,
  onRefreshRelatedParties,
  onError,
  onSuccess,
}: ClientLegalTabProps) {
  // Client identity form state
  const [name, setName] = useState(client.name || "");
  const [legalName, setLegalName] = useState(client.legalName || "");
  const [tradingName, setTradingName] = useState(client.tradingName || "");
  const [entityType, setEntityType] = useState<ClientEntityType>(client.entityType || "PRIVATE_COMPANY");
  const [registrationNumber, setRegistrationNumber] = useState(client.registrationNumber || "");
  const [taxNumber, setTaxNumber] = useState(client.taxNumber || "");
  const [vatNumber, setVatNumber] = useState(client.vatNumber || "");
  const [registeredAddress, setRegisteredAddress] = useState(client.registeredAddress || "");
  const [physicalAddress, setPhysicalAddress] = useState(client.physicalAddress || "");
  const [billingEmail, setBillingEmail] = useState(client.billingEmail || "");
  const [billingAddress, setBillingAddress] = useState(client.billingAddress || "");
  const [paymentTermsDays, setPaymentTermsDays] = useState(String(client.paymentTermsDays ?? 30));
  const [onboardingStatus, setOnboardingStatus] = useState<ClientOnboardingStatus>(
    client.onboardingStatus || "DRAFT"
  );
  const [isActive, setIsActive] = useState(client.isActive);
  const [notes, setNotes] = useState(client.notes || "");
  const [savingClient, setSavingClient] = useState(false);

  // Related party modal state
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [editingPartyId, setEditingPartyId] = useState<string | null>(null);
  const [partyName, setPartyName] = useState("");
  const [partyType, setPartyType] = useState<ClientRelationshipType>("DIRECTOR");
  const [partyOwnership, setPartyOwnership] = useState("");
  const [partyIsSignatory, setPartyIsSignatory] = useState(false);
  const [partyAuthRef, setPartyAuthRef] = useState("");
  const [partyNotes, setPartyNotes] = useState("");
  const [savingParty, setSavingParty] = useState(false);

  const handleSaveIdentity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEdit) return;
    setSavingClient(true);
    try {
      await onSaveClient({
        name: name.trim(),
        legalName: legalName.trim() || null,
        tradingName: tradingName.trim() || null,
        entityType,
        registrationNumber: registrationNumber.trim() || null,
        taxNumber: taxNumber.trim() || null,
        vatNumber: vatNumber.trim() || null,
        registeredAddress: registeredAddress.trim() || null,
        physicalAddress: physicalAddress.trim() || null,
        billingEmail: billingEmail.trim() || null,
        billingAddress: billingAddress.trim() || null,
        paymentTermsDays: Number(paymentTermsDays) || 30,
        onboardingStatus,
        isActive,
        notes: notes.trim() || null,
      });
      onSuccess("Legal identity updated successfully.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save client details");
    } finally {
      setSavingClient(false);
    }
  };

  const openAddParty = () => {
    setEditingPartyId(null);
    setPartyName("");
    setPartyType("DIRECTOR");
    setPartyOwnership("");
    setPartyIsSignatory(false);
    setPartyAuthRef("");
    setPartyNotes("");
    setShowPartyModal(true);
  };

  const openEditParty = (party: ClientRelatedParty) => {
    setEditingPartyId(party.id);
    setPartyName(party.fullName);
    setPartyType(party.relationshipType);
    setPartyOwnership(party.ownershipPercent ? String(party.ownershipPercent) : "");
    setPartyIsSignatory(party.isAuthorisedSignatory);
    setPartyAuthRef(party.authorityReference || "");
    setPartyNotes(party.notes || "");
    setShowPartyModal(true);
  };

  const handleSaveParty = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !partyName.trim()) return;
    setSavingParty(true);
    try {
      const payload = {
        fullName: partyName.trim(),
        relationshipType: partyType,
        ownershipPercent: partyOwnership.trim() ? Number(partyOwnership) : null,
        isAuthorisedSignatory: partyIsSignatory,
        authorityReference: partyAuthRef.trim() || null,
        notes: partyNotes.trim() || null,
        isActive: true,
      };

      if (editingPartyId) {
        await updateClientRelatedParty(token, client.id, editingPartyId, payload);
        onSuccess("Related party updated.");
      } else {
        await createClientRelatedParty(token, client.id, payload);
        onSuccess("Related party registered.");
      }

      setShowPartyModal(false);
      await onRefreshRelatedParties();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save related party");
    } finally {
      setSavingParty(false);
    }
  };

  const handleDeleteParty = async (partyId: string) => {
    if (!token || !confirm("Are you sure you want to remove this related party / representative?")) return;
    try {
      await deleteClientRelatedParty(token, client.id, partyId);
      onSuccess("Related party removed.");
      await onRefreshRelatedParties();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete related party");
    }
  };

  return (
    <div className="space-y-8">
      {/* Corporate Legal Master Record Form */}
      <form onSubmit={handleSaveIdentity} className="card-dashboard space-y-6 p-6">
        <div>
          <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
            Legal Entity Identity & Master Record
          </h2>
          <p className="text-xs text-security-navy-500">
            Authoritative legal and statutory parameters. Identity evidence (CIPC, Proof of Address, Trust Deeds) should be attached under Documents.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label-text mb-1 block">Display / Account Name *</label>
            <input
              className="input-modern w-full"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Registered Legal Name</label>
            <input
              className="input-modern w-full"
              placeholder="Full legal entity name per CIPC"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Trading Name (t/a)</label>
            <input
              className="input-modern w-full"
              placeholder="e.g. Acme Security Logistics"
              value={tradingName}
              onChange={(e) => setTradingName(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Entity Type</label>
            <select
              className="input-modern w-full"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as ClientEntityType)}
              disabled={!canEdit}
            >
              {Object.entries(ENTITY_TYPE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Company / Entity Registration #</label>
            <input
              className="input-modern w-full font-mono text-xs"
              placeholder="YYYY/NNNNNN/NN"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">SARS Income Tax #</label>
            <input
              className="input-modern w-full font-mono text-xs"
              placeholder="10-digit tax number"
              value={taxNumber}
              onChange={(e) => setTaxNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">VAT Registration #</label>
            <input
              className="input-modern w-full font-mono text-xs"
              placeholder="4NNNNNNNNN"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div>
            <label className="label-text mb-1 block">Onboarding & Governance Status</label>
            <select
              className="input-modern w-full"
              value={onboardingStatus}
              onChange={(e) => setOnboardingStatus(e.target.value as ClientOnboardingStatus)}
              disabled={!canEdit}
            >
              <option value="DRAFT">Draft — Initial Data Capture</option>
              <option value="IN_REVIEW">In Review — Evidence Pending</option>
              <option value="READY">Ready — Verified for Deployment</option>
              <option value="ACTIVE">Active — In Service</option>
              <option value="SUSPENDED">Suspended — Operational Freeze</option>
              <option value="CLOSED">Closed — Terminated Relationship</option>
            </select>
          </div>

          <div>
            <label className="label-text mb-1 block">Payment Terms (Days)</label>
            <input
              type="number"
              min={0}
              max={365}
              className="input-modern w-full"
              value={paymentTermsDays}
              onChange={(e) => setPaymentTermsDays(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-3 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label-text mb-1 block">Official Registered Address</label>
              <textarea
                rows={2}
                className="input-modern w-full text-xs"
                placeholder="Official address for legal service / notices"
                value={registeredAddress}
                onChange={(e) => setRegisteredAddress(e.target.value)}
                disabled={!canEdit}
              />
            </div>

            <div>
              <label className="label-text mb-1 block">Physical Operations HQ</label>
              <textarea
                rows={2}
                className="input-modern w-full text-xs"
                placeholder="Physical headquarters or principal place of business"
                value={physicalAddress}
                onChange={(e) => setPhysicalAddress(e.target.value)}
                disabled={!canEdit}
              />
            </div>
          </div>

          <div>
            <label className="label-text mb-1 block">Billing Email</label>
            <input
              type="email"
              className="input-modern w-full"
              placeholder="accounts@client.co.za"
              value={billingEmail}
              onChange={(e) => setBillingEmail(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-2">
            <label className="label-text mb-1 block">Billing Postal Address</label>
            <input
              className="input-modern w-full"
              placeholder="Billing address printed on statements"
              value={billingAddress}
              onChange={(e) => setBillingAddress(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-3">
            <label className="label-text mb-1 block">Internal Commercial Notes</label>
            <textarea
              rows={2}
              className="input-modern w-full text-xs"
              placeholder="Confidential notes on client background, governance or special terms..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={!canEdit}
            />
          </div>

          <div className="sm:col-span-3 flex items-center justify-between pt-2">
            <label className="flex items-center gap-2 text-sm font-medium text-security-navy-800 dark:text-security-navy-200">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={!canEdit}
              />
              Active Client Record (serviced by Plethora operations)
            </label>

            {canEdit && (
              <button type="submit" className="btn-primary text-sm" disabled={savingClient}>
                {savingClient ? "Saving Changes..." : "Save Legal Identity"}
              </button>
            )}
          </div>
        </div>
      </form>

      {/* Related Parties & Authorised Representatives Section */}
      <div className="card-dashboard space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
          <div>
            <h2 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
              Directors, Beneficial Owners & Authorised Representatives
            </h2>
            <p className="text-xs text-security-navy-500">
              Documenting individuals empowered to enter into contracts or holding significant ownership interest.
            </p>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={openAddParty}
              className="btn-secondary text-xs"
            >
              + Add Representative
            </button>
          )}
        </div>

        {relatedParties.length === 0 ? (
          <div className="rounded-security border border-dashed border-security-navy-200 p-8 text-center text-xs text-security-navy-500 dark:border-security-navy-700">
            No directors or authorised representatives recorded yet.
            {canEdit && (
              <div className="mt-2">
                <button
                  type="button"
                  onClick={openAddParty}
                  className="font-medium text-security-amber-600 hover:underline"
                >
                  Record first director / signatory
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-security border border-security-navy-100 dark:border-security-navy-800">
            <table className="min-w-full divide-y divide-security-navy-100 text-xs dark:divide-security-navy-800">
              <thead className="bg-security-navy-50 dark:bg-security-navy-900">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-security-navy-500">
                  <th className="px-4 py-2.5">Representative</th>
                  <th className="px-4 py-2.5">Role</th>
                  <th className="px-4 py-2.5">Ownership</th>
                  <th className="px-4 py-2.5">Signatory Power</th>
                  <th className="px-4 py-2.5">Authority Reference</th>
                  {canEdit && <th className="px-4 py-2.5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100 dark:divide-security-navy-800">
                {relatedParties.map((party) => (
                  <tr key={party.id} className="hover:bg-security-navy-50/50 dark:hover:bg-security-navy-800/40">
                    <td className="px-4 py-3 font-medium text-security-navy-900 dark:text-security-navy-100">
                      {party.fullName}
                      {party.notes && <div className="text-[11px] text-security-navy-500">{party.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-security-navy-700 dark:text-security-navy-300">
                      {RELATIONSHIP_TYPE_LABELS[party.relationshipType]}
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {party.ownershipPercent !== null && party.ownershipPercent !== undefined
                        ? `${party.ownershipPercent}%`
                        : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {party.isAuthorisedSignatory ? (
                        <span className="rounded-full bg-security-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-security-emerald-800 dark:bg-security-emerald-950/60 dark:text-security-emerald-300">
                          Authorised Signatory
                        </span>
                      ) : (
                        <span className="text-security-navy-400">Standard</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-security-navy-600 dark:text-security-navy-400">
                      {party.authorityReference || "—"}
                    </td>
                    {canEdit && (
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          type="button"
                          onClick={() => openEditParty(party)}
                          className="font-medium text-security-navy-700 hover:underline dark:text-security-navy-300"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteParty(party.id)}
                          className="font-medium text-red-600 hover:underline"
                        >
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit Representative Modal */}
      {showPartyModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-security-navy-950/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated dark:border-security-navy-700 dark:bg-security-navy-900">
            <div className="flex items-center justify-between border-b border-security-navy-100 pb-3 dark:border-security-navy-800">
              <h3 className="text-base font-semibold text-security-navy-900 dark:text-security-navy-100">
                {editingPartyId ? "Edit Representative" : "Add Director / Representative"}
              </h3>
              <button
                type="button"
                onClick={() => setShowPartyModal(false)}
                className="text-security-navy-400 hover:text-security-navy-600 dark:hover:text-security-navy-200"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveParty} className="mt-4 space-y-4 text-xs">
              <div>
                <label className="label-text mb-1 block">Full Name *</label>
                <input
                  className="input-modern w-full"
                  placeholder="e.g. Siyabonga Nkosi"
                  value={partyName}
                  onChange={(e) => setPartyName(e.target.value)}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">Relationship / Role</label>
                  <select
                    className="input-modern w-full"
                    value={partyType}
                    onChange={(e) => setPartyType(e.target.value as ClientRelationshipType)}
                  >
                    {Object.entries(RELATIONSHIP_TYPE_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="label-text mb-1 block">Ownership Percentage (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="100"
                    className="input-modern w-full"
                    placeholder="e.g. 50"
                    value={partyOwnership}
                    onChange={(e) => setPartyOwnership(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label-text mb-1 block">Authority / Resolution Reference</label>
                <input
                  className="input-modern w-full"
                  placeholder="e.g. Board Resolution dated 2026-01-15"
                  value={partyAuthRef}
                  onChange={(e) => setPartyAuthRef(e.target.value)}
                />
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-security-navy-800 dark:text-security-navy-200">
                  <input
                    type="checkbox"
                    checked={partyIsSignatory}
                    onChange={(e) => setPartyIsSignatory(e.target.checked)}
                  />
                  Has legal authority to sign commercial service agreements
                </label>
              </div>

              <div>
                <label className="label-text mb-1 block">Internal Notes</label>
                <textarea
                  rows={2}
                  className="input-modern w-full"
                  placeholder="Additional governance or verification details..."
                  value={partyNotes}
                  onChange={(e) => setPartyNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4 dark:border-security-navy-800">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPartyModal(false)}
                  disabled={savingParty}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={savingParty || !partyName.trim()}>
                  {savingParty ? "Saving..." : "Save Representative"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
