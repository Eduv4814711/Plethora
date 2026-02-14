# Wireframe-Inspired Frontend Redesign — Agent Prompt

Copy everything below this line and paste it into a Cursor agent to begin the redesign.

---

## TASK: Redesign the Entire Plethora Frontend with a Wireframe-Inspired UI/UX

You will redesign the complete frontend of the Plethora workforce management application to achieve a wireframe-inspired aesthetic. This is a substantial, multi-step task. Take your time. Plan before you code. Iterate until the result is cohesive, professional, and visually distinctive. Do not rush.

---

## PROJECT CONTEXT

**Application**: Plethora — Workforce & Payroll Management (security guard rostering, sites, employees, attendance, payroll, reports, audit)

**Tech stack**:
- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- TypeScript
- date-fns, clsx

**Key files to modify**:
- `apps/web/app/globals.css` — Global styles, CSS variables, utility classes
- `apps/web/tailwind.config.ts` — Theme, colors, fonts, shadows
- `apps/web/components/dashboard-layout.tsx` — Sidebar, header, main layout
- `apps/web/components/theme-applier.tsx` — Theme/theme switching if present
- `apps/web/app/layout.tsx` — Root layout
- `apps/web/app/(auth)/login/page.tsx` — Login page
- `apps/web/app/(auth)/layout.tsx` — Auth layout
- `apps/web/app/(dashboard)/page.tsx` — Dashboard home
- `apps/web/app/(dashboard)/layout.tsx` — Dashboard layout wrapper
- `apps/web/app/(dashboard)/employees/page.tsx` — Employees list, forms, modals
- `apps/web/app/(dashboard)/sites/page.tsx` — Sites list
- `apps/web/app/(dashboard)/sites/[id]/page.tsx` — Site detail (posts, guards, shifts, calendar)
- `apps/web/app/(dashboard)/rostering/page.tsx` — Rostering calendar
- `apps/web/app/(dashboard)/attendance/page.tsx` — Attendance
- `apps/web/app/(dashboard)/payroll/page.tsx` — Payroll
- `apps/web/app/(dashboard)/reports/page.tsx` — Reports
- `apps/web/app/(dashboard)/audit/page.tsx` — Audit log
- `apps/web/app/(dashboard)/settings/page.tsx` — Settings

---

## WIREFRAME DESIGN LANGUAGE — DETAILED SPECIFICATION

### 1. Color Palette

- **Primary**: Monochrome or near-monochrome. Use black, white, and grays only, or a very limited accent (e.g., a single muted blue or gray-blue for links/active states).
- **Light mode**: White or off-white background (`#ffffff`, `#fafafa`, or `#f5f5f5`). Text: near-black (`#0a0a0a`, `#171717`). Borders: light gray (`#e5e5e5`, `#d4d4d4`).
- **Dark mode**: Dark gray or black background (`#0a0a0a`, `#171717`). Text: near-white (`#fafafa`, `#f5f5f5`). Borders: medium gray (`#404040`, `#525252`).
- **No gradients**. No saturated accent colors (no indigo, emerald, amber, etc.). If you use an accent, it must be subtle and desaturated.
- **Placeholder/lorem blocks**: Use a lighter gray or dashed borders to suggest “content goes here.”

### 2. Typography

- **Font**: Use a geometric sans-serif or monospace font. Examples: `IBM Plex Mono`, `JetBrains Mono`, `Space Mono`, `Geist Mono`, `Inter` (if you want something more neutral but still clean). Avoid rounded or playful fonts.
- **Hierarchy**: Establish hierarchy through font weight (400, 500, 600, 700) and size, not color. Section titles: larger, bolder. Labels: smaller, uppercase or small-caps, letter-spacing.
- **Labels**: Use `uppercase`, `tracking-wider`, and `text-xs` or `text-sm` for form labels, table headers, and section labels.
- **Body text**: Clear, readable size (14–16px). Adequate line-height.

### 3. Borders and Outlines

- **Stroke width**: 1px borders everywhere. No thick borders.
- **Style**: Prefer solid borders. Use `border-dashed` or `border-dotted` for dividers, section boundaries, or placeholder areas to reinforce the wireframe feel.
- **Radius**: Minimal or none. Use `rounded-none` or `rounded-sm` (2–4px) at most. No `rounded-xl` or `rounded-2xl` unless you intentionally want a subtle exception.

### 4. Shadows and Depth

- **No shadows** by default, or only a very subtle `shadow-sm` for cards/modals if needed for readability.
- **Depth**: Convey hierarchy through borders, spacing, and layout—not shadows or gradients.

### 5. Components

- **Buttons**: Outlined style. `border border-gray-300 dark:border-gray-600`, transparent or light background. On hover: slight background fill. Primary actions: same style, maybe slightly bolder border.
- **Inputs**: Bordered, no heavy shadows. `border border-gray-300 dark:border-gray-600`, minimal padding. Focus: ring or border color change, not glow.
- **Cards**: Rectangular blocks with 1px borders. Optional dashed border for “placeholder” cards. No rounded corners or soft shadows.
- **Tables**: Bordered cells, clear header row. Use `border-collapse` and thin borders.
- **Modals/Dialogs**: Bordered container, minimal shadow. Title and content clearly separated with a border or divider.

### 6. Icons

- **Style**: Stroke-based only. No filled icons. Use `strokeWidth={1.5}` or `strokeWidth={2}`. Prefer Heroicons outline or similar.
- **Color**: Match text color (gray-700 in light, gray-300 in dark). No colored icons except for very specific states (e.g., error, success) if needed.

### 7. Layout and Spacing

- **Grid**: Use a strict grid. Consistent column gaps and row gaps. Align elements to the grid.
- **Whitespace**: Generous padding and margins. Do not cram content. Let the wireframe “breathe.”
- **Sections**: Clearly separate sections with borders or dividers (horizontal rules, dashed lines).

### 8. Interactive States

- **Hover**: Subtle background change (e.g., `bg-gray-50 dark:bg-gray-800/50`) or border darkening.
- **Focus**: Visible focus ring for accessibility. Use `ring-2 ring-offset-2` or equivalent.
- **Active/Selected**: Border or background change to indicate state. Keep it minimal.

---

## TECHNICAL REQUIREMENTS

1. **Preserve all functionality**: Authentication, API calls (`authFetch`), routing, forms, modals, and business logic must work exactly as before. Change only visuals and layout.
2. **Dark/light mode**: Support both. Use Tailwind’s `dark:` variant. Ensure sufficient contrast in both modes.
3. **Tailwind only**: Use Tailwind classes. Do not introduce new CSS frameworks. You may add custom utilities in `globals.css` if needed.
4. **No new dependencies**: Do not add new npm packages unless absolutely necessary (e.g., a specific icon set). Prefer inline SVGs or existing dependencies.
5. **Responsive**: Layouts must remain responsive. Sidebar may collapse or adapt on small screens. Tables and grids should not overflow.

---

## IMPLEMENTATION ORDER

Follow this sequence to ensure consistency and avoid rework:

1. **Foundation**
   - Update `apps/web/app/globals.css`: Remove gradients, adjust CSS variables for wireframe palette, add/update utility classes (e.g., `.btn-wireframe`, `.input-wireframe`, `.card-wireframe`).
   - Update `apps/web/tailwind.config.ts`: Font family, colors, remove or simplify shadows.

2. **Layout**
   - Redesign `apps/web/components/dashboard-layout.tsx`: Sidebar with wireframe style (borders, minimal styling), header with search and user area. Ensure nav items use the new visual language.

3. **Auth**
   - Redesign `apps/web/app/(auth)/login/page.tsx` and `apps/web/app/(auth)/layout.tsx`: Centered, bordered form. No gradients or heavy shadows.

4. **Dashboard**
   - Redesign `apps/web/app/(dashboard)/page.tsx`: Stat cards as bordered blocks, links styled as wireframe buttons. Alerts and payroll status in bordered sections.

5. **Employees**
   - Redesign `apps/web/app/(dashboard)/employees/page.tsx`: List/cards with borders, filters as outlined controls, add/edit forms and modals in wireframe style.

6. **Sites**
   - Redesign `apps/web/app/(dashboard)/sites/page.tsx` and `apps/web/app/(dashboard)/sites/[id]/page.tsx`: Site cards, post management, guard assignment, calendar—all in wireframe aesthetic.

7. **Rostering**
   - Redesign `apps/web/app/(dashboard)/rostering/page.tsx`: Calendar grid with clear borders, shift blocks as outlined rectangles. Toolbar and navigation in wireframe style.

8. **Remaining pages**
   - Redesign `apps/web/app/(dashboard)/attendance/page.tsx`, `payroll/page.tsx`, `reports/page.tsx`, `audit/page.tsx`, `settings/page.tsx` to match the same design system.

---

## QUALITY GATES

Before considering the task complete, verify:

1. **Consistency**: Every page uses the same color palette, typography, border style, and component patterns.
2. **Accessibility**: Sufficient contrast (WCAG AA). Focus states visible. Labels associated with inputs.
3. **No regressions**: All existing features work. No broken layouts, overflow issues, or missing content.
4. **Dark mode**: Both light and dark modes look correct and readable across all pages.

---

## ADDITIONAL GUIDANCE

- **Think like a designer**: A wireframe is a blueprint. Your UI should feel like a refined, high-fidelity version of that blueprint—clean, structural, and intentional.
- **Avoid the “AI slop” aesthetic**: Do not default to purple gradients, rounded corners, and soft shadows. This design should feel deliberately different.
- **Iterate**: If a page feels off, refine it. Ensure the calendar, forms, and tables all feel part of the same system.
- **Document decisions**: If you add a custom utility class or make a significant design choice, add a brief comment so future maintainers understand the intent.

---

## START

Begin with the foundation (globals.css and tailwind.config.ts), then proceed through the implementation order. Work methodically. The goal is a cohesive, professional wireframe-inspired UI that feels intentional and distinctive.
