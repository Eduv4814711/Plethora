---
name: plethora-front-end-ui-design
description: >-
  Designs and implements Plethora frontend UI with the repo's Next.js App
  Router, React, Tailwind, and local design system. Use when creating or
  changing dashboard screens, forms, tables, filters, modals, empty/loading
  states, responsive layouts, visual polish, or TSX UI in apps/web.
disable-model-invocation: false
---

# Plethora Front-End UI/UX Design Skill

## Purpose

Use this skill whenever working on the Plethora front-end UI inside `apps/web`.

The goal is to keep Plethora visually consistent, professional, responsive, accessible, and aligned with the existing brand system. Every UI change must improve the user workflow, not just make the screen “look nicer.”

---

# When This Applies

Use this skill for front-end work involving:

- Dashboard pages under `apps/web/app/(dashboard)/`
- Auth pages under `apps/web/app/(auth)/`
- Shared UI components under `apps/web/components/`
- Tailwind layout, spacing, responsiveness, accessibility, and visual polish
- Forms, tables, cards, modals, filters, dashboards, empty states, and navigation elements
- Any UI refactor that affects visual consistency or user experience

---

# First Steps Before Editing

Before making changes:

1. Read the target page or component carefully.
2. Read at least one nearby UI example to understand the existing visual pattern.
3. Identify the actual user workflow:
  - What is the user trying to accomplish?
  - What is the primary action?
  - What are the secondary actions?
  - Where does the user come from?
  - Where should the user go next?
  - What can go wrong?
4. Check for important UI states:
  - Loading state
  - Empty state
  - Error state
  - Permission-denied state
  - Disabled state
  - Submitting/saving state
  - Mobile state
5. Prefer improving the current Plethora design language instead of inventing a new one.

Do not start by redesigning everything. First understand the page, the pattern, and the user’s task.

---

# Plethora Design Identity

Plethora should feel like a modern security operations platform:

- Clean
- Trustworthy
- Operational
- Professional
- Fast to scan
- Easy for non-technical staff to use
- Strong enough for executives, controllers, HR, payroll, and guards

Avoid playful, overly colourful, generic SaaS designs. The UI should feel structured, calm, and business-ready.

---

# Local Design System

Use the existing Plethora brand language.

## Fonts

Use:

- `IBM Plex Sans` for normal UI text
- `IBM Plex Mono` only for code, IDs, timestamps, technical values, payroll values, or tabular data where useful

Do not introduce new fonts.

---

## Colours

Use existing brand tokens from `apps/web/tailwind.config.ts`.

Primary brand tokens:

- `security-navy`
- `security-amber`
- `security-emerald`

Supporting tones:

- Slate and gray neutrals
- White surfaces
- Red only for destructive actions, danger states, or errors

Important note:

Even though the primary brand token may be named `security-navy`, respect the existing Plethora token system and do not introduce unrelated colour palettes.

Avoid:

- Random blues
- Random purples
- Neon colours
- Gradients that do not match the product
- Unnecessary dark sections
- Unapproved brand colours

---

## Surfaces

Use the existing surface language:

- White cards
- `var(--bg-canvas)`
- `wireframe-bg`
- Subtle borders
- Soft shadows
- Clean dashboard spacing

Cards should feel structured, not heavy.

Use existing radius and shadow tokens:

- `rounded-security`
- `rounded-security-lg`
- `shadow-security-card`
- `shadow-security-elevated`

---

## Existing Utility Classes

Prefer existing utilities from `apps/web/app/globals.css`.

Use these where appropriate:

- `btn-primary`
- `btn-secondary`
- `btn-ghost`
- `btn-amber`
- `input-modern`
- `input-compact`
- `card-wireframe`
- `card-elevated`
- `card-dashboard`
- `page-title`
- `section-title`
- `label-text`
- Existing badge classes

Do not create new global CSS utilities unless the pattern is repeated across multiple screens and clearly belongs in the design system.

---

# Visual Consistency Rules

Every page should feel like it belongs to the same product.

Maintain consistency in:

- Page headers
- Button styles
- Card spacing
- Border radius
- Shadows
- Form fields
- Table layouts
- Badge styles
- Empty states
- Error messages
- Filter sections
- Action bars
- Modal layouts
- Mobile behaviour

If a new component looks visually different from the rest of Plethora, adjust it to match existing patterns.

---

# Page Structure Pattern

Dashboard pages should usually follow this structure:

1. Page header
  - Clear title
  - Short helper text
  - Primary action button, if needed
2. Summary or key metrics
  - Cards for important numbers
  - Concise labels
  - Meaningful status indicators
3. Filters/search section
  - Search input
  - Status filters
  - Date filters
  - Reset filters action where useful
4. Main content
  - Table, list, grid, or workflow panel
  - Clear row actions
  - Status badges
  - Pagination or result count where needed
5. Supporting details
  - Secondary panels
  - Recent activity
  - Notes
  - Contextual help

Do not place dense controls randomly on the screen. Group related actions inside cards or structured sections.

---

# Layout Principles

Use mobile-first Tailwind design.

Start with the smallest screen and enhance upward using responsive modifiers.

Follow these principles:

- Keep dashboard content scannable.
- Use cards to group related data and actions.
- Keep the primary action visually obvious.
- Avoid having too many competing buttons.
- Use whitespace intentionally.
- Keep content aligned to a clean grid.
- Avoid unnecessary visual noise.
- Do not allow pages to feel cramped.
- Do not allow large screens to feel empty or stretched.
- Keep important actions near the content they affect.

---

# Spacing And Alignment

Pay close attention to spacing.

Use consistent spacing patterns:

- Page sections should have clear vertical rhythm.
- Cards should have consistent padding.
- Buttons in a group should align properly.
- Form labels and inputs should align neatly.
- Tables should have readable row height.
- Icons and text should be vertically centred.
- Page headers should not feel disconnected from the content.

Avoid:

- Random margins
- Misaligned cards
- Uneven button heights
- Floating controls
- Dense forms with no breathing room
- Headers that are too large for the screen
- Cards touching screen edges on mobile

---

# Component Architecture

Use this structure:

- Keep route orchestration in `app/**/page.tsx`
- Move reusable or dense UI into `apps/web/components/**`
- Use small focused components when a page becomes hard to scan
- Keep UI components typed and predictable

Use `"use client"` only when required for:

- React hooks
- Browser APIs
- Client-side state
- Client context
- Interactive components

Do not turn server components into client components unnecessarily.

---

# Form Design

Forms must be clear, calm, and easy to complete.

Follow existing form patterns:

- Use visible labels
- Use stable `id` and `htmlFor`
- Use `input-modern` or `input-compact`
- Provide clear placeholder text only where useful
- Show validation messages close to the field
- Show disabled and submitting states
- Prevent double submissions
- Make required fields obvious
- Group related fields in cards or sections

Form buttons should be clear:

- Primary action: strong visual treatment
- Cancel/back action: secondary or ghost
- Destructive action: red/destructive styling

Do not rely only on placeholder text as the label.

---

# Table And List Design

For data-heavy screens, prioritise readability.

Tables/lists should include:

- Clear column headings
- Compact metadata
- Readable status badges
- Row actions that are easy to find
- Empty states
- Loading states
- Error states
- Bulk action affordances where useful
- Search/filter reset where useful
- Mobile-friendly layout

For long values:

- Names should wrap or truncate intentionally
- Emails should truncate cleanly
- IDs should use mono text where useful
- Dates should be readable
- Status should include text, not colour only

Do not create tables that overflow horizontally on mobile without a deliberate responsive strategy.

---

# Badge And Status Design

Statuses must be readable and consistent.

Use badges for:

- Active/inactive
- Pending/approved/rejected
- Draft/published
- Paid/unpaid
- Present/absent
- Verified/unverified
- Synced/failed

Do not rely on colour alone. Always include text.

Use red only for actual error, danger, failed, rejected, or destructive states.

---

# Empty States

Every empty state should explain:

- What is missing
- Why it matters
- What the user can do next

A good empty state should include:

- Short title
- Helpful one-line description
- Primary action if appropriate

Avoid empty states that only say “No data found.”

Example:

Instead of:

`No guards found.`

Use:

`No guards added yet.`  
`Add guards to start building rosters, tracking attendance, and preparing payroll.`

---

# Loading States

Use loading states that preserve layout where possible.

Prefer:

- Skeleton cards
- Disabled buttons with loading text
- Table skeleton rows
- Inline loading indicators

Avoid:

- Blank pages
- Layout jumps
- Buttons that stay clickable while submitting
- Generic loading states that hide too much context

---

# Error States

Error states should be clear and useful.

They should explain:

- What failed
- What the user can try next
- Whether the issue is temporary or permission-related

Use red carefully and professionally.

Avoid technical raw errors unless the page is specifically for developers/admins.

---

# Permission And Disabled States

Where permissions affect UI:

- Reuse existing permission checks
- Do not duplicate access logic unnecessarily
- Hide actions the user cannot perform where appropriate
- Disable actions where the user needs to understand that the action exists but is unavailable
- Provide short helper text explaining why an action is disabled

Do not allow users to click actions that will obviously fail.

---

# Accessibility And Interaction

Every interactive element must be accessible.

Requirements:

- Buttons must be keyboard reachable
- Use `button type="button"` unless submitting a form
- Icon-only buttons must have `aria-label`
- Maintain visible focus states
- Do not remove outlines without replacing them
- Use semantic headings in proper order
- Keep page titles unique
- Use labels for form controls
- Do not rely on colour alone
- Destructive actions must be visually distinct and confirmed where needed

Modals and dropdowns must not trap users or break keyboard navigation.

---

# Responsive Checklist

Before finishing a UI change, check the page mentally and structurally across screen sizes.

## Small screens

Confirm:

- No horizontal overflow
- Cards have enough padding
- Tap targets are comfortable
- Buttons stack cleanly
- Tables/lists remain usable
- Modals do not overflow off-screen
- Navigation does not cover important content
- Long names/emails/IDs do not break the layout

## Medium screens

Confirm:

- Grids collapse gracefully
- Filters remain usable
- Cards align properly
- Actions remain easy to reach

## Large screens

Confirm:

- Content has sensible max width
- Layout does not become too sparse
- Tables remain readable
- Metrics and cards align cleanly
- Important actions are not too far away from the related content

---

# Copywriting Guidelines

Plethora copy should be concise, operational, and specific.

Use simple language.

Good examples:

- `Add guard`
- `Create roster`
- `Approve timesheet`
- `Export payroll`
- `Review attendance`
- `No shifts scheduled yet`
- `This guard has no attendance records for the selected period`

Avoid:

- Marketing language
- AI clichés
- Overly dramatic copy
- Vague labels like `Submit`, `Continue`, or `Manage` when a more specific action exists

Button text should describe the action clearly.

---

# Icon Rules

Use inline SVGs or existing icon patterns.

Do not add new icon libraries for small UI needs.

Icons should:

- Support the label
- Not replace important text
- Have accessible labels where needed
- Match the product’s professional tone

Avoid decorative icon overload.

---

# Dashboard Quality Bar

A polished Plethora dashboard page should have:

- A strong, clear page title
- Helpful but short description
- One obvious primary action
- Well-grouped cards
- Clean spacing
- Consistent buttons
- Clear filters
- Good empty/loading/error states
- Responsive layout
- Accessible controls
- No random design language
- No unnecessary dependencies

If the page looks like it was copied from another product, adjust it to feel like Plethora.

---

# Do Not Do This

Avoid:

- Adding unrelated palettes
- Adding new fonts
- Adding new icon libraries
- Adding new CSS frameworks
- Adding new global utilities for one-off use
- Mixing unrelated refactors into UI polish work
- Duplicating API or permission logic
- Making everything a client component
- Creating visually inconsistent cards/buttons
- Removing accessibility behaviour
- Hiding errors without explanation
- Leaving mobile layout untested
- Allowing horizontal overflow
- Making destructive actions look like normal actions

---

# Implementation Discipline

When editing:

1. Make the smallest useful change.
2. Reuse existing design tokens and components.
3. Keep the page structure easy to scan.
4. Improve workflow clarity.
5. Add missing UI states.
6. Keep TypeScript types clean.
7. Avoid unrelated refactors.
8. Keep components focused.
9. Make the design feel consistent with Plethora.
10. Verify the change.

---

# Verification

For meaningful UI edits, run the narrowest useful check.

Use:

```bash
npm run build --workspace=web

```

For compile and Next.js validation.

Use:

```bash
npm run lint --workspace=web

```

When lint behaviour is relevant or when the change touched many TSX files.

If checks are not run, clearly state why and mention the best command the user should run.

---

# Final Response Requirements

When reporting back after UI work, include:

1. What was improved
2. Which files changed
3. Which UI states were handled
4. Whether verification was run
5. If not run, the exact command the user should run

Keep the response clear and practical.

---

# Design Standard

The final result should look like it belongs inside one polished Plethora product.

It must be:

- Consistent
- Responsive
- Accessible
- Professional
- Clean
- Operational
- Easy to use
- Aligned with the existing Plethora brand system

Do not just make the UI different. Make it better, clearer, and more useful.