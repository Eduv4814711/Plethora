"use client";

import { cloneElement, useCallback, useEffect, useId, useState } from "react";
import { clsx } from "clsx";

type ButtonVariant = "primary" | "secondary" | "ghost" | "amber" | "destructive";
type ButtonSize = "sm" | "md";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  amber: "btn-amber",
  destructive: "btn-destructive",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  disabled,
  children,
  type = "button",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button
      type={type}
      className={clsx(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap",
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? "Working..." : children}
    </button>
  );
}

type FieldDensity = "default" | "compact";

function fieldClass(density: FieldDensity, className?: string) {
  return clsx(density === "compact" ? "input-compact" : "input-modern", className);
}

export function Input({
  density = "default",
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { density?: FieldDensity }) {
  return <input className={fieldClass(density, className)} {...props} />;
}

export function Select({
  density = "default",
  className,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { density?: FieldDensity }) {
  return (
    <select className={fieldClass(density, className)} {...props}>
      {children}
    </select>
  );
}

export function Textarea({
  density = "default",
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { density?: FieldDensity }) {
  return <textarea className={fieldClass(density, className)} {...props} />;
}

export function Field({
  label,
  helperText,
  error,
  children,
  id,
  className,
}: {
  label: string;
  helperText?: string;
  error?: string;
  children: React.ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  id?: string;
  className?: string;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const helpId = `${controlId}-help`;
  const errorId = `${controlId}-error`;
  const describedBy = error ? errorId : helperText ? helpId : undefined;

  return (
    <div className={clsx("space-y-1.5", className)}>
      <label htmlFor={controlId} className="label-text">
        {label}
      </label>
      {cloneElement(children, {
        id: children.props.id ?? controlId,
        "aria-describedby": children.props["aria-describedby"] ?? describedBy,
        "aria-invalid": children.props["aria-invalid"] ?? (Boolean(error) || undefined),
      })}
      {helperText && !error ? (
        <p id={helpId} className="text-xs text-neutral-600">
          {helperText}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type CardVariant = "dashboard" | "wireframe" | "elevated";

const cardVariants: Record<CardVariant, string> = {
  dashboard: "card-dashboard",
  wireframe: "card-wireframe",
  elevated: "card-elevated",
};

export function Card({
  variant = "dashboard",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: CardVariant }) {
  return <div className={clsx(cardVariants[variant], className)} {...props} />;
}

type BadgeVariant = "neutral" | "success" | "warning" | "error";

const badgeVariants: Record<BadgeVariant, string> = {
  neutral: "badge-neutral",
  success: "badge-success",
  warning: "badge-warning",
  error: "badge-error",
};

export function Badge({
  variant = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: BadgeVariant }) {
  return <span className={clsx(badgeVariants[variant], className)} {...props} />;
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  eyebrow?: string;
  className?: string;
}) {
  return (
    <header className={clsx("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="section-title mb-2">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? <p className="mt-2 max-w-3xl text-sm text-neutral-600">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
    </header>
  );
}

export function EmptyState({
  title,
  description,
  action,
  secondaryAction,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card variant="wireframe" className={clsx("mx-auto w-full max-w-lg p-6 text-center", className)}>
      <div
        className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-security-lg border border-security-navy-100 bg-security-navy-50 text-security-navy-700"
        aria-hidden="true"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-11z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h5" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-black">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-neutral-600">{description}</p>
      {(action || secondaryAction) ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </Card>
  );
}

type AlertVariant = "error" | "success" | "info" | "warning";

const alertVariants: Record<AlertVariant, string> = {
  error: "border-red-200 bg-red-50 text-red-800",
  success: "border-security-emerald-200 bg-security-emerald-50 text-security-emerald-600",
  info: "border-neutral-200 bg-white text-neutral-700",
  warning: "border-security-amber-200 bg-security-amber-100 text-security-amber-700",
};

export function AlertBanner({
  variant = "info",
  title,
  children,
  className,
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: AlertVariant;
  title?: string;
}) {
  const isError = variant === "error";
  return (
    <div
      className={clsx("rounded-security border px-4 py-3 text-sm", alertVariants[variant], className)}
      role={isError ? "alert" : "status"}
    >
      {title ? <p className="mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = true,
  loading = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !loading) onCancel();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [loading, onCancel, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/45 p-4" role="presentation">
      <div
        className="w-full max-w-md rounded-security-lg border border-neutral-200 bg-white p-6 shadow-security-elevated"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h2 id="confirm-modal-title" className="text-lg font-semibold text-black">
          {title}
        </h2>
        <p className="mt-2 whitespace-pre-line text-sm text-neutral-600">{message}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? "destructive" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PendingConfirm = Required<ConfirmOptions> & {
  resolve: (confirmed: boolean) => void;
};

export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Confirm",
        cancelLabel: options.cancelLabel ?? "Cancel",
        danger: options.danger ?? true,
        resolve,
      });
    });
  }, []);

  const close = useCallback(
    (confirmed: boolean) => {
      pending?.resolve(confirmed);
      setPending(null);
    },
    [pending]
  );

  const confirmDialog = (
    <ConfirmModal
      open={Boolean(pending)}
      title={pending?.title ?? ""}
      message={pending?.message ?? ""}
      confirmLabel={pending?.confirmLabel ?? "Confirm"}
      cancelLabel={pending?.cancelLabel ?? "Cancel"}
      danger={pending?.danger ?? true}
      onCancel={() => close(false)}
      onConfirm={() => close(true)}
    />
  );

  return { confirm, confirmDialog };
}

export function TableShell({
  children,
  title,
  className,
  tableClassName,
}: {
  children: React.ReactNode;
  title?: string;
  className?: string;
  tableClassName?: string;
}) {
  return (
    <div className={clsx("overflow-hidden rounded-security-lg border border-neutral-200 bg-white shadow-security-card", className)}>
      <div className="overflow-x-auto">
        <table className={clsx("min-w-full divide-y divide-neutral-200 text-sm", tableClassName)} aria-label={title}>
          {title ? <caption className="sr-only">{title}</caption> : null}
          {children}
        </table>
      </div>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return <div className={clsx("animate-pulse rounded-security bg-neutral-200/80", className)} aria-hidden="true" />;
}

export function TableLoadingRow({ colSpan, label = "Loading records..." }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm text-neutral-600">
        {label}
      </td>
    </tr>
  );
}

export function TableEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-10 text-center text-sm text-neutral-600">
        {message}
      </td>
    </tr>
  );
}
