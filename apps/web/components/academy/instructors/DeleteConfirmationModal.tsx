"use client";

import { ConfirmModal } from "@/components/ui";

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
  return (
    <ConfirmModal
      open={open}
      title={title}
      message={message}
      confirmLabel={confirmLabel}
      danger={danger}
      loading={loading}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
