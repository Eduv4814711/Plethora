"use client";

export function DeleteConfirmationModal({
  open,
  title,
  message,
  confirmLabel,
  danger = true,
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-security-navy-900">{title}</h3>
        <p className="mt-2 text-sm text-base-content/70">{message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost rounded-xl" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn rounded-xl ${danger ? "btn-error" : "btn-primary"}`}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? "Working..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
