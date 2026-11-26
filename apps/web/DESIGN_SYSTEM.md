# Plethora ERP — Frontend Design System

All UI in `apps/web` must compose from **`@/components/ui`** ([index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx)) and the design tokens in [globals.css](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/app/globals.css) and [tailwind.config.ts](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/tailwind.config.ts). Never hand-roll one-off modals, drawers, tabs, status pills, or page headers inside feature pages.

---

## 1. Visual Language & Color Discipline

- **Graphite Chrome, Paper Surface, Orange Signal**:
  - **Chrome (`#171A1F` / `security-navy-900`)**: Left navigation sidebar, primary buttons, and headings.
  - **Canvas (`#F5F6F8` / `--bg-canvas`) & Paper (`#FFFFFF`)**: High-contrast work surfaces for dense operational tables and forms.
  - **Signal Orange (`#F97A08` / `security-amber-500`)**: Reserved strictly for active navigation state, focus rings, live indicators, and the single primary signal action on a screen (`variant="signal"`). Never use orange as decorative wallpaper.
  - **Semantic States**: `security-emerald` (`#0E8A5F`) for covered/approved/paid, `security-amber` for attention/pending, and `red-700`/`red-800` for critical/overdue/failed.
- **Typography**:
  - `Space Grotesk` (`font-display`) for headings and focal numbers (`tabular-nums`).
  - `Archivo` (`font-sans`) for body copy and controls.
  - `JetBrains Mono` (`font-mono`) strictly for codes, IDs, and tabular timestamps.
  - Use **sentence case** for labels, headings, and table headers where possible; avoid `ALL CAPS` pre-heading eyebrows or decorative badge clusters.

---

## 2. Reusable Component Catalog (`@/components/ui`)

| Component | Source | Purpose |
| :--- | :--- | :--- |
| `PageShell` | [layout.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/layout.tsx) | Standard page container (`width="narrow" \| "default" \| "wide" \| "full"`) with consistent `gap-6` vertical rhythm. |
| `PageHeader` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Top page heading (`title`, `description`, `actions`) with hairline bottom divider. |
| `Section` | [layout.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/layout.tsx) | Section wrapper with sentence-case `h2`, optional subtitle, and right-aligned action. |
| `KpiStrip` | [layout.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/layout.tsx) | 2-to-4 column horizontal summary strip with `1px` hairline dividers and `tabular-nums`. |
| `StatCard` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Individual KPI tile with status spine (`live \| good \| warn \| bad \| idle`). |
| `Card` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Surface container (`dashboard \| wireframe \| elevated`). |
| `Toolbar` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Sunken filter/search strip positioned directly above a table. |
| `SearchInput` | [layout.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/layout.tsx) | Standard search input with inline icon and clear button. |
| `Field`, `Input`, `Select`, `Textarea` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Accessible form controls with automatic `id` / `aria-describedby` / `aria-invalid` wiring. |
| `Button` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | `primary \| secondary \| ghost \| signal \| destructive` with built-in `loading` spinner. |
| `Badge`, `StatusBadge` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | `StatusBadge` maps domain statuses (`ACTIVE`, `PENDING`, `OVERDUE`, `CRITICAL`, etc.) consistently. |
| `Modal`, `Drawer` | [dialog.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/dialog.tsx) | Native `<dialog>` (`showModal()`) overlays with Esc/backdrop dismiss, focus return, and scroll containment. |
| `ConfirmModal`, `useConfirmDialog` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Promise-based destructive confirmation dialog. |
| `Tabs` | [tabs.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/tabs.tsx) | Accessible `role="tablist"` (`underline \| segmented`) with keyboard arrow navigation and WCAG 1.4.1 shape indicator. |
| `TableShell`, `TableLoadingRow`, `TableEmptyRow` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Sticky-header table frame with uniform hover, loading, and empty states. |
| `AlertBanner`, `EmptyState`, `SkeletonBlock` | [index.tsx](file:///C:/Users/nkagi/Desktop/Plethora/apps/web/components/ui/index.tsx) | Standard status feedback and loading placeholders. |

---

## 3. Navigation Contract

- **One Navigation System**: All module navigation lives in the persistent Left Sidebar (`DashboardLayout`) on desktop and the matching slide-over drawer on mobile. Do not add competing module switchers, floating quick-nav bars, or redundant tile launchers.
- **Sub-navigation**: Inside multi-view modules (e.g. `/billing`, `/compliance`), use a single compact `Tabs` or sub-nav row directly beneath `PageHeader`.
