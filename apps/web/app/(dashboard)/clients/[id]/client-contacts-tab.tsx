"use client";

import { useState } from "react";
import { Button, Modal } from "@/components/ui";
import {
  createClientContact,
  updateClientContact,
  deleteClientContact,
  type ClientContact,
  type ClientContactType,
  type ClientDetail,
} from "@/lib/msr-api";

const CONTACT_TYPE_CONFIG: Record<
  ClientContactType,
  { label: string; badgeClass: string }
> = {
  PRIMARY: {
    label: "Primary",
    badgeClass: "bg-security-amber-100 text-security-amber-800",
  },
  OPERATIONS: {
    label: "Operations",
    badgeClass: "bg-blue-100 text-blue-800",
  },
  BILLING: {
    label: "Billing / Accounts",
    badgeClass: "bg-security-emerald-100 text-security-emerald-800",
  },
  EMERGENCY: {
    label: "Emergency (24/7)",
    badgeClass: "bg-red-100 text-red-800",
  },
  PROCUREMENT: {
    label: "Procurement",
    badgeClass: "bg-purple-100 text-purple-800",
  },
  LEGAL: {
    label: "Legal / Compliance",
    badgeClass: "bg-indigo-100 text-indigo-800",
  },
  INFORMATION_OFFICER: {
    label: "Information Officer (POPIA)",
    badgeClass: "bg-teal-100 text-teal-800",
  },
  AUTHORISED_SIGNATORY: {
    label: "Authorised Signatory",
    badgeClass: "bg-amber-100 text-amber-800",
  },
  REPORT_RECIPIENT: {
    label: "Report Recipient",
    badgeClass: "bg-security-navy-100 text-security-navy-700",
  },
  OTHER: {
    label: "Other",
    badgeClass: "bg-gray-100 text-gray-700",
  },
};

interface ClientContactsTabProps {
  client: ClientDetail;
  contacts: ClientContact[];
  canEdit: boolean;
  token: string;
  onRefreshContacts: () => Promise<void>;
  onError: (err: string) => void;
  onSuccess: (msg: string) => void;
}

export function ClientContactsTab({
  client,
  contacts,
  canEdit,
  token,
  onRefreshContacts,
  onError,
  onSuccess,
}: ClientContactsTabProps) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [contactType, setContactType] = useState<ClientContactType>("PRIMARY");
  const [email, setEmail] = useState("");
  const [mobile, setMobile] = useState("");
  const [isPrimary, setIsPrimary] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const openAdd = () => {
    setEditingId(null);
    setFirstName("");
    setLastName("");
    setJobTitle("");
    setDepartment("");
    setContactType(contacts.length === 0 ? "PRIMARY" : "OPERATIONS");
    setEmail("");
    setMobile("");
    setIsPrimary(contacts.length === 0);
    setNotes("");
    setShowModal(true);
  };

  const openEdit = (ct: ClientContact) => {
    setEditingId(ct.id);
    setFirstName(ct.firstName);
    setLastName(ct.lastName || "");
    setJobTitle(ct.jobTitle || "");
    setDepartment(ct.department || "");
    setContactType(ct.contactType);
    setEmail(ct.email || "");
    setMobile(ct.mobile || "");
    setIsPrimary(ct.isPrimary);
    setNotes(ct.notes || "");
    setShowModal(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !firstName.trim()) return;
    setSaving(true);
    try {
      const payload = {
        firstName: firstName.trim(),
        lastName: lastName.trim() || null,
        jobTitle: jobTitle.trim() || null,
        department: department.trim() || null,
        contactType,
        email: email.trim() || null,
        mobile: mobile.trim() || null,
        isPrimary,
        notes: notes.trim() || null,
      };

      if (editingId) {
        await updateClientContact(token, client.id, editingId, payload);
        onSuccess("Contact updated.");
      } else {
        await createClientContact(token, client.id, payload);
        onSuccess("Contact created.");
      }

      setShowModal(false);
      await onRefreshContacts();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  };

  const handleSetPrimary = async (ct: ClientContact) => {
    if (!token) return;
    try {
      await updateClientContact(token, client.id, ct.id, { isPrimary: true });
      onSuccess(`Set ${ct.firstName} as primary contact.`);
      await onRefreshContacts();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to set primary contact");
    }
  };

  const handleDelete = async (contactId: string) => {
    if (!token || !confirm("Are you sure you want to delete this contact?")) return;
    try {
      await deleteClientContact(token, client.id, contactId);
      onSuccess("Contact deleted.");
      await onRefreshContacts();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to delete contact");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-security-navy-900">
            Client Contact Directory
          </h2>
          <p className="text-xs text-security-navy-500">
            Dedicated operational, billing, emergency and governance contacts.
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={openAdd} className="btn-primary text-xs">
            + Add Contact
          </button>
        )}
      </div>

      {/* Backwards compatibility notice */}
      <div className="rounded-security border border-security-navy-100 bg-security-navy-50/70 p-3 text-xs text-security-navy-600">
        <span className="font-semibold text-security-navy-800">
          Backwards Compatibility Synchronisation:
        </span>{" "}
        The contact designated as <strong>Primary</strong> is automatically reflected on the client master record
        for month-end reporting, incident notifications, and legacy site operations.
      </div>

      {contacts.length === 0 ? (
        <div className="card-dashboard p-8 text-center text-xs text-security-navy-500">
          No structured contacts recorded for this client.
          {canEdit && (
            <div className="mt-3">
              <button type="button" onClick={openAdd} className="btn-secondary text-xs">
                Add first contact
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-security-navy-100 text-xs">
              <thead className="bg-security-navy-50">
                <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-security-navy-500">
                  <th className="px-4 py-3">Contact Name</th>
                  <th className="px-4 py-3">Role / Department</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Mobile & Phone</th>
                  <th className="px-4 py-3">Email Address</th>
                  <th className="px-4 py-3 text-center">Designation</th>
                  {canEdit && <th className="px-4 py-3 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-security-navy-100">
                {contacts.map((ct) => {
                  const typeCfg = CONTACT_TYPE_CONFIG[ct.contactType] || CONTACT_TYPE_CONFIG.OTHER;
                  return (
                    <tr
                      key={ct.id}
                      className="hover:bg-security-navy-50/50"
                    >
                      <td className="px-4 py-3 font-medium text-security-navy-900">
                        {ct.firstName} {ct.lastName || ""}
                        {ct.notes && <div className="text-[11px] text-security-navy-500">{ct.notes}</div>}
                      </td>
                      <td className="px-4 py-3 text-security-navy-600">
                        {ct.jobTitle || "—"}
                        {ct.department ? ` (${ct.department})` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${typeCfg.badgeClass}`}>
                          {typeCfg.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-security-navy-700">
                        {ct.mobile || "—"}
                      </td>
                      <td className="px-4 py-3 font-mono text-security-navy-700">
                        {ct.email || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {ct.isPrimary ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-security-amber-100 px-2 py-0.5 text-[10px] font-semibold text-security-amber-800">
                            ★ Primary
                          </span>
                        ) : canEdit ? (
                          <button
                            type="button"
                            onClick={() => handleSetPrimary(ct)}
                            className="text-[11px] text-security-navy-400 hover:text-security-amber-600 hover:underline"
                          >
                            Make Primary
                          </button>
                        ) : (
                          <span className="text-security-navy-400">—</span>
                        )}
                      </td>
                      {canEdit && (
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            type="button"
                            onClick={() => openEdit(ct)}
                            className="font-medium text-security-navy-700 hover:underline"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(ct.id)}
                            className="font-medium text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add / Edit Contact Modal */}
      <Modal
        open={showModal}
        onClose={() => !saving && setShowModal(false)}
        title={editingId ? "Edit Contact" : "Add Client Contact"}
        size="md"
      >
        <form onSubmit={handleSave} className="space-y-3 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">First Name *</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Sipho"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Last Name</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Khumalo"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">Job Title / Role</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Operations Manager"
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Department</label>
                  <input
                    className="input-modern w-full"
                    placeholder="e.g. Security & Risk"
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="label-text mb-1 block">Contact Category / Function</label>
                <select
                  className="input-modern w-full"
                  value={contactType}
                  onChange={(e) => setContactType(e.target.value as ClientContactType)}
                >
                  {Object.entries(CONTACT_TYPE_CONFIG).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="label-text mb-1 block">Email</label>
                  <input
                    type="email"
                    className="input-modern w-full"
                    placeholder="sipho@client.co.za"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label className="label-text mb-1 block">Mobile / Phone</label>
                  <input
                    className="input-modern w-full"
                    placeholder="082 123 4567"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="flex items-center gap-2 font-medium text-security-navy-800">
                  <input
                    type="checkbox"
                    checked={isPrimary}
                    onChange={(e) => setIsPrimary(e.target.checked)}
                  />
                  Designate as Primary Contact for this organisation
                </label>
              </div>

              <div>
                <label className="label-text mb-1 block">Notes / Availability</label>
                <textarea
                  rows={2}
                  className="input-modern w-full"
                  placeholder="Escalation sequence, after-hours protocols..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex justify-end gap-3 border-t border-security-navy-100 pt-4">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowModal(false)}
                  disabled={saving}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={saving || !firstName.trim()} loading={saving}>
                  {saving ? "Saving..." : "Save Contact"}
                </Button>
              </div>
        </form>
      </Modal>
    </div>
  );
}
