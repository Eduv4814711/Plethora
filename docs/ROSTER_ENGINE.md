# Roster engine

This document describes how Plethora models sites, posts, and shifts for **auto-roster** (multi-guard, pattern-aligned planning) versus **bulk create** (single-guard recurrence).

## Entity relationships

```
Site
 ├── rosterDayShiftGuardsRequired / rosterNightShiftGuardsRequired  (demand per calendar day)
 ├── rosterDayShiftGender / rosterNightShiftGender                  (optional rules)
 ├── SiteAssignment          → which guards may work here (hard gate)
 ├── Post (day)              → physical day post (06:00–18:00)
 ├── Post (night)            → physical night post (18:00–06:00)
 │    └── PostAssignment     → preferred guard ↔ post (soft score in auto-roster)
 └── Shift                   → scheduled cell (employee + post + times)
```

- A **Shift** has no `siteId`; site is derived via `post.site`.
- Auto-roster never writes until **Apply**; preview returns a `RosterPlan` with entries and diagnostics.

## Auto-roster algorithm

Implemented in `apps/api/src/services/roster-engine.service.ts` and `roster-scheduler.ts`.

1. **Load site** — posts (with `PostAssignment`), rosterable `SiteAssignment` guards, staffing, gender rules.
2. **Build demand slots** — for each calendar day: `dayStaff` day slots + `nightStaff` night slots; posts rotate when staffing exceeds post count.
3. **Phase spreading** — multiple guards get automatic cycle offsets via `computeStaggerOffsets` (not user-configurable). Example for `3_on_3_off` with 3 guards: offsets 0, 3, 6 days so day/night blocks align across the team.
4. **Pattern grid** — per guard and date, preference is `day`, `night`, or `off` from the pattern + offset.
5. **Greedy assign** — demand slots sorted by difficulty, then date; `pickBestGuardForDemandSlot` only considers guards whose pattern phase **matches** the slot type (strict — no filling off-days).
6. **Gap-fill pass** — slots still uncovered after step 5 are retried with pattern matching relaxed (rest, gender, and overlap rules still apply). Filled slots emit `PATTERN_BREAK_FILL` warnings and increment `patternBreaks`.
7. **Coverage validation** — `validateDailyCoverage` flags days missing required day/night counts.
8. **Apply** — optional replace of `created`/`assigned` shifts on site posts in range, then `createMany` planned entries.

## Bulk create vs auto-roster

| | Bulk create (`POST /shifts/bulk`) | Auto-roster preview/apply |
|---|-----------------------------------|---------------------------|
| Guards | One employee | All site-assigned rosterable guards |
| Patterns | Many (`weekdays`, `2_on_2_off`, …) | `3_on_3_off`, `custom_builder` only |
| Post routing | `resolvePostForShiftSlot` (assignment preference or round-robin) | Demand-slot round-robin on site posts |
| Pattern strictness | Varies by pattern | Strict phase alignment |

## When coverage gaps are expected

Under strict patterns, **uncovered slots are normal** when:

- Too few rosterable guards for staffing or cycle length (e.g. `3_on_3_off` with fewer than 3 guards).
- Gender rules eliminate all candidates for a shift type.
- Rest/overlap rules block pattern-aligned guards.
- Staffing requires more simultaneous guards than the team can provide on-pattern.

Preview surfaces `UNCOVERED_SLOT` warnings, `conflicts[]`, `skippedGuardDays` (guards on pattern `off` while that day still has gaps), and `PATTERN_COVERAGE_HINT` messages.

## API

- `POST /shifts/roster/preview` — body: `siteId`, `startDate`, `endDate`, `pattern`, optional `customBlocks`.
- `POST /shifts/roster/apply` — body: `plan`, optional `replaceExisting` (default true).

## Operator checklist

1. Site: assign guards (`SiteAssignment`), set day/night staffing counts, configure gender rules if needed.
2. Posts: at least one **day** and one **night** post.
3. Optional: `PostAssignment` for preferred post scoring.
4. Rostering: select site → pattern → generate plan → review coverage % and warnings → apply.

## Continuous auto-roster (payroll calendar)

Automated rostering runs on a **daily schedule** and maintains shifts from **today** through the end of the configured payroll horizon (default **2 pay periods**). It reuses the same preview/apply engine as manual rostering.

### Company settings (`Company.settings` JSON)

| Field | Purpose |
|-------|---------|
| `payrollPeriod` | `weekly` \| `biweekly` \| `monthly` — **PAYE tax frequency only** |
| `payPeriodStartDay` | Day of month each pay/roster period starts (default `26`) |
| `payPeriodEndDay` | Day of month each period ends (default `25`, typically in the following month) |
| `autoRosterHorizonPeriods` | How many pay periods ahead auto-roster maintains (default `2`) |

**Pay period rule:** spanning month boundaries. Example with start **26** and end **25**:

- 18 Jun 2026 → period **26 May – 25 Jun** → labelled **June Pay/Roster Period**
- 26 Jun – 25 Jul → labelled **July Pay/Roster Period**

Labels always use the **month/year of `periodEnd`**. Period key: `YYYY-MM` of the end date.

`getRosterWindow` uses `autoRosterHorizonPeriods` and clips `startDate` to **today or later** — past shifts are never rewritten.

### Pay periods API

- `GET /pay-periods` — list generated periods (`before` / `after` query params)
- `GET /pay-periods/current` — current period bounds and labels

### Site settings

| Field | Default | Purpose |
|-------|---------|---------|
| `autoRosterEnabled` | false | Master toggle |
| `autoRosterPattern` | null | `3_on_3_off` or `custom_builder` |
| `autoRosterCustomBlocks` | null | Required when pattern is `custom_builder` |
| `autoRosterMinCoveragePercent` | 100 | Auto-apply threshold |
| `autoRosterLastRunAt` / `autoRosterLastStatus` | null | Last automation outcome |

### Decision flow

1. Daily cron → `POST /internal/cron/auto-roster` (Bearer `CRON_SECRET`).
2. For each auto-enabled site: `generateRosterPlan` for the roster window.
3. If `coveragePercent >= autoRosterMinCoveragePercent` → `applyRosterPlan` with `replaceExisting: true` (only `created`/`assigned` shifts in range).
4. Otherwise → `RosterAutomationRun` with `status: pending_review` and full `planSnapshot` for manager review.

Immediate triggers (v1): enabling auto-roster on a site, or changing payroll calendar settings.

### Review queue API

- `GET /shifts/roster/automation` — pending/failed runs
- `POST /shifts/roster/automation/:id/apply` — manager applies queued plan
- `POST /shifts/roster/automation/:id/dismiss` — discard without applying

### Operator checklist (automation)

1. **Settings → Business:** set pay period start/end days and roster horizon.
2. **Site detail:** complete readiness (guards, day/night posts, staffing), enable auto-roster, choose pattern and threshold.
3. **Rostering:** review **Auto-roster queue** banner when coverage was below threshold.
4. **Railway:** configure `CRON_SECRET` and a daily cron job hitting `/internal/cron/auto-roster`.

See also [PLETHORA-USER-MANUAL.md](./PLETHORA-USER-MANUAL.md) for UI workflows.
