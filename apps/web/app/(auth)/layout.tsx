/**
 * Sign-in is the one screen in the product that gets to say what Plethora is,
 * so it shows the thing itself: a night duty ribbon, 18:00 to 06:00, with the
 * shifts laid across it exactly as a controller would read them off the board.
 * Not decoration — it is the artifact the whole product exists to produce.
 */

type Shift = {
  site: string;
  /** Start and end as hours from 18:00, across a twelve-hour night. */
  from: number;
  to: number;
  state: "live" | "covered" | "open";
};

const RIBBON: Shift[] = [
  { site: "Sandton Gate", from: 0, to: 12, state: "live" },
  { site: "Midrand DC", from: 0, to: 6, state: "covered" },
  { site: "Midrand DC", from: 6, to: 12, state: "open" },
  { site: "Rosebank Mall", from: 1, to: 11, state: "covered" },
  { site: "N1 Depot", from: 2, to: 12, state: "live" },
  { site: "Fourways Est.", from: 0, to: 9, state: "covered" },
];

const stateStyles: Record<Shift["state"], string> = {
  live: "bg-security-amber-500",
  covered: "bg-white/25",
  open: "border border-dashed border-white/30 bg-transparent",
};

function DutyRibbon() {
  return (
    <div className="w-full max-w-md" aria-hidden>
      <div className="mb-3 flex items-center justify-between font-mono text-[0.625rem] uppercase tracking-[0.16em] text-white/60">
        <span>18:00</span>
        <span>00:00</span>
        <span>06:00</span>
      </div>
      <div className="space-y-2">
        {RIBBON.map((shift, i) => (
          <div key={`${shift.site}-${i}`} className="flex items-center gap-3">
            <span className="w-24 shrink-0 truncate text-right text-[0.6875rem] text-white/60">{shift.site}</span>
            <div className="relative h-2.5 flex-1 rounded-full bg-white/[0.06]">
              <div
                className={`absolute inset-y-0 rounded-full ${stateStyles[shift.state]} animate-slide-up motion-reduce:animate-none`}
                style={{
                  left: `${(shift.from / 12) * 100}%`,
                  width: `${((shift.to - shift.from) / 12) * 100}%`,
                  animationDelay: `${120 + i * 70}ms`,
                  animationFillMode: "backwards",
                }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 pl-[6.75rem] font-mono text-[0.625rem] uppercase tracking-[0.14em] text-white/60">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-security-amber-500 animate-signal-pulse motion-reduce:animate-none" />
          On duty
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
          Covered
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full border border-dashed border-white/55" />
          Open post
        </span>
      </div>
    </div>
  );
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[1.05fr_minmax(28rem,0.95fr)]">
      {/* No ambient glow behind this panel: the ribbon is the one thing here
          worth looking at, and a blurred gradient would only compete with it. */}
      <aside className="surface-chrome relative hidden flex-col justify-between overflow-hidden p-12 lg:flex xl:p-16">
        <img src="/plethora-logo-header.svg" alt="Plethora" className="relative h-9 w-auto self-start object-contain" />

        <div className="relative max-w-lg">
          <p className="font-mono text-[0.6875rem] uppercase tracking-[0.18em] text-security-amber-400">
            Tonight, 18:00 — 06:00
          </p>
          {/* Deliberately a <p>, not an <h1>: the page's real heading is the
              form beside it, and two h1s would leave a screen reader guessing
              which one names the page. */}
          <p className="mt-5 font-display text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.03em] text-white xl:text-[3rem]">
            Every post covered,
            <br />
            every hour accounted for.
          </p>
          <p className="mt-5 max-w-md text-[0.9375rem] leading-relaxed text-white/65">
            Rostering, attendance, payroll and incidents for security operations — one board, one record, from
            the gate to the payslip.
          </p>
          <div className="mt-12">
            <DutyRibbon />
          </div>
        </div>

        <p className="relative font-mono text-[0.625rem] uppercase tracking-[0.16em] text-white/55">
          Plethora — workforce operations
        </p>
      </aside>

      <main className="flex min-h-screen items-center justify-center bg-white px-5 py-12 sm:px-8 lg:min-h-0">
        <div className="w-full max-w-[26rem]">{children}</div>
      </main>
    </div>
  );
}
