"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  authFetch,
  createUser,
  deleteUser,
  getCapabilityCatalog,
  getEffectiveAccess,
  listUsers,
  transferCompanyOwnership,
  updateUser,
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
    <div className="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-700">
      <div className="grid grid-cols-[minmax(11rem,1fr)_minmax(16rem,2fr)] bg-neutral-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:bg-neutral-900">
        <span>Module</span>
        <span>Allowed actions</span>
      </div>
      <div className="max-h-80 divide-y divide-neutral-200 overflow-y-auto dark:divide-neutral-700">
        {catalog.map((definition) => (
          <div
            key={definition.path}
            className="grid gap-2 px-3 py-3 sm:grid-cols-[minmax(11rem,1fr)_minmax(16rem,2fr)]"
          >
            <div>
              <p className="text-sm font-medium text-neutral-900 dark:text-white">{definition.label}</p>
              <p className="text-xs text-neutral-500">{definition.path}</p>
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
                        : "border-neutral-200 bg-white text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled || (canToggle ? !canToggle(definition.path, capability) : false)}
                      onChange={() => toggle(definition.path, capability)}
                      className="h-3.5 w-3.5 rounded border-neutral-300"
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
    <div className="fixed inset-0 z-[92] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
      <div className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-neutral-900 sm:max-w-3xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
              Effective access{data ? ` · ${data.user.name}` : ""}
            </h2>
            <p className="text-sm text-neutral-500">
              Exactly what this person can do, computed by the same rules the server enforces.
            </p>
          </div>
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>

        {error && (
          <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
        {!data && !error && <div className="mt-5 h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />}

        {data && (
          <div className="mt-5 space-y-5">
            {data.user.isOwner ? (
              <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                Company owner. Owners bypass the capability matrix entirely and can do everything in
                every module. Transfer ownership to make their access follow explicit grants.
              </p>
            ) : !data.user.isActive ? (
              <p className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
                This account is deactivated. It cannot sign in and holds no effective access,
                whatever the matrix below shows.
              </p>
            ) : (
              <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                {summariseGrants(data.modules)}
              </p>
            )}

            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
                Has access to ({granted.length})
              </h3>
              <div className="mt-2 space-y-2">
                {granted.map((module) => (
                  <div
                    key={module.path}
                    className="flex flex-col gap-1.5 rounded-lg border border-neutral-200 px-3 py-2 dark:border-neutral-700 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="text-sm font-medium text-neutral-900 dark:text-white">{module.label}</p>
                      <p className="text-xs text-neutral-500">{module.path}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {module.granted.map((capability) => (
                        <span
                          key={capability}
                          className="rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
                        >
                          {capabilityLabel(capability)}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
                {granted.length === 0 && (
                  <p className="text-sm text-neutral-500">Nothing. This person cannot open any module.</p>
                )}
              </div>
            </div>

            <details>
              <summary className="cursor-pointer text-sm font-semibold text-neutral-900 dark:text-white">
                No access to ({withheld.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {withheld.map((module) => (
                  <span
                    key={module.path}
                    className="rounded-md bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                  >
                    {module.label}
                  </span>
                ))}
              </div>
            </details>

            <div>
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">Access history</h3>
              <ul className="mt-2 space-y-2">
                {data.history.map((entry) => {
                  const added = (entry.metadata?.added ?? []) as { label: string; capability: Capability }[];
                  const removed = (entry.metadata?.removed ?? []) as { label: string; capability: Capability }[];
                  return (
                    <li key={entry.id} className="rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-700">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium text-neutral-900 dark:text-white">
                          {ACCESS_ACTION_LABELS[entry.action] ?? entry.action}
                        </span>
                        <span className="text-xs text-neutral-500">
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
                              className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
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
                  <li className="text-sm text-neutral-500">No recorded access changes.</li>
                )}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
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
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [transferTarget, setTransferTarget] = useState<UserListItem | null>(null);
  const [ownerPassword, setOwnerPassword] = useState("");
  const [inspecting, setInspecting] = useState<UserListItem | null>(null);
  const [exporting, setExporting] = useState(false);

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
      const [userResult, permissionCatalog] = await Promise.all([
        listUsers(token),
        getCapabilityCatalog(token),
      ]);
      setUsers(userResult.data);
      setCatalog(permissionCatalog);
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
      const created = await createUser(token, {
        name: addForm.name,
        email: addForm.email,
        accountType: addForm.accountType,
        jobTitle: addForm.jobTitle || null,
        isActive: addForm.isActive,
        capabilities: addForm.capabilities,
        sendSetupLink: true,
      });
      setUsers((current) => [created, ...current]);
      setSetupLink(created.setupLink ?? null);
      setAddForm(EMPTY_FORM);
      setAdding(false);
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
      const updated = await updateUser(token, editing.id, {
        name: editForm.name,
        email: editForm.email,
        accountType: editForm.accountType,
        jobTitle: editForm.jobTitle || null,
        isActive: editForm.isActive,
        capabilities: editForm.capabilities,
      });
      setUsers((current) => current.map((user) => (user.id === updated.id ? updated : user)));
      setEditing(null);
      if (updated.id === currentUser.id) await refreshUser();
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
      title: "Deactivate user account?",
      message: `${user.name} will no longer be able to sign in. Their historical company records will be retained.`,
      confirmLabel: "Deactivate user",
      danger: true,
    });
    if (!accepted) return;
    setBusy(true);
    setError(null);
    try {
      await deleteUser(token, user.id);
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

  if (loading) return <div className="h-40 animate-pulse rounded-xl bg-neutral-100 dark:bg-neutral-800" />;

  return (
    <section className="space-y-5">
      {confirmDialog}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-neutral-900 dark:text-white">User access</h2>
          <p className="mt-1 max-w-3xl text-sm text-neutral-500">
            Access is granted per module action. Job titles and account types never grant permissions.
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

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{notice}</div>}
      {setupLink && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
          <p className="font-semibold">Password setup link</p>
          <p className="mt-1 break-all">{setupLink}</p>
          <button
            type="button"
            className="btn-secondary mt-3"
            onClick={() => void navigator.clipboard.writeText(setupLink)}
          >
            Copy link
          </button>
        </div>
      )}

      {adding && canCreateUsers && (
        <form onSubmit={submitNewUser} className="space-y-4 rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
          <h3 className="font-semibold text-neutral-900 dark:text-white">New user</h3>
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
          <div className="flex justify-end"><button disabled={busy} className="btn-primary">{busy ? "Creating…" : "Create and generate setup link"}</button></div>
        </form>
      )}

      <div className="space-y-3">
        {users.map((user) => (
          <article key={user.id} className="rounded-xl border border-neutral-200 p-4 dark:border-neutral-700">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-neutral-900 dark:text-white">{user.name}</h3>
                  {user.isOwner && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">Owner</span>}
                  {!user.isActive && <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-semibold text-neutral-600">Inactive</span>}
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{user.accountType}</span>
                </div>
                <p className="mt-1 text-sm text-neutral-500">{user.email}{user.jobTitle ? ` · ${user.jobTitle}` : ""}</p>
                <p className="mt-1 text-xs text-neutral-500"><AccessSummary user={user} /></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => setInspecting(user)}>
                  View access
                </button>
                {canEditUsers && canManageTarget(user) && (
                  <button type="button" className="btn-secondary" onClick={() => startEditing(user)}>Edit access</button>
                )}
                {currentUser.isOwner && !user.isOwner && user.isActive && (
                  <button type="button" className="btn-secondary" onClick={() => setTransferTarget(user)}>Make owner</button>
                )}
                {canDeleteUsers && canManageTarget(user) && !user.isOwner && user.id !== currentUser.id && (
                  <button type="button" className="btn-destructive" disabled={busy || !user.isActive} onClick={() => void deactivateUserAccount(user)}>Deactivate</button>
                )}
              </div>
            </div>
          </article>
        ))}
      </div>

      {editing && canEditUsers && (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
          <form onSubmit={saveUser} className="max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl dark:bg-neutral-900 sm:max-w-4xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div><h2 className="text-lg font-semibold">Edit {editing.name}</h2><p className="text-sm text-neutral-500">{editing.isOwner ? "The owner has full access now; these assignments take effect if ownership is transferred." : "Changes apply immediately."}</p></div>
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
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button><button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save changes"}</button></div>
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
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-slate-900/50 sm:items-center sm:p-4">
          <form onSubmit={transferOwner} className="w-full rounded-t-2xl bg-white p-5 shadow-xl dark:bg-neutral-900 sm:max-w-md sm:rounded-2xl">
            <h2 className="text-lg font-semibold">Transfer company ownership</h2>
            <p className="mt-2 text-sm text-neutral-500">After transfer, {transferTarget.name} receives the owner bypass and your account follows its explicit capabilities.</p>
            <label className="mt-4 block text-sm font-medium">Your current password<input required type="password" autoComplete="current-password" className="input-modern mt-1 w-full" value={ownerPassword} onChange={(event) => setOwnerPassword(event.target.value)} /></label>
            <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setTransferTarget(null)}>Cancel</button><button disabled={busy} className="btn-primary">{busy ? "Transferring…" : "Transfer ownership"}</button></div>
          </form>
        </div>
      )}

      {currentUser.isOwner && activeTransferTargets.length === 0 && (
        <p className="text-xs text-neutral-500">Create another active user before ownership can be transferred.</p>
      )}
    </section>
  );
}
