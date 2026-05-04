# Plethora — UI/UX skill guide (orange brand + responsive design)

**Version:** alpha (includes layout/spacing patterns inspired by Notion-style product UIs)

Plethora is a **multi-surface** application. Use this document whenever you add or change UI in **`apps/web`**. Interfaces must scale intelligently across **desktop, tablet, and mobile** without degrading usability or clarity.

**Brand direction:** Plethora’s **primary brand color is orange** (`#FF9800` and the extended scale in Tailwind as **`security-navy`**—legacy token name, **orange values**). Use orange for **primary CTAs**, **header chrome**, **focus rings**, **charts**, and **key accents**. Do **not** treat purple (`#5645d4` or similar) as the product primary. Typography favors **Inter** (Notion-style stack where listed), **rectangular 8px** controls for dense app UI, and **black** body copy per `globals.css` (see global text overrides).

Implementation continues to live in global CSS and Tailwind until tokens are fully migrated—do not invent a third parallel language.

---

## Source of truth (codebase)

| Layer | File | Role |
|--------|------|------|
| Tokens + component utilities | [`apps/web/app/globals.css`](apps/web/app/globals.css) | CSS variables (`:root`), `@layer utilities` (buttons, inputs, cards, typography, badges), React Day Picker (`.rdp-root`), global text overrides |
| Theme extensions | [`apps/web/tailwind.config.ts`](apps/web/tailwind.config.ts) | Fonts, color scales, radii, shadows, animations, **`darkMode: "class"`** |

---

## Design tokens (reference YAML — Plethora)

Use these as the canonical names when specifying design in prompts, specs, or Tailwind extensions. **`colors.primary`** is **orange**, not purple.

```yaml
version: alpha
name: Plethora
colors:
  primary: "#FF9800"
  primary-pressed: "#F57C00"
  primary-deep: "#E65100"
  on-primary: "#000000"
  brand-navy: "#0a1530"
  brand-navy-deep: "#070f24"
  brand-navy-mid: "#1a2a52"
  link-blue: "#000000"
  link-blue-pressed: "#000000"
  brand-orange: "#FF9800"
  brand-orange-deep: "#F57C00"
  brand-orange-warn: "#dd5b00"
  brand-orange-warn-deep: "#793400"
  brand-pink: "#ff64c8"
  brand-pink-deep: "#a02e6d"
  # brand-purple* — palette reference only; NOT Plethora product primary (use colors.primary orange)
  brand-purple: "#7b3ff2"
  brand-purple-300: "#d6b6f6"
  brand-purple-800: "#391c57"
  brand-teal: "#2a9d99"
  brand-green: "#1aae39"
  brand-yellow: "#f5d75e"
  brand-brown: "#523410"
  card-tint-peach: "#ffe8d4"
  card-tint-rose: "#fde0ec"
  card-tint-mint: "#d9f3e1"
  card-tint-lavender: "#e6e0f5"
  card-tint-sky: "#dcecfa"
  card-tint-yellow: "#fef7d6"
  card-tint-yellow-bold: "#f9e79f"
  card-tint-cream: "#f8f5e8"
  card-tint-gray: "#f0eeec"
  canvas: "#ffffff"
  surface: "#f6f5f4"
  surface-soft: "#fafaf9"
  hairline: "#e5e3df"
  hairline-soft: "#ede9e4"
  hairline-strong: "#c8c4be"
  ink-deep: "#000000"
  ink: "#1a1a1a"
  charcoal: "#37352f"
  slate: "#5d5b54"
  steel: "#787671"
  stone: "#a4a097"
  muted: "#bbb8b1"
  on-dark: "#ffffff"
  on-dark-muted: "#a4a097"
  semantic-success: "#1aae39"
  semantic-warning: "#dd5b00"
  semantic-error: "#e03131"
rounded:
  xs: 4px
  sm: 6px
  md: 8px
  lg: 12px
  xl: 16px
  xxl: 20px
  xxxl: 24px
  full: 9999px
spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 20px
  xl: 24px
  xxl: 32px
  xxxl: 40px
  section-sm: 48px
  section: 64px
  section-lg: 96px
  hero: 120px
```

### Colors (human-readable)

**Brand & primary**

| Token | Hex | Use |
|-------|-----|-----|
| Primary | `#FF9800` | Dominant CTA, header gradient, charts—**not** for long body text blocks |
| Primary pressed | `#F57C00` | Pressed / hover-deep primary |
| Primary deep | `#E65100` | Deep emphasis, borders on orange chrome |
| Brand navy | `#0a1530` | Optional hero band / dark surfaces (marketing)—**not** the default app primary |
| Brand navy deep | `#070f24` | Darker navy |
| Brand navy mid | `#1a2a52` | Mid navy |
| Link (inline) | `#000000` | Inline links in product UI (underline); keep distinct from decorative orange |
| Link pressed | `#000000` | Same—affordance is underline / weight |

**Spectrum & card tints** — Use pastel tints for feature bands; **`card-tint-yellow-bold`** (`#f9e79f`) for high-emphasis assistant/feature banners.

**Surfaces & borders** — `canvas` / `surface` / `hairline*` as documented in YAML.

**Text** — Product UI targets **black** (`ink-deep` / `#000000`) for most copy; respect **global text overrides** in `globals.css`. Use structure, spacing, `page-title` / `section-title` / `label-text` for hierarchy—not gray utility shades alone.

**Semantic** — `semantic-success` / `semantic-warning` / `semantic-error` for status.

---

## Typography (Notion Sans)

**Family:** **Notion Sans** (Inter-based). Fallbacks: `Inter`, `-apple-system`, `system-ui`, `Segoe UI`, `Helvetica`, `sans-serif`.

Map weights: **600** headlines, **500** buttons / emphasis, **400** body.

| Token | Size | Weight | Line height | Letter spacing |
|-------|------|--------|-------------|----------------|
| hero-display | 80px | 600 | 1.05 | -2px |
| display-lg | 56px | 600 | 1.10 | -1px |
| heading-1 | 48px | 600 | 1.15 | -0.5px |
| heading-2 | 36px | 600 | 1.20 | -0.5px |
| heading-3 | 28px | 600 | 1.25 | 0 |
| heading-4 | 22px | 600 | 1.30 | 0 |
| heading-5 | 18px | 600 | 1.40 | 0 |
| subtitle | 18px | 400 | 1.50 | 0 |
| body-md | 16px | 400 | 1.55 | 0 |
| body-md-medium | 16px | 500 | 1.55 | 0 |
| body-sm | 14px | 400 | 1.50 | 0 |
| body-sm-medium | 14px | 500 | 1.50 | 0 |
| caption | 13px | 400 | 1.40 | 0 |
| caption-bold | 13px | 600 | 1.40 | 0 |
| micro | 12px | 500 | 1.40 | 0 |
| micro-uppercase | 11px | 600 | 1.40 | 1px |
| button-md | 14px | 500 | 1.30 | 0 |

**Responsive type (marketing-style heroes)**  

| Breakpoint | Hero approximate |
|------------|------------------|
| ≥ 1280px | Up to 80px display |
| 1024–1279px | ~72px |
| Tablet | ~56px |
| Mobile large | ~48px |
| Mobile small | ~36px |

**Implementation note:** Until `tailwind.config.ts` and `globals.css` expose Notion Sans everywhere, existing utilities (`page-title`, `section-title`, `label-text`) remain the hook points—**update those utilities** to use Notion scale/radius rather than adding one-off classes.

---

## Shapes & elevation

### Border radius (strict roles)

| Token | Value | Use |
|-------|-------|-----|
| **md** | **8px** | **Buttons, inputs, search fields** — rectangular, **not pills** |
| **lg** | **12px** | Cards, pricing, agent tiles, workspace-style mockup frames |
| **full** | pill | **Pill tabs, status badges only**—not default buttons |

### Elevation (shadow levels)

| Level | Shadow | Use |
|-------|--------|-----|
| 0 | Border only (`hairline`) | Default cards, rows |
| 1 | `rgba(15,15,15,0.04) 0 1px 2px` | Subtle hover elevation |
| 2 | `rgba(15,15,15,0.08) 0 4px 12px` | Feature cards |
| 3 | `rgba(15,15,15,0.20) 0 24px 48px -8px` | Hero workspace mockup |
| 4 | `rgba(15,15,15,0.16) 0 16px 48px -8px` | Modals, dropdowns |

**Motion:** Prefer **150–200ms ease** when adding transitions (not fully extracted from Notion marketing pages).

---

## Components (spec → implement in `globals.css` / Tailwind)

Summarized for day-to-day use; full prose lives in the iteration guide below.

**Buttons**

- **Primary:** bg **`primary` (orange)**, text **`on-primary` (black)** in Plethora, **8px** radius, padding **10px 18px**, type **button-md**. Pressed: `primary-pressed`. Disabled: bg `hairline`, text `muted`.
- **Dark:** bg `ink-deep`, text `on-dark`, same radius/padding.
- **Secondary:** transparent, text `ink`, border **1px** `hairline-strong`.
- **On-dark / secondary-on-dark:** white or outlined on navy hero (`on-dark`, `on-dark-muted` borders).
- **Ghost:** transparent, `ink`, smaller radius **sm**, padding **8px 12px**.
- **Link:** text **`link`** (black + underline in `globals.css`); do not substitute **`primary` orange** for inline link color unless it is a deliberate CTA link styled as a button.

**Cards**

- **card-base / card-feature:** `canvas`, **12px** radius, border `hairline`; feature uses larger padding (`spacing.xxl`).
- **Pastel feature variants:** peach, rose, mint, lavender, sky, yellow, cream, gray tints—text **`charcoal`**.
- **Featured pricing:** bg `surface`, border **2px** `primary` (orange).

**Inputs**

- Height **44px**; border **1px** `hairline-strong`; radius **md**; focused border **2px** `primary`.

**Tabs**

- **Pill tabs:** inactive `steel` + hairline border; active **ink-deep** fill + `on-dark`.
- **Segmented:** underline **2px** `ink` when active.

**Badges**

- Status pills (`rounded.full`); use **semantic** colors + **black** label text where specified in `globals.css`; tag chips use **sm** radius + pastel backgrounds (peach/mint/etc.).

**Hero & chrome**

- **hero-band-dark:** `brand-navy`, `on-dark`, generous **`spacing.hero`** padding; optional sticky-note / wire illustrations (per page).
- **App top nav (dashboard shell):** **orange gradient** (`security-navy-500` → `security-navy-600`), **black** nav labels, **white** pill for active route; bottom border **`primary-deep`**.

---

## Layout & spacing

- **Base unit:** 4px (8px rhythm common).
- **Container:** ~**1280px** max width, **32px** gutters where applicable.
- **Section rhythm:** large marketing bands **96px**; tighter pricing **64px**.

---

## Responsive behavior (Notion marketing patterns + Tailwind)

Plethora **`apps/web`** continues to use Tailwind breakpoints for the product shell:

| Context | Prefix | Min width |
|---------|--------|-----------|
| Mobile | (default) | &lt; 640px |
| Tablet | `sm:` | ≥ 640px |
| Small desktop | `md:` | ≥ 768px |
| Desktop | `lg:` | ≥ 1024px |
| Wide | `xl:` | ≥ 1280px |

**Collapsing (marketing reference)**

- Nav → hamburger below ~1024px.
- Hero mockup → stacks under copy on small screens.
- Pricing **4 → 2 → 1** columns.
- Feature grids **3 → 2 → 1**.
- Footer **6 → 3 → accordion**.

**Touch**

- Effective control height **40–44px** for buttons and inputs.

---

## Plethora product patterns (retained)

These remain mandatory for **dense app UI** (`apps/web` dashboard, academy, tables).

### Responsiveness is restructuring, not shrinking

- **Desktop-first** for dashboards; **mobile-friendly** for quick flows.
- Reflow with grids and flex; **`max-w-*`**, **`w-full`**, **`px-4 sm:px-6 lg:px-8`**.
- **Tables:** desktop full grid; tablet simplify; mobile **cards** or **`overflow-x-auto`** — never illegible cramming.

### Navigation

| Surface | Guidance |
|---------|-----------|
| Desktop | Sidebar or persistent horizontal nav |
| Tablet | Collapsible / condensed |
| Mobile | Drawer; prioritize actions |

### Global text override (legacy codebase)

`globals.css` may force some neutral/gray utilities to **solid black** with `!important`. **Do not rely on muted gray Tailwind classes for hierarchy**—use structure, spacing, `page-title` / `section-title` / `label-text`, and intentional Notion **`ink` / `slate` / `steel`** tokens once variables exist.

---

## Do’s and Don’ts (Notion + Plethora)

**Do**

- Use **`primary` (orange)** for the **dominant** CTA, header chrome, and brand accents.
- Pair **navy hero** contexts (marketing only) with **orange primary** + optional decorative elements.
- Use **pastel card tints** and **`card-tint-yellow-bold`** for high-emphasis bands.
- Use **`rounded.md` (8px)** on **buttons and inputs**; **`rounded.lg` (12px)** on cards.
- Use the **Inter / Notion Sans** stack for typography.
- Keep **inline links** black + underlined in product UI (`link-notion`), separate from **orange primary**.

**Don’t**

- Don’t use **purple** as the Plethora product primary or large chrome fills.
- Don’t use **pill geometry for primary buttons**—reserve **`rounded.full`** for tabs/badges.
- Don’t paint huge surfaces solid **`primary`** without texture/elevation—prefer **white/off-white** canvases with orange **accents**.
- Don’t drop heavy shadows on flat documentation cards (use elevation table).
- Don’t shrink complex dashboards onto mobile without **column/stack reflow**.

---

## Mapping: legacy utilities → Plethora theme

When touching styles, align to **orange primary**:

| Current (examples) | Target |
|--------------------|--------|
| `security-navy` in Tailwind | **`colors.primary` orange scale** (`#FF9800` … `#bf360c`)—name is legacy, **values are orange** |
| `rounded-security` pill-heavy CTAs | **`rounded.md`** (8px) rectangular buttons for dense UI |
| IBM Plex (mono) | **Inter** for sans; **IBM Plex Mono** for `mono` where used |
| `btn-primary` | **`btn-primary`** → **orange fill + black text** (see `globals.css`) |

Existing classes (`card-wireframe`, `card-dashboard`, `table-scroll`, `module-shell`, etc.) **stay** as layout primitives; **recolor and re-radius** them to match tokens above.

---

## Quick reference — codebase utility classes (evolve toward Notion tokens)

| Area | Classes | Notes |
|------|---------|--------|
| Buttons | `btn-primary`, `btn-secondary`, `btn-ghost`, `btn-amber`, `btn-danger` | **`btn-primary`** = orange + black text; hairline spec on secondaries |
| Inputs | `input-modern`, `input-compact` | 44px min height; focus ring **orange (`primary`)** |
| Cards | `card-wireframe`, `card-elevated`, `card-dashboard`, `module-panel` | Prefer **12px** corners + `hairline` borders |
| Tables | `table-scroll`, `table-module` | Comparison-style rows: `hairline-soft` dividers |
| Titles | `page-title`, `section-title`, `label-text` | Map sizes to heading scale |
| Motion | `animate-fade-in`, `animate-slide-up` | Keep subtle |

---

## Iteration guide

1. Change **one component family at a time** (buttons → inputs → cards).
2. Reference **token names** (`colors.primary` = **orange**, `rounded.md`) in PRs and commits.
3. Default body to **`body-md`**; buttons to **`button-md`**.
4. After editing shared styles, spot-check **dashboard**, **auth**, and **academy** at **sm / lg** breakpoints.
5. Prefer **`globals.css`** + Tailwind theme over scattered hex in components.

---

## Known gaps

- Dark-mode token sheet beyond navy heroes is incomplete—pair **`dark:`** carefully with Notion neutrals.
- Success validation color beyond **`semantic-success`** not fully specified.
- Pastel-to-feature mapping may expand in a future brand library.
- Tailwind token **`security-navy`** is the **orange** brand scale until renamed—do not remap it to purple in new work.

When in doubt, search **`apps/web`** for an existing screen that matches your pattern, then **migrate that pattern** toward this document rather than introducing **purple** primaries or off-brand palettes.
