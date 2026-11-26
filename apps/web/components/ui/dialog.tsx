"use client";

import { useEffect, useId, useRef } from "react";
import { clsx } from "clsx";

type ModalSize = "sm" | "md" | "lg" | "xl";

const modalSizes: Record<ModalSize, string> = {
  sm: "max-w-sm",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

/**
 * Accessible modal dialog built on native `<dialog>` + `showModal()`.
 * Provides browser-managed top-layer rendering, Esc dismissal, focus trapping,
 * focus restoration, and `overscroll-behavior: contain` scroll containment.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  closeOnBackdrop = true,
  dismissible = true,
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: ModalSize;
  closeOnBackdrop?: boolean;
  dismissible?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleClose = () => {
      if (open && dismissible) onClose();
    };

    const handleCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible) onClose();
    };

    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [open, onClose, dismissible]);

  const pressedOutsideRef = useRef(false);
  const isOutside = (e: React.PointerEvent<HTMLDialogElement>, el: HTMLDialogElement) => {
    const r = el.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  if (!open) return null;

  const canBackdropClose = closeOnBackdrop && dismissible;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onPointerDown={(e) => {
        if (!canBackdropClose || !dialogRef.current) return;
        pressedOutsideRef.current = isOutside(e, dialogRef.current);
      }}
      onPointerUp={(e) => {
        if (!canBackdropClose || !dialogRef.current) return;
        if (pressedOutsideRef.current && isOutside(e, dialogRef.current)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
      className={clsx(
        "m-auto w-[calc(100vw-2rem)] rounded-security-lg border border-security-navy-100 bg-white p-0 text-security-navy-900 shadow-security-elevated backdrop:bg-security-navy-950/55 backdrop:backdrop-blur-[2px]",
        "open:animate-slide-up motion-reduce:open:animate-none",
        modalSizes[size],
        className
      )}
    >
      <div className="flex items-start justify-between gap-4 border-b border-security-navy-100 px-5 py-4">
        <div className="min-w-0">
          <h1 id={titleId} className="font-display text-base font-semibold text-security-navy-950">
            {title}
          </h1>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs text-security-navy-500">
              {description}
            </p>
          ) : null}
        </div>
        {dismissible ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-security text-security-navy-400 transition-colors hover:bg-security-navy-100 hover:text-security-navy-900"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      <div className="max-h-[70dvh] overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-security-navy-100 bg-security-navy-50/50 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}

/**
 * Accessible slide-over panel built on native `<dialog>` + `showModal()`.
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  side = "right",
  footer,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: "left" | "right";
  footer?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handleClose = () => {
      if (open) onClose();
    };
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("close", handleClose);
    dialog.addEventListener("cancel", handleCancel);
    return () => {
      dialog.removeEventListener("close", handleClose);
      dialog.removeEventListener("cancel", handleCancel);
    };
  }, [open, onClose]);

  const pressedOutsideRef = useRef(false);
  const isOutside = (e: React.PointerEvent<HTMLDialogElement>, el: HTMLDialogElement) => {
    const r = el.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onPointerDown={(e) => {
        if (!dialogRef.current) return;
        pressedOutsideRef.current = isOutside(e, dialogRef.current);
      }}
      onPointerUp={(e) => {
        if (!dialogRef.current) return;
        if (pressedOutsideRef.current && isOutside(e, dialogRef.current)) {
          onClose();
        }
        pressedOutsideRef.current = false;
      }}
      className={clsx(
        "fixed inset-y-0 m-0 flex h-[100dvh] max-h-[100dvh] w-[min(28rem,92vw)] flex-col border-security-navy-100 bg-white p-0 text-security-navy-900 shadow-security-elevated backdrop:bg-security-navy-950/55 backdrop:backdrop-blur-[2px]",
        side === "right" ? "ml-auto border-l" : "mr-auto border-r",
        className
      )}
    >
      <div className="flex shrink-0 items-start justify-between gap-4 border-b border-security-navy-100 px-5 py-4">
        <div className="min-w-0">
          <h1 id={titleId} className="font-display text-base font-semibold text-security-navy-950">
            {title}
          </h1>
          {description ? (
            <p id={descId} className="mt-0.5 text-xs text-security-navy-500">
              {description}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-security text-security-navy-400 transition-colors hover:bg-security-navy-100 hover:text-security-navy-900"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

      {footer ? (
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-security-navy-100 bg-security-navy-50/50 px-5 py-3">
          {footer}
        </div>
      ) : null}
    </dialog>
  );
}
