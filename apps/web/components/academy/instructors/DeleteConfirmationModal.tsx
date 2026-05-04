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
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4 sm:p-6">
      <div className="w-full max-w-md card-elevated p-5 sm:p-6">
        <h3 className="section-title normal-case tracking-tight text-lg">{title}</h3>
        <p className="mt-2 text-sm text-black">{message}</p>
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-ghost min-h-11 rounded-security-lg" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn-danger min-h-11 px-4" : "btn-primary min-h-11"}
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
