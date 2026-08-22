"use client";

import { cloneElement, useCallback, useEffect, useId, useState } from "react";
import { clsx } from "clsx";

/**
 * `signal` is the orange one. It is for the single action on a screen that is
 * the point of the screen — dispatch, approve, confirm — never for Save on a
 * settings form. `amber` is kept as its older name so existing callers keep
 * working.
 */
type ButtonVariant = "primary" | "secondary" | "ghost" | "amber" | "signal" | "destructive";
type ButtonSize = "sm" | "md" | "lg";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  secondary: "btn-secondary",
  ghost: "btn-ghost",
  amber: "btn-amber",
  signal: "btn-amber",
  destructive: "btn-destructive",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "px-3 py-2 text-xs",
  md: "",
  lg: "px-5 py-3 text-[0.9375rem]",
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
      {/* The label stays put while the work happens. Swapping it for
          "Working..." moved the button under the pointer and lost the one piece
          of information the person needed: what they just asked for. */}
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx("h-3.5 w-3.5 shrink-0 animate-spin", className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
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
        <p id={helpId} className="text-xs text-security-navy-600">
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
    <header
      className={clsx(
        "flex flex-col gap-4 border-b border-security-navy-100 pb-5 sm:flex-row sm:items-end sm:justify-between",
        className
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h1 className="page-title">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-security-navy-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
    </header>
  );
}

/**
 * A filter/search strip that sits above a table. Sunken rather than raised, so
 * the controls read as belonging to the table below them instead of competing
 * with it.
 */
export function Toolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        "flex flex-wrap items-end gap-3 rounded-security-lg border border-security-navy-100 bg-security-navy-50/70 px-4 py-3",
        className
      )}
    >
      {children}
    </div>
  );
}

type SpineTone = "live" | "good" | "warn" | "bad" | "idle";

const spineTones: Record<SpineTone, string> = {
  live: "spine-live",
  good: "spine-good",
  warn: "spine-warn",
  bad: "spine-bad",
  idle: "spine-idle",
};

/**
 * A single figure with the status spine on its edge. The number is the loudest
 * thing in the tile; the label and the delta stay quiet underneath it.
 */
export function StatCard({
  label,
  value,
  hint,
  tone = "idle",
  className,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: SpineTone;
  className?: string;
}) {
  return (
    <div className={clsx("card-dashboard spine px-5 py-4", spineTones[tone], className)}>
      <p className="section-title">{label}</p>
      <p className="metric mt-2">{value}</p>
      {hint ? <p className="mt-1 text-xs text-security-navy-500">{hint}</p> : null}
    </div>
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
    <div
      className={clsx(
        "mx-auto w-full max-w-lg rounded-security-lg border border-dashed border-security-navy-200 bg-white/60 px-6 py-10 text-center",
        className
      )}
    >
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-security-lg bg-security-amber-50 text-security-amber-700"
        aria-hidden="true"
      >
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6.5A2.5 2.5 0 016.5 4h11A2.5 2.5 0 0120 6.5v11a2.5 2.5 0 01-2.5 2.5h-11A2.5 2.5 0 014 17.5v-11z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9h8M8 13h5" />
        </svg>
      </div>
      <h2 className="text-base font-semibold text-security-navy-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-security-navy-500">{description}</p>
      {action || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

type AlertVariant = "error" | "success" | "info" | "warning";

const alertVariants: Record<AlertVariant, string> = {
  error: "spine-bad bg-red-50 text-red-900",
  success: "spine-good bg-security-emerald-50 text-security-emerald-700",
  info: "spine-idle bg-security-navy-50 text-security-navy-700",
  warning: "spine-live bg-security-amber-50 text-security-amber-800",
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
      className={clsx("spine rounded-security py-3 pl-5 pr-4 text-sm", alertVariants[variant], className)}
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
    <div
      className="fixed inset-0 z-[90] flex animate-fade-in items-center justify-center bg-security-navy-900/50 p-4 backdrop-blur-[3px]"
      role="presentation"
    >
      <div
        className="w-full max-w-md animate-slide-up rounded-security-lg border border-security-navy-100 bg-white p-6 shadow-security-elevated motion-reduce:animate-none"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
      >
        <h2 id="confirm-modal-title" className="text-lg font-semibold text-security-navy-900">
          {title}
        </h2>
        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-security-navy-500">{message}</p>
        <div className="mt-6 flex flex-wrap justify-end gap-2">
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
    <div
      className={clsx(
        "overflow-hidden rounded-security-lg border border-security-navy-100 bg-white shadow-security-card",
        className
      )}
    >
      <div className="overflow-x-auto">
        {/* Header cells get the mono label treatment and stick to the top of the
            scroll container, so you never lose the column you are reading down. */}
        <table
          className={clsx(
            "min-w-full divide-y divide-security-navy-100 text-sm",
            "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-security-navy-50 [&_thead_th]:font-mono [&_thead_th]:text-[0.6875rem] [&_thead_th]:font-medium [&_thead_th]:uppercase [&_thead_th]:tracking-[0.12em] [&_thead_th]:text-security-navy-500",
            "[&_tbody_tr]:transition-colors [&_tbody_tr:hover]:bg-security-amber-50/40",
            tableClassName
          )}
          aria-label={title}
        >
          {title ? <caption className="sr-only">{title}</caption> : null}
          {children}
        </table>
      </div>
    </div>
  );
}

export function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      className={clsx("animate-pulse rounded-security bg-security-navy-100", className)}
      aria-hidden="true"
    />
  );
}

export function TableLoadingRow({ colSpan, label = "Loading records..." }: { colSpan: number; label?: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-sm text-security-navy-500">
        <span className="inline-flex items-center gap-2">
          <Spinner />
          {label}
        </span>
      </td>
    </tr>
  );
}

export function TableEmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="py-12 text-center text-sm text-security-navy-500">
        {message}
      </td>
    </tr>
  );
}
