"use client";

import { Button, EmptyState } from "@/components/ui";

export function EmptyStateCard({
  title,
  description,
  ctaLabel,
  onCta,
  secondaryCtaLabel,
  onSecondaryCta,
}: {
  title: string;
  description: string;
  ctaLabel: string;
  onCta: () => void;
  secondaryCtaLabel?: string;
  onSecondaryCta?: () => void;
}) {
  return (
    <EmptyState
      title={title}
      description={description}
      action={
        <Button size="sm" onClick={onCta}>
          {ctaLabel}
        </Button>
      }
      secondaryAction={
        secondaryCtaLabel && onSecondaryCta ? (
          <Button variant="secondary" size="sm" onClick={onSecondaryCta}>
            {secondaryCtaLabel}
          </Button>
        ) : null
      }
    />
  );
}
