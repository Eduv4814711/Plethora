"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveAccessRequest,
  authFetch,
  cancelAccessRequest,
  createUser,
  declineAccessRequest,
  deleteUser,
  issuePasswordResetLink,
  getCapabilityCatalog,
  getEffectiveAccess,
  listAccessRequests,
  listUsers,
  transferCompanyOwnership,
  updateUser,
  type AccessChangeRequest,
  type AccountType,
  type AuthUser,
  type Capability,
  type CapabilityDefinition,
  type CapabilityMap,
  type EffectiveAccessResponse,
  type UserListItem,
} from "@/lib/api";
import { hasCapability } from "@/lib/permissions";
import { useConfirmDialog } from "@/components/ui";
import { useAuth } from "@/lib/auth-context";

type UserForm = {
  name: string;
  email: string;
  accountType: AccountType;
  jobTitle: string;
  isActive: boolean;
  capabilities: CapabilityMap;
};

const EMPTY_FORM: UserForm = {
  name: "",
  email: "",
  accountType: "staff",
  jobTitle: "",
  isActive: true,
  capabilities: {},
};

function capabilityLabel(capability: Capability): string {
  return capability.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function cloneCapabilities(value: CapabilityMap): CapabilityMap {
  return Object.fromEntries(
    Object.entries(value).map(([path, capabilities]) => [path, [...capabilities]])
  );
}

function CapabilityEditor({
  catalog,
  value,
  onChange,
  disabled = false,
  canToggle,
}: {
  catalog: CapabilityDefinition[];
  value: CapabilityMap;
  onChange: (next: CapabilityMap) => void;
  disabled?: boolean;
  canToggle?: (path: string, capability: Capability) => boolean;
}) {
  const toggle = (path: string, capability: Capability) => {
    const current = value[path] ?? [];
    const nextForPath = current.includes(capability)
      ? current.filter((item) => item !== capability)
      : [...current, capability];
    const next = { ...value };
    if (nextForPath.length) next[path] = nextForPath;
    else delete next[path];
    onChange(next);
  };

  return (
    <div className="overflow-hidden rounded-security-lg border border-security-navy-100 dark:border-security-navy-700">
      <div className="grid grid-cols-[minmax(11rem,1fr)_minmax(16rem,2fr)] bg-security-navy-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-security-navy-500 dark:bg-security-navy-900">
        <span>Module</span>
        <span>Allowed actions</span>
      </div>
      <div className="max-h-80 divide-y divide-security-navy-100 overflow-y-auto dark:divide-security-navy-700">
        {catalog.map((definition) => (
          <div
            key={definition.path}
            className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(11rem,1fr)_minmax(16rem,2fr)]"
          >
            <div>
              <p className="text-sm font-medium text-security-navy-900 dark:text-white">{definition.label}</p>
              <p className="text-xs text-security-navy-500">{definition.path}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {definition.capabilities.map((capability) => {
                const checked = value[definition.path]?.includes(capability) ?? false;
                return (
                  <label
                    key={capability}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium ${
                      checked
                        ? "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-700 dark:bg-blue-950/30 dark:text-blue-200"
                        : "border-security-navy-100 bg-white text-security-navy-600 dark:border-security-navy-700 dark:bg-security-navy-900 dark:text-security-navy-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || (canToggle ? !canToggle(definition.path, capability) : false)}
                      onChange={() => toggle(definition.path, capability)}
                      className="h-3.5 w-3.5 rounded border-security-navy-200"
                    />
                    {capabilityLabel(capability)}
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccessSummary({ user }: { user: UserListItem }) {
  if (user.isOwner) return <span>All access · owner</span>;
  const moduleCount = Object.keys(user.capabilities).length;
  const actionCount = Object.values(user.capabilities).reduce((sum, actions) => sum + actions.length, 0);
  return <span>{moduleCount} module{moduleCount === 1 ? "" : "s"} · {actionCount} allowed action{actionCount === 1 ? "" : "s"}</span>;
}

const ACCESS_ACTION_LABELS: Record<string, string> = {
  "user.create": "Account created",
  "user.access.update": "Access changed",
  "user.deactivate": "Account deactivated",
  "user.access.migrated": "Implied access made explicit",
  "user.access.request": "Change proposed",
  "user.access.request.approved": "Change approved",
  "user.access.request.declined": "Change declined",
  "user.access.request.cancelled": "Change withdrawn",
};

/** Turns a capability diff into a sentence a manager can read at a glance. */
function summariseGrants(modules: EffectiveAccessResponse["modules"]): string {
  const granted = modules.filter((module) => module.granted.length > 0);
  if (!granted.length) return "No access to any module yet.";
  const verbs: string[] = [];
  for (const module of granted) {
    if (module.granted.includes("approve")) verbs.push(`approve ${module.label}`);
    if (module.granted.includes("delete")) verbs.push(`delete in ${module.label}`);
    if (module.granted.includes("view_sensitive")) verbs.push(`see private ${module.label} data`);
    if (module.granted.includes("manage_access")) verbs.push("manage other people's access");
  }
  const viewOnly = granted.filter(
    (module) => module.granted.length === 1 && module.granted[0] === "view"
  );
  const lead = `Can open ${granted.length} module${granted.length === 1 ? "" : "s"}`;
  const powers = verbs.length ? `, and can ${verbs.slice(0, 4).join(", ")}` : "";
  const readOnly = viewOnly.length ? ` ${viewOnly.length} of them are read-only.` : "";
  return `${lead}${powers}.${readOnly}`;
}

function EffectiveAccessPanel({
  token,
  userId,
  onClose,
}: {
  token: string;
  userId: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<EffectiveAccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getEffectiveAccess(token, userId)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load access");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  const granted = data?.modules.filter((module) => module.granted.length > 0) ?? [];
  const withheld = data?.modules.filter((module) => module.granted.length === 0) ?? [];

  return (
    <div className="fixed inset-0 z-[92] flex items-end justify-center bg-security-navy-900/50 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-security-navy-900 sm:max-w-3xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white">
              Effective access{data ? ` · ${data.user.name}` : ""}
            </h2>
            <p className="text-sm text-security-navy-500">
              Exactly what this person can do, computed by the same rules the server enforces.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-security-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!data && !error && <div className="mt-5 h-40 animate-pulse rounded-security-lg bg-security-navy-50 dark:bg-security-navy-800" />}

        {data && (
          <div className="mt-5 space-y-5">
            {data.user.isOwner ? (
              <p className="rounded-security-lg border border-security-amber-200 bg-security-amber-50 p-3 text-sm text-security-amber-900">
                Company owner. Owners bypass the capability matrix entirely and can do everything in
                every module. Transfer ownership to make their access follow explicit grants.
              </p>
            ) : !data.user.isActive ? (
              <p className="rounded-security-lg border border-security-navy-100 bg-security-navy-50 p-3 text-sm text-security-navy-700 dark:border-security-navy-700 dark:bg-security-navy-800 dark:text-security-navy-200">
                This account is deactivated. It cannot sign in and holds no effective access,
                whatever the matrix below shows.
              </p>
            ) : (
              <p className="rounded-security-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                {summariseGrants(data.modules)}
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-security-navy-900 dark:text-white">
                Has access to ({granted.length})
              </h3>
              <div className="mt-2 space-y-2">
                {granted.map((module) => (
                  <div
                    key={module.path}
                    className="flex flex-col gap-1.5 rounded-lg border border-security-navy-100 px-3 py-2 dark:border-security-navy-700 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-security-navy-900 dark:text-white">{module.label}</p>
                      <p className="text-xs text-security-navy-500">{module.path}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {module.granted.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-md bg-security-emerald-50 px-2 py-0.5 text-xs font-medium text-security-emerald-700 dark:bg-security-emerald-700/40 dark:text-security-emerald-200"
                        >
                          {capabilityLabel(capability)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {granted.length === 0 && (
                  <p className="text-sm text-security-navy-500">Nothing. This person cannot open any module.</p>
                )}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-semibold text-security-navy-900 dark:text-white">
                No access to ({withheld.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {withheld.map((module) => (
                  <span
                    key={module.path}
                    className="rounded-md bg-security-navy-50 px-2 py-0.5 text-xs text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-300"
                  >
                    {module.label}
                  </span>
                ))}
              </div>
            </details>

            <div>
              <h3 className="text-sm font-semibold text-security-navy-900 dark:text-white">Access history</h3>
              <ul className="mt-2 space-y-2">
                {data.history.map((entry) => {
                  const added = (entry.metadata?.added ?? []) as { label: string; capability: Capability }[];
                  const removed = (entry.metadata?.removed ?? []) as { label: string; capability: Capability }[];
                  return (
                    <li key={entry.id} className="rounded-lg border border-security-navy-100 px-3 py-2 text-sm dark:border-security-navy-700">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-security-navy-900 dark:text-white">
                          {ACCESS_ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="text-xs text-security-navy-500">
                          {new Date(entry.timestamp).toLocaleString()}
                          {" · "}
                          {entry.user?.name ?? entry.actorLabel ?? "system"}
                        </span>
                      </div>
                      {(added.length > 0 || removed.length > 0) && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {added.map((change, index) => (
                            <span
                              key={`a${index}`}
                              className="rounded bg-security-emerald-50 px-1.5 py-0.5 text-xs text-security-emerald-700 dark:bg-security-emerald-700/40 dark:text-security-emerald-200"
                            >
                              + {change.label} · {capabilityLabel(change.capability)}
                            </span>
                          ))}
                          {removed.map((change, index) => (
                            <span
                              key={`r${index}`}
                              className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200"
                            >
                              − {change.label} · {capabilityLabel(change.capability)}
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  );
                })}
                {data.history.length === 0 && (
                  <li className="text-sm text-security-navy-500">No recorded access changes.</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const KIND_LABELS: Record<AccessChangeRequest["kind"], string> = {
  CREATE_USER: "New account",
  UPDATE_ACCESS: "Access change",
  DEACTIVATE_USER: "Deactivate account",
};

const STATUS_STYLES: Record<AccessChangeRequest["status"], string> = {
  PENDING: "bg-security-amber-100 text-security-amber-800 dark:bg-security-amber-950/40 dark:text-security-amber-200",
  APPROVED: "bg-security-emerald-100 text-security-emerald-700 dark:bg-security-emerald-700/40 dark:text-security-emerald-200",
  DECLINED: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  CANCELLED: "bg-security-navy-50 text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-300",
};

/** The +/− capability chips, matching the access-history list below. */
function GrantDiff({ diff }: { diff: AccessChangeRequest["diff"] }) {
  if (!diff.added.length && !diff.removed.length) {
    return <p className="mt-2 text-xs text-security-navy-500">No change to module access.</p>;
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {diff.added.map((change, index) => (
        <span
          key={`a${index}`}
          className="rounded bg-security-emerald-50 px-1.5 py-0.5 text-xs text-security-emerald-700 dark:bg-security-emerald-700/40 dark:text-security-emerald-200"
        >
          + {change.label} · {capabilityLabel(change.capability)}
        </span>
      ))}
      {diff.removed.map((change, index) => (
        <span
          key={`r${index}`}
          className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200"
        >
          − {change.label} · {capabilityLabel(change.capability)}
        </span>
      ))}
    </div>
  );
}

/**
 * The owner's review desk. Access managers propose changes; nothing here is in
 * force until the owner approves it, so the panel leads with the diff.
 */
function PendingAccessChanges({
  requests,
  canReview,
  busy,
  onApprove,
  onDecline,
  onCancel,
}: {
  requests: AccessChangeRequest[];
  canReview: boolean;
  busy: boolean;
  onApprove: (request: AccessChangeRequest, note: string) => void;
  onDecline: (request: AccessChangeRequest, note: string) => void;
  onCancel: (request: AccessChangeRequest) => void;
}) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  const pending = requests.filter((request) => request.status === "PENDING");
  const decided = requests.filter((request) => request.status !== "PENDING").slice(0, 5);

  if (!pending.length && !decided.length) return null;

  return (
    <section className="rounded-security-lg border border-security-amber-200 bg-security-amber-50/60 p-4 dark:border-security-amber-900/50 dark:bg-security-amber-950/20">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-security-navy-900 dark:text-white">
          Access changes awaiting approval
          {pending.length > 0 && (
            <span className="ml-2 rounded-full bg-security-amber-200 px-2 py-0.5 text-xs font-semibold text-security-amber-900">
              {pending.length}
            </span>
          )}
        </h3>
        <p className="text-xs text-security-navy-600 dark:text-security-navy-300">
          {canReview
            ? "Nothing below is in force until you approve it."
            : "Your proposals are with the company owner. They are not in force yet."}
        </p>
      </div>

      <div className="mt-3 space-y-3">
        {pending.map((request) => (
          <article
            key={request.id}
            className="rounded-lg border border-security-navy-100 bg-white p-3 dark:border-security-navy-700 dark:bg-security-navy-900"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div>
                <span className="text-sm font-semibold text-security-navy-900 dark:text-white">
                  {KIND_LABELS[request.kind]} · {request.targetLabel}
                </span>
                <p className="mt-0.5 text-xs text-security-navy-500">
                  Proposed by {request.requestedBy.name} ·{" "}
                  {new Date(request.requestedAt).toLocaleString()}
                </p>
              </div>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[request.status]}`}
              >
                Pending
              </span>
            </div>

            {request.kind === "DEACTIVATE_USER" ? (
              <p className="mt-2 text-xs text-red-700 dark:text-red-300">
                This would revoke every grant and end all active sessions.
              </p>
            ) : (
              <GrantDiff diff={request.diff} />
            )}

            {request.profileChanges.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-xs text-security-navy-600 dark:text-security-navy-300">
                {request.profileChanges.map((change) => (
                  <li key={change.field}>
                    {change.field}: {String(change.from ?? "—")} → {String(change.to ?? "—")}
                  </li>
                ))}
              </ul>
            )}

            {request.requestNote && (
              <p className="mt-2 rounded bg-security-navy-50 px-2 py-1 text-xs italic text-security-navy-600 dark:bg-security-navy-800 dark:text-security-navy-300">
                {request.requestNote}
              </p>
            )}

            {canReview ? (
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <input
                  className="input-modern flex-1 text-sm"
                  placeholder="Note for the requester (optional)"
                  value={notes[request.id] ?? ""}
                  onChange={(event) =>
                    setNotes((current) => ({ ...current, [request.id]: event.target.value }))
                  }
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busy}
                    onClick={() => onApprove(request, notes[request.id] ?? "")}
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    className="btn-destructive"
                    disabled={busy}
                    onClick={() => onDecline(request, notes[request.id] ?? "")}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={busy}
                  onClick={() => onCancel(request)}
                >
                  Withdraw
                </button>
              </div>
            )}
          </article>
        ))}
        {pending.length === 0 && (
          <p className="text-sm text-security-navy-600 dark:text-security-navy-300">
            Nothing awaiting a decision.
          </p>
        )}
      </div>

      {decided.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-semibold text-security-navy-700 dark:text-security-navy-200">
            Recently decided ({decided.length})
          </summary>
          <ul className="mt-2 space-y-1.5">
            {decided.map((request) => (
              <li
                key={request.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-security-navy-100 bg-white px-2.5 py-1.5 text-xs dark:border-security-navy-700 dark:bg-security-navy-900"
              >
                <span className="text-security-navy-700 dark:text-security-navy-200">
                  {KIND_LABELS[request.kind]} · {request.targetLabel}
                </span>
                <span className="flex items-center gap-2 text-security-navy-500">
                  {request.reviewedBy?.name ?? "—"}
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${STATUS_STYLES[request.status]}`}
                  >
                    {request.status.toLowerCase()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function CapabilityUsersSection({
  token,
  currentUser,
}: {
  token: string;
  currentUser: AuthUser;
}) {
  const { refreshUser } = useAuth();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [catalog, setCatalog] = useState<CapabilityDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addForm, setAddForm] = useState<UserForm>(EMPTY_FORM);
  const [editing, setEditing] = useState<UserListItem | null>(null);
  const [editForm, setEditForm] = useState<UserForm>(EMPTY_FORM);
  /** A one-time link (new-account invite or password reset) to hand to someone. */
  const [issuedLink, setIssuedLink] = useState<
    { title: string; message: string; url: string } | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [transferTarget, setTransferTarget] = useState<UserListItem | null>(null);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [inspecting, setInspecting] = useState<UserListItem | null>(null);
  const [exporting, setExporting] = useState(false);
  const [requests, setRequests] = useState<AccessChangeRequest[]>([]);
  const [canReview, setCanReview] = useState(false);

  // The owner applies changes directly; everyone else proposes them.
  const needsApproval = !currentUser.isOwner;

  const exportAccessReview = async () => {
    setExporting(true);
    setError(null);
    try {
      const res = await authFetch("/users/access-review?format=csv", token);
      if (!res.ok) throw new Error("Failed to export the access review");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `access-review-${new Date().toISOString().slice(0, 10)}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export the access review");
    } finally {
      setExporting(false);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userResult, permissionCatalog, requestResult] = await Promise.all([
        listUsers(token),
        getCapabilityCatalog(token),
        listAccessRequests(token),
      ]);
      setUsers(userResult.data);
      setCatalog(permissionCatalog);
      setRequests(requestResult.data);
      setCanReview(requestResult.canReview);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load access settings");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeTransferTargets = useMemo(
    () => users.filter((user) => user.isActive && !user.isOwner),
    [users]
  );
  /** Users with a proposal already queued — editing them again would 409. */
  const pendingByUserId = useMemo(
    () =>
      new Set(
        requests
          .filter((request) => request.status === "PENDING" && request.targetUserId)
          .map((request) => request.targetUserId as string)
      ),
    [requests]
  );
  const canCreateUsers =
    hasCapability(currentUser, "/settings/access", "create") &&
    hasCapability(currentUser, "/settings/access", "manage_access");
  const canEditUsers =
    hasCapability(currentUser, "/settings/access", "edit") &&
    hasCapability(currentUser, "/settings/access", "manage_access");
  const canDeleteUsers =
    hasCapability(currentUser, "/settings/access", "delete") &&
    hasCapability(currentUser, "/settings/access", "manage_access");
  const canDelegateCapability = (path: string, capability: Capability) =>
    currentUser.isOwner ||
    (
      capability !== "manage_access" &&
      hasCapability(currentUser, path, capability)
    );
  const canManageTarget = (target: UserListItem) =>
    currentUser.isOwner ||
    (
      target.id !== currentUser.id &&
      !hasCapability(target, "/settings/access", "manage_access")
    );

  const startEditing = (user: UserListItem) => {
    setEditing(user);
    setEditForm({
      name: user.name,
      email: user.email,
      accountType: user.accountType,
      jobTitle: user.jobTitle ?? "",
      isActive: user.isActive,
      capabilities: cloneCapabilities(user.capabilities),
    });
    setError(null);
    setNotice(null);
  };

  const submitNewUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createUser(token, {
        name: addForm.name,
        email: addForm.email,
        accountType: addForm.accountType,
        jobTitle: addForm.jobTitle || null,
        isActive: addForm.isActive,
        capabilities: addForm.capabilities,
        sendSetupLink: true,
      });
      setAddForm(EMPTY_FORM);
      setAdding(false);
      if (result.pending) {
        setRequests((current) => [result.request, ...current]);
        setNotice(
          "Sent to the company owner for approval. The account is not created until they approve it."
        );
        return;
      }
      setUsers((current) => [result.user, ...current]);
      setIssuedLink(
        result.user.setupLink
          ? {
              title: "Password setup link",
              message: `Send this to ${result.user.email}. It expires in 24 hours.`,
              url: result.user.setupLink,
            }
          : null
      );
      setNotice("User created. Their assigned access applies as soon as they sign in.");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to create user");
    } finally {
      setBusy(false);
    }
  };

  const saveUser = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await updateUser(token, editing.id, {
        name: editForm.name,
        email: editForm.email,
        accountType: editForm.accountType,
        jobTitle: editForm.jobTitle || null,
        isActive: editForm.isActive,
        capabilities: editForm.capabilities,
      });
      setEditing(null);
      if (result.pending) {
        setRequests((current) => [result.request, ...current]);
        setNotice(
          "Sent to the company owner for approval. Nothing changes until they approve it."
        );
        return;
      }
      setUsers((current) =>
        current.map((user) => (user.id === result.user.id ? result.user : user))
      );
      if (result.user.id === currentUser.id) await refreshUser();
      setNotice("Access updated. The change is effective immediately.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update user");
    } finally {
      setBusy(false);
    }
  };

  const deactivateUserAccount = async (user: UserListItem) => {
    if (user.id === currentUser.id || user.isOwner) return;
    const accepted = await confirm({
      title: needsApproval ? "Request deactivation?" : "Deactivate user account?",
      message: needsApproval
        ? `${user.name} keeps their access until the company owner approves this. Their historical company records will be retained either way.`
        : `${user.name} will no longer be able to sign in. Their historical company records will be retained.`,
      confirmLabel: needsApproval ? "Send for approval" : "Deactivate user",
      danger: true,
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      const result = await deleteUser(token, user.id);
      if (result.pending && result.request) {
        setRequests((current) => [result.request!, ...current]);
        setNotice("Sent to the company owner for approval. This account is still active.");
        return;
      }
      setUsers((current) =>
        current.map((candidate) =>
          candidate.id === user.id
            ? { ...candidate, isActive: false, capabilities: {} }
            : candidate
        )
      );
      setNotice("User deactivated and active sessions revoked.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to deactivate user");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Issues a link the person uses to set their own password. Their current
   * password keeps working until they use it, so nobody is locked out — but any
   * link issued earlier stops working, which is worth confirming first.
   */
  const sendPasswordResetLink = async (user: UserListItem) => {
    const accepted = await confirm({
      title: "Create a password reset link?",
      message: `${user.name} can use the link to set a new password. Their current password keeps working until they do. Any reset link issued to them earlier will stop working.`,
      confirmLabel: "Create link",
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await issuePasswordResetLink(token, user.id);
      setIssuedLink({
        title: "Password reset link",
        message: `Send this to ${result.email}. It expires ${new Date(result.expiresAt).toLocaleString()} and can be used once.`,
        url: result.setupLink,
      });
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "Failed to create a password reset link"
      );
    } finally {
      setBusy(false);
    }
  };

  /**
   * Approving is the only place a proposal is applied, so it always reloads:
   * the target's grants, the request list and possibly the signed-in user's own
   * access all move at once.
   */
  const reviewRequest = async (
    request: AccessChangeRequest,
    decision: "approve" | "decline" | "cancel",
    note: string
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (decision === "approve") {
        let result;
        try {
          result = await approveAccessRequest(token, request.id, { reviewNote: note || undefined });
        } catch (approveError) {
          // The target moved on since the request was raised — make the owner
          // confirm rather than silently re-granting revoked access.
          if ((approveError as { code?: string }).code !== "stale") throw approveError;
          const accepted = await confirm({
            title: "Access changed since this was requested",
            message: `${request.targetLabel} was edited after ${request.requestedBy.name} raised this. Applying it now will overwrite the current grants with what was proposed.`,
            confirmLabel: "Apply anyway",
            danger: true,
          });
          if (!accepted) return;
          result = await approveAccessRequest(token, request.id, {
            reviewNote: note || undefined,
            acknowledgeDrift: true,
          });
        }
        if (result.setupLink) {
          setIssuedLink({
            title: "Password setup link",
            message: `Send this to ${request.targetLabel}. It expires in 24 hours.`,
            url: result.setupLink,
          });
        }
        setNotice("Approved. The change is now in force.");
        if (request.targetUserId === currentUser.id) await refreshUser();
      } else if (decision === "decline") {
        await declineAccessRequest(token, request.id, note || undefined);
        setNotice("Declined. Nothing changed.");
      } else {
        await cancelAccessRequest(token, request.id);
        setNotice("Request withdrawn.");
      }
      await load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Failed to review the request");
    } finally {
      setBusy(false);
    }
  };

  const transferOwner = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!transferTarget) return;
    setBusy(true);
    setError(null);
    try {
      await transferCompanyOwnership(token, transferTarget.id, ownerPassword);
      setUsers((current) =>
        current.map((user) => ({
          ...user,
          isOwner: user.id === transferTarget.id,
        }))
      );
      setTransferTarget(null);
      setOwnerPassword("");
      await refreshUser();
      setNotice("Ownership transferred. Your access now follows your explicit capabilities.");
    } catch (transferError) {
      setError(transferError instanceof Error ? transferError.message : "Failed to transfer ownership");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="h-40 animate-pulse rounded-security-lg bg-security-navy-50 dark:bg-security-navy-800" />;

  return (
    <section className="space-y-5">
      {confirmDialog}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-security-navy-900 dark:text-white">User access</h2>
          <p className="mt-1 max-w-3xl text-sm text-security-navy-500">
            Access is granted per module action. Job titles and account types never grant permissions.
            {needsApproval
              ? " Your changes go to the company owner for approval before they take effect."
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" disabled={exporting} onClick={() => void exportAccessReview()}>
            {exporting ? "Preparing…" : "Export access review"}
          </button>
          {canCreateUsers && (
            <button type="button" className="btn-primary" onClick={() => setAdding((value) => !value)}>
              {adding ? "Cancel" : "Add user"}
            </button>
          )}
        </div>
      </div>

      {error && <div role="alert" className="rounded-security-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-security-lg border border-security-emerald-200 bg-security-emerald-50 p-3 text-sm text-security-emerald-700">{notice}</div>}
      {issuedLink && (
        <div className="rounded-security-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-semibold">{issuedLink.title}</p>
              <p className="mt-0.5 text-xs text-blue-800">{issuedLink.message}</p>
            </div>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setIssuedLink(null)}
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 break-all font-mono text-xs">{issuedLink.url}</p>
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => {
              void navigator.clipboard.writeText(issuedLink.url);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      )}

      <PendingAccessChanges
        requests={requests}
        canReview={canReview}
        busy={busy}
        onApprove={(request, note) => void reviewRequest(request, "approve", note)}
        onDecline={(request, note) => void reviewRequest(request, "decline", note)}
        onCancel={(request) => void reviewRequest(request, "cancel", "")}
      />

      {adding && canCreateUsers && (
        <form onSubmit={submitNewUser} className="space-y-4 rounded-security-lg border border-security-navy-100 p-4 dark:border-security-navy-700">
          <h3 className="font-semibold text-security-navy-900 dark:text-white">{needsApproval ? "Propose a new user" : "New user"}</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Name<input required className="input-modern mt-1 w-full" value={addForm.name} onChange={(event) => setAddForm((form) => ({ ...form, name: event.target.value }))} /></label>
            <label className="text-sm font-medium">Email<input required type="email" className="input-modern mt-1 w-full" value={addForm.email} onChange={(event) => setAddForm((form) => ({ ...form, email: event.target.value }))} /></label>
            <label className="text-sm font-medium">Account type<select className="input-modern mt-1 w-full" value={addForm.accountType} onChange={(event) => setAddForm((form) => ({ ...form, accountType: event.target.value as AccountType }))}><option value="staff">Staff</option><option value="client">Client</option></select></label>
            <label className="text-sm font-medium">Job title<input className="input-modern mt-1 w-full" value={addForm.jobTitle} onChange={(event) => setAddForm((form) => ({ ...form, jobTitle: event.target.value }))} placeholder="Descriptive only" /></label>
          </div>
          <CapabilityEditor
            catalog={catalog}
            value={addForm.capabilities}
            onChange={(capabilities) => setAddForm((form) => ({ ...form, capabilities }))}
            canToggle={canDelegateCapability}
          />
          <div className="flex justify-end"><button disabled={busy} className="btn-primary">{busy ? "Creating…" : needsApproval ? "Submit for approval" : "Create and generate setup link"}</button></div>
        </form>
      )}

      <div className="space-y-3">
        {users.map((user) => (
          <article key={user.id} className="rounded-security-lg border border-security-navy-100 p-4 dark:border-security-navy-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-security-navy-900 dark:text-white">{user.name}</h3>
                  {user.isOwner && <span className="rounded-full bg-security-amber-100 px-2 py-0.5 text-xs font-semibold text-security-amber-800">Owner</span>}
                  {!user.isActive && <span className="rounded-full bg-security-navy-50 px-2 py-0.5 text-xs font-semibold text-security-navy-600">Inactive</span>}
                  {pendingByUserId.has(user.id) && (
                    <span className="rounded-full bg-security-amber-100 px-2 py-0.5 text-xs font-semibold text-security-amber-800">
                      Change pending approval
                    </span>
                  )}
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{user.accountType}</span>
                </div>
                <p className="mt-1 text-sm text-security-navy-500">{user.email}{user.jobTitle ? ` · ${user.jobTitle}` : ""}</p>
                <p className="mt-1 text-xs text-security-navy-500"><AccessSummary user={user} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => setInspecting(user)}>
                  View access
                </button>
                {canEditUsers && canManageTarget(user) && (
                  <button type="button" className="btn-secondary" disabled={pendingByUserId.has(user.id)} onClick={() => startEditing(user)}>Edit access</button>
                )}
                {canEditUsers && canManageTarget(user) && user.isActive && (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void sendPasswordResetLink(user)}
                  >
                    Reset password
                  </button>
                )}
                {currentUser.isOwner && !user.isOwner && user.isActive && (
                  <button type="button" className="btn-secondary" onClick={() => setTransferTarget(user)}>Make owner</button>
                )}
                {canDeleteUsers && canManageTarget(user) && !user.isOwner && user.id !== currentUser.id && (
                  <button type="button" className="btn-destructive" disabled={busy || !user.isActive || pendingByUserId.has(user.id)} onClick={() => void deactivateUserAccount(user)}>{needsApproval ? "Request deactivation" : "Deactivate"}</button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {editing && canEditUsers && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-security-navy-900/50 sm:items-center sm:p-4">
          <form onSubmit={saveUser} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-security-navy-900 sm:max-w-4xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Edit {editing.name}</h2><p className="text-sm text-security-navy-500">{editing.isOwner ? "The owner has full access now; these assignments take effect if ownership is transferred." : needsApproval ? "Changes are sent to the company owner for approval before they take effect." : "Changes apply immediately."}</p></div>
              <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Close</button>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="text-sm font-medium">Name<input required className="input-modern mt-1 w-full" value={editForm.name} onChange={(event) => setEditForm((form) => ({ ...form, name: event.target.value }))} /></label>
              <label className="text-sm font-medium">Email<input required type="email" className="input-modern mt-1 w-full" value={editForm.email} onChange={(event) => setEditForm((form) => ({ ...form, email: event.target.value }))} /></label>
              <label className="text-sm font-medium">Account type<select className="input-modern mt-1 w-full" value={editForm.accountType} onChange={(event) => setEditForm((form) => ({ ...form, accountType: event.target.value as AccountType }))}><option value="staff">Staff</option><option value="client">Client</option></select></label>
              <label className="text-sm font-medium">Job title<input className="input-modern mt-1 w-full" value={editForm.jobTitle} onChange={(event) => setEditForm((form) => ({ ...form, jobTitle: event.target.value }))} /></label>
            </div>
            <label className="mt-4 inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={editForm.isActive} disabled={editing.isOwner} onChange={(event) => setEditForm((form) => ({ ...form, isActive: event.target.checked }))} />Active account</label>
            <div className="mt-5">
              <CapabilityEditor
                catalog={catalog}
                value={editForm.capabilities}
                onChange={(capabilities) => setEditForm((form) => ({ ...form, capabilities }))}
                canToggle={canDelegateCapability}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button disabled={busy} className="btn-primary">{busy ? "Saving…" : needsApproval ? "Submit for approval" : "Save changes"}</button></div>
          </form>
        </div>
      )}

      {inspecting && (
        <EffectiveAccessPanel
          token={token}
          userId={inspecting.id}
          onClose={() => setInspecting(null)}
        />
      )}

      {transferTarget && (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-security-navy-900/50 sm:items-center sm:p-4">
          <form onSubmit={transferOwner} className="w-full rounded-t-2xl bg-white p-5 shadow-xl dark:bg-security-navy-900 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-semibold">Transfer company ownership</h2>
            <p className="mt-2 text-sm text-security-navy-500">After transfer, {transferTarget.name} receives the owner bypass and your account follows its explicit capabilities.</p>
            <label className="mt-4 block text-sm font-medium">Your current password<input required type="password" autoComplete="current-password" className="input-modern mt-1 w-full" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setTransferTarget(null)}>Cancel</button><button disabled={busy} className="btn-primary">{busy ? "Transferring…" : "Transfer ownership"}</button></div>
          </form>
        </div>
      )}

      {currentUser.isOwner && activeTransferTargets.length === 0 && (
        <p className="text-xs text-security-navy-500">Create another active user before ownership can be transferred.</p>
      )}
    </section>
  );
}
