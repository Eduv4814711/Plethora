"use client";

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
    <div className="mx-auto w-full max-w-lg rounded-xl border border-slate-200 bg-slate-50/70 p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white text-xl shadow-sm">
        👩🏽‍🏫
      </div>
      <h3 className="text-base font-semibold text-security-navy-900">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-base-content/70">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onCta} className="btn btn-primary btn-sm rounded-lg">
          {ctaLabel}
        </button>
        {secondaryCtaLabel && onSecondaryCta && (
          <button type="button" onClick={onSecondaryCta} className="btn btn-outline btn-sm rounded-lg">
            {secondaryCtaLabel}
          </button>
        )}
      </div>
    </div>
  );
}
