"use client";

type OperationalWorkflowStepsProps = {
  steps: string[];
  className?: string;
};

/** Numbered workflow strip — stacks on small screens, flows horizontally on larger ones. */
export function OperationalWorkflowSteps({ steps, className = "" }: OperationalWorkflowStepsProps) {
  return (
    <ol className={`space-y-2 sm:space-y-0 sm:flex sm:flex-wrap sm:items-center sm:gap-x-2 sm:gap-y-2 ${className}`}>
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-2 sm:gap-2">
          <span className="flex min-w-0 items-center gap-2 rounded-lg border border-security-navy-100 bg-white px-3 py-2 text-sm shadow-security-card dark:border-security-navy-700 dark:bg-security-navy-900 sm:border-0 sm:bg-transparent sm:px-0 sm:py-0 sm:shadow-none">
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-security-amber/15 text-[11px] font-bold text-security-navy dark:text-security-amber"
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="font-medium text-security-navy-900 dark:text-security-navy-200">{step}</span>
          </span>
          {i < steps.length - 1 && (
            <svg
              className="hidden h-3.5 w-3.5 shrink-0 text-security-navy-300 dark:text-security-navy-600 sm:block"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          )}
        </li>
      ))}
    </ol>
  );
}
