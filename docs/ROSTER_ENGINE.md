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

See also [PLETHORA-USER-MANUAL.md](./PLETHORA-USER-MANUAL.md) for UI workflows.
