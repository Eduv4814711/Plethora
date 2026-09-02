# Plethora Brand Identity & Guidelines

**Version:** 1.0  
**Status:** Brand standardisation baseline  
**Scope:** Plethora product, website, documents, presentations, social media and marketing  
**Principle:** Standardisation and refinement, not unnecessary redesign.

---

## 1. Brand at a Glance

Plethora is a South African B2B workforce operations platform built specifically for private security companies. It connects the operational chain from guards, sites, posts and shifts through attendance, approvals, payroll and management reporting.

Plethora is not a generic HR application. It is an **operational system of record for private security companies**.

### Primary brand line

> **Every post covered, every hour accounted for.**

This is the primary brand line because it expresses the two operational truths Plethora must help a security company prove: coverage and accountable time.

### Supporting campaign line

> **From the gate to the payslip.**

Use this when explaining the end-to-end flow from front-line operations into payroll.

### Primary value proposition

**Know what is happening across every site, connect actual work to accurate payroll, and keep a reliable operational record without rebuilding the same information in spreadsheets, messages and separate systems.**

---

## 2. Existing Brand Audit

### 2.1 What is already strong

The application already contains a coherent operational design concept described in code as **“the duty board”**:

- Graphite chrome and structure
- Paper-like work surfaces
- Orange reserved for meaningful signal states
- Green reserved for covered, approved and positive operational state
- Space Grotesk for display hierarchy
- Archivo for UI/body text
- JetBrains Mono for operational/data labels
- Restrained shadows and radii
- A status-spine device for rows/cards/modules
- Tabular numerals for time and operational figures
- Explicit focus and state treatments

These decisions should be retained and formalised.

### 2.2 Existing product colours

| Role | Existing value | Decision |
|---|---:|---|
| Plethora Signal Orange | `#F97A08` | **Retain as canonical brand orange** |
| Graphite | `#171A1F` | **Retain as canonical dark/structure colour** |
| Success Green | `#0E8A5F` | **Retain** |
| Canvas | `#F5F6F8` | **Retain** |
| White/Paper | `#FFFFFF` | **Retain** |
| Error Red | `#C42B1C` | **Retain as semantic error** |

### 2.3 Existing typography

| Use | Existing product font | Decision |
|---|---|---|
| Display/headings | Space Grotesk | **Retain** |
| UI/body | Archivo | **Retain** |
| Operational/data | JetBrains Mono | **Retain** |

### 2.4 Main inconsistency: landing page

The landing-page repository currently uses a separate visual system including:

- `#FF9800` orange instead of `#F97A08`
- `#191221` plum-black instead of product graphite
- Schibsted Grotesk, Public Sans and IBM Plex Mono instead of product typography
- Highly rounded pill CTAs instead of the product's restrained 8px/14px geometry
- A separate near-white/plum visual language

This is visually considered, but it fragments the brand. The website should progressively move toward the product's canonical system. Do not perform a breaking redesign in one release; migrate tokens, typography and reusable components deliberately.

### 2.5 Brand decisions: retain, refine, standardise, remove, expand

**Retain**
- Existing logo mark and core logo artwork
- `#F97A08` orange
- `#171A1F` graphite
- `#0E8A5F` success green
- Space Grotesk / Archivo / JetBrains Mono
- Duty-board concept
- Status spine
- Paper/canvas surface model
- Restrained shadows and radii
- “Every post covered, every hour accounted for.”

**Refine**
- Logo naming and variant packaging
- Marketing typography so it matches product typography
- Website CTA geometry
- Semantic state colours and accessibility documentation
- Chart colour sequencing
- Marketing imagery and photography direction

**Standardise**
- Colour tokens between repositories
- Icon family
- Wordmark treatment
- Favicon/app icon
- Social avatars and Open Graph graphics
- Document/report templates
- Terminology for guard, site, post, shift, attendance and payroll states

**Remove over time**
- Competing website font stack
- Competing `#FF9800` orange token
- Arbitrary gradients
- Decorative orange backgrounds that do not communicate state
- Random icon families
- Consumer-app pill styling where operational controls need structure

**Expand**
- Photography library
- Presentation template
- Proposal/document system
- Social templates
- Dark-mode specifications
- Brand accessibility checklist

---

# 3. Strategic Brand Foundation

## 3.1 Brand purpose

Plethora exists to give private security companies a dependable operational record of who should be where, who was actually there, what happened, and what should be paid.

## 3.2 Vision

A private security industry where workforce operations are visible, accountable and connected from the site level to management and payroll.

## 3.3 Mission

Build practical software that brings guards, sites, posts, rosters, attendance, incidents, compliance records and payroll into one coherent operating system for security companies.

## 3.4 Brand promise

**Plethora helps you know whether the work was covered, account for the time worked, and carry trusted operational records into payroll and management decisions.**

## 3.5 Positioning statement

For South African private security companies that need tighter control over distributed workforces, Plethora is a workforce operations platform that connects guards, sites, rosters, attendance and payroll in one operational record. Unlike generic HR systems, Plethora is designed around the realities of posts, shifts, site coverage, approvals and security-sector administration.

## 3.6 Category language

Preferred:
- Workforce operations platform for security companies
- Security workforce operations platform
- Operational system of record for private security companies

Avoid leading with:
- ERP
- HR software
- Workforce management software

Those terms may be used secondarily when useful for procurement or search, but they do not express the distinction clearly enough by themselves.

---

# 4. Target Customer

## 4.1 Buyer

Typical buyers:
- Managing Director / Owner
- Operations Director / Operations Manager
- General Manager
- Financial or Payroll decision-maker

Buyer communication should emphasise:
- visibility across sites
- management control
- reduced operational leakage
- trustworthy records
- payroll confidence
- accountability
- scale
- compliance support

## 4.2 Administrator

Typical administrators:
- Operations administrators
- HR teams
- Payroll administrators
- Control room staff
- Compliance staff
- Rostering coordinators

Administrator communication should emphasise:
- fewer duplicate captures
- clear workflows
- approvals
- exceptions
- reliable month-end data
- speed
- traceability

## 4.3 End user

Typical end users:
- Security guards
- Site supervisors
- Area supervisors

End-user communication should emphasise:
- simple actions
- clear shift/site information
- understandable statuses
- low-friction mobile interactions
- trusted personal records

Do not expose internal SaaS or technical vocabulary where a direct operational phrase will work.

---

# 5. Brand Personality

## 5.1 Operational

Plethora is grounded in actual security work: sites, posts, shifts, handovers, time and month-end. Visuals and language should begin with the operation, not abstract technology.

## 5.2 Dependable

The interface, documents and copy should feel stable and predictable. State, totals and actions should never be ambiguous.

## 5.3 Disciplined

Layouts use clear grids, restrained colour and consistent terminology. Decorative choices must earn their place.

## 5.4 Confident

Use direct language and strong hierarchy without shouting. Avoid inflated claims and over-designed effects.

## 5.5 Intelligent

Plethora should make complex operational information understandable. Intelligence is expressed through clarity, prioritisation and useful context, not futuristic imagery.

## 5.6 Practical

Every feature, graphic and message should connect to a real operational job or decision.

## 5.7 Human

Plethora supports security professionals; it does not try to replace or diminish them. People remain central to photography, onboarding and product language.

### Plethora should not feel

- playful or childish
- militarised
- aggressive or intimidating
- cyberpunk/futuristic
- consumer-fintech-like
- generic corporate HR software
- excessively soft, bubbly or decorative

---

# 6. Brand Archetype

## Primary: The Ruler

The Ruler expresses order, control, standards, accountability and dependable oversight. This aligns with the buyer's need to know what is happening across a distributed operation.

## Secondary: The Guardian

The Guardian adds responsibility, protection and reliability without pushing the brand into military or fear-based territory.

### Practical combination

**Ruler structure + Guardian responsibility.**

Plethora should feel like a calm operating centre: ordered, aware and accountable.

---

# 7. Visual Identity

## 7.1 Core colour principle

> **Orange is a signal, not wallpaper.**

Orange should identify Plethora while retaining operational meaning.

Use orange for:
- active state
- selected module
- focus ring
- live activity
- operational attention
- one high-priority action
- selected chart series
- small brand identifiers

Avoid orange for:
- large default backgrounds
- every CTA
- success states
- decorative gradients
- full dashboard chrome

## 7.2 Canonical palette

### Brand and neutrals

| Token | HEX | RGB | Usage |
|---|---|---|---|
| `brand.signal` | `#F97A08` | 249, 122, 8 | Brand signal, live/active/focus |
| `brand.signal.deep` | `#A8480A` | 168, 72, 10 | Accessible orange text, warning emphasis |
| `brand.signal.wash` | `#FFF6EC` | 255, 246, 236 | Orange wash/background |
| `graphite.950` | `#0E1013` | 14, 16, 19 | Deep dark |
| `graphite.900` | `#171A1F` | 23, 26, 31 | Primary graphite / chrome |
| `graphite.800` | `#1F242B` | 31, 36, 43 | Dark surface |
| `graphite.700` | `#2E343D` | 46, 52, 61 | Hover / secondary dark |
| `graphite.600` | `#434A55` | 67, 74, 85 | Secondary text |
| `graphite.500` | `#5A626E` | 90, 98, 110 | Muted text |
| `graphite.400` | `#7C8593` | 124, 133, 147 | Faint text |
| `graphite.300` | `#AFB6C1` | 175, 182, 193 | Strong border |
| `graphite.200` | `#D3D7DE` | 211, 215, 222 | Medium border |
| `graphite.100` | `#E8EAEE` | 232, 234, 238 | Light border |
| `graphite.50` | `#F5F6F8` | 245, 246, 248 | Canvas |
| `paper` | `#FFFFFF` | 255, 255, 255 | Primary work surface |

### Semantic colours

| Token | HEX | RGB | Usage |
|---|---|---|---|
| `success.500` | `#0E8A5F` | 14, 138, 95 | Covered, approved, complete, on duty |
| `success.50` | `#ECFBF4` | 236, 251, 244 | Success wash |
| `warning.500` | `#F97A08` | 249, 122, 8 | Attention/waiting where orange signal is appropriate |
| `warning.700` | `#A8480A` | 168, 72, 10 | Accessible warning text |
| `error.600` | `#C42B1C` | 196, 43, 28 | Error, uncovered critical state, destructive alert |
| `info.600` | `#2563A6` | 37, 99, 166 | Neutral information state where orange would imply action |
| `info.50` | `#EFF6FF` | 239, 246, 255 | Information wash |

### Accessible combinations

Preferred combinations:
- Graphite `#171A1F` on white or `#F5F6F8`
- White on `#171A1F`
- Deep orange `#A8480A` on white or `#FFF6EC` for text
- Graphite `#171A1F` on brand orange `#F97A08` for filled orange controls
- Deep success green on success wash for compact statuses

Do not assume white text on full-saturation orange is accessible at small sizes. Use graphite text on the orange signal surface.

## 7.3 Dark mode

Dark mode should be an inversion of surface hierarchy, not a new palette.

- Background: `#0E1013`
- Chrome/surfaces: `#171A1F` / `#1F242B`
- Elevated surface: `#2E343D` where necessary
- Primary text: near-white
- Muted text: graphite 300–400 range
- Borders: graphite 700–600 range
- Signal orange remains `#F97A08`
- Success remains recognisable but verify contrast per component

---

# 8. Typography

## 8.1 Typeface roles

### Space Grotesk — display

Use for:
- marketing headlines
- page titles
- H1–H3
- major metrics
- presentation titles

Characteristics: compact, modern, authoritative and distinctive without feeling futuristic.

### Archivo — primary UI/body

Use for:
- body text
- UI controls
- navigation
- forms
- tables
- documents
- long descriptions

### JetBrains Mono — operational/data accent

Use sparingly for:
- shift codes
- timestamps
- IDs/reference numbers
- operational labels
- section eyebrows
- time markers
- compact technical or audit values

Do **not** use JetBrains Mono for general body copy, long marketing text or full interfaces.

## 8.2 Recommended type scale

| Style | Typeface | Size / line-height | Weight |
|---|---|---|---|
| Marketing Display | Space Grotesk | 56–80 / 0.98–1.05 | 600–700 |
| H1 / Page title | Space Grotesk | 28–40 / 1.10 | 600 |
| H2 | Space Grotesk | 24–32 / 1.15 | 600 |
| H3 | Space Grotesk | 20–24 / 1.20 | 600 |
| H4 | Archivo | 16–18 / 1.30 | 600–700 |
| Body | Archivo | 16 / 1.50 | 400 |
| Small body | Archivo | 14 / 1.45 | 400–500 |
| Label | Archivo | 12 / 1.30 | 600 |
| Button | Archivo | 14 / 1.00 | 600 |
| Caption | Archivo | 12 / 1.40 | 400–500 |
| Operational label | JetBrains Mono | 11 / 1.30 | 500 |
| Table data | Archivo + tabular nums | 13–14 / 1.35 | 400–600 |
| Time / shift code | JetBrains Mono | 12–14 / 1.30 | 500–600 |

Use modest negative tracking on large Space Grotesk headings. Avoid aggressive tracking on body text.

---

# 9. Logo System

## 9.1 Existing asset inventory

### Product repository

| Asset | Location | Purpose | Recommendation |
|---|---|---|---|
| `Plethora Logo SVG new.svg` | `apps/web/public/` | Full logo artwork | Retain temporarily; rename in future asset cleanup |
| `plethora-logo.svg` | `apps/web/public/` | Full logo | Retain as canonical candidate |
| `plethora-logo-header.svg` | `apps/web/public/` | Header variation | Retain pending visual diff/consolidation |

### Landing-page repository

| Asset | Location | Purpose | Recommendation |
|---|---|---|---|
| `plethora-logo.svg` | `assets/` | Full logo | Retain; align with canonical export |
| `plethora-logo-header.svg` | `assets/` | Header variation | Retain pending consolidation |
| `plethora-mark.svg` | `assets/` | Standalone mark / favicon | **Retain and promote to canonical mark** |

The standalone mark is an orange rounded square containing two opposing white triangular forms meeting at a centre point. The landing page interprets this centre as a handover; that is a useful supporting narrative, but it should remain secondary to the practical identity.

## 9.2 Required canonical exports

Create a single source folder in a future asset-cleanup task:

- `plethora-logo-horizontal-dark.svg`
- `plethora-logo-horizontal-light.svg`
- `plethora-mark.svg`
- `plethora-mark-mono-dark.svg`
- `plethora-mark-mono-light.svg`
- `favicon.svg`
- `favicon-32.png`
- `apple-touch-icon.png`
- `app-icon-512.png`

Do not redesign the mark during consolidation.

## 9.3 Clear space

Use the mark's centre-form width as a practical clear-space unit. Keep at least **0.5× the mark width** around the standalone mark, and at least the mark's internal white-space equivalent around the full lockup.

## 9.4 Minimum size

- Standalone digital mark: 24px minimum; 32px preferred
- Full horizontal logo digital: 120px minimum width
- Print: test legibility below 25mm and use mark-only where the wordmark becomes fragile

## 9.5 Backgrounds

Preferred:
- White/paper
- Graphite
- Very light neutral canvas
- Photography with a deliberate quiet area and sufficient contrast

Avoid placing the logo over visually busy photography or colours that reduce orange/white contrast.

## 9.6 Incorrect use

Do not:
- recolour the mark arbitrarily
- stretch or skew
- rotate the logo
- add glow/drop shadow
- use gradients inside the mark
- place the full logo at unreadably small sizes
- alter the triangle geometry
- create ad-hoc wordmarks in unrelated typefaces

---

# 10. Photography Direction

## 10.1 Subject matter

Photography should depict the real South African private security environment:

- security guards on legitimate commercial/residential/industrial sites
- supervisors conducting checks
- managers reviewing operations
- control rooms
- warehouses and logistics sites
- hospitals
- retail centres
- residential estates
- commercial offices
- teams using mobile devices

## 10.2 Human direction

People should look:
- competent
- professional
- calm
- approachable
- alert
- realistic

Uniforms should appear authentic to private security work. Include diverse South African professionals and real environments.

## 10.3 Avoid

- guns as the focal point
- exaggerated tactical poses
- police or military symbolism
- American-style generic guard imagery
- masks/hoods associated with threat imagery
- neon cyber interfaces
- floating holograms
- staged handshake clichés
- generic call-centre stock imagery

Technology should support the security professional rather than visually replace them.

---

# 11. Illustration & Graphic Language

## 11.1 Core idea

**People + sites + shifts + time + accountability.**

Graphic language should borrow from operational artefacts rather than abstract SaaS decoration.

Recommended devices:
- roster grids
- shift bands
- duty timelines
- coverage blocks
- site/post nodes
- handover points
- attendance rows
- status spines
- audit lines
- compact operational annotations

## 11.2 Pattern system

Use structured grid patterns at low contrast. Patterns may reference:
- 12-hour shift divisions
- day/night handovers
- site/post cells
- active/inactive coverage blocks

Never let a pattern compete with actual operational data.

## 11.3 Data visualisation

Charts should:
- prefer direct labels where possible
- use orange for the primary/selected/live series
- use graphite tones for comparison series
- use green for successful/covered outcomes
- use red only for genuine critical/error conditions
- avoid rainbow palettes
- maintain tabular numerals and concise legends

---

# 12. Iconography

Use one outline icon family across the product and brand system. Where the product already relies on a selected library, consolidate around that family before introducing new icons.

Recommended rules:
- 1.75–2px stroke at 24px
- rounded joins, restrained rounded caps
- 16px compact UI size
- 20px default UI size
- 24px navigation/marketing utility size
- no filled cartoon icons mixed with outline icons

### Domain icon map

| Concept | Suggested metaphor |
|---|---|
| Employees / guards | User / badge |
| Sites | Building / map pin |
| Posts | Pin + station/checkpoint |
| Roster | Calendar / grid |
| Attendance | Clock + check |
| Payroll | Payslip / wallet / calculator |
| Leave | Calendar minus / palm not recommended |
| Incidents | Alert triangle / clipboard alert |
| Documents | File text |
| Reports | Chart / document chart |
| Academy | Graduation cap |
| WhatsApp | Official WhatsApp brand icon where permitted |
| Compliance | Shield check |
| Settings | Sliders / gear |

Active icons may use orange; inactive icons should remain neutral graphite.

---

# 13. UI Brand Principles

## 13.1 Operational clarity over decoration

Every screen exists to help someone understand or act on an operation.

## 13.2 Orange means something

Orange is reserved for live, selected, waiting, focused or deliberately emphasised actions.

## 13.3 State must always be clear

Covered, uncovered, approved, pending, on-duty, off-duty and problematic states should never depend on colour alone. Pair colour with text, icon or shape.

## 13.4 Dense without becoming confusing

Security operations are data-heavy. Use hierarchy, alignment, grouping and progressive disclosure rather than simply adding empty space.

## 13.5 The duty board is the visual model

Plethora should feel like a modern operating board: calm structure, visible status and accountable time.

## 13.6 One hierarchy, one vocabulary

The same status should use the same label, colour and component across roster, attendance, payroll and reports.

## 13.7 Primary actions are deliberate

Default primary controls may be graphite. Reserve orange filled actions for moments that deserve operational attention or confirmation.

## 13.8 Motion should communicate change

Use subtle motion for state changes and live activity. Avoid decorative animation. Honour reduced-motion preferences.

---

# 14. Brand Voice

Plethora should sound like an experienced operations partner.

## 14.1 Voice traits

- Clear
- Confident
- Concise
- Knowledgeable
- Practical
- Professional
- Human

## 14.2 Writing rules

- Lead with the operational outcome.
- Prefer concrete nouns: site, post, shift, guard, timesheet, payroll.
- Prefer active verbs: cover, assign, approve, reconcile, account, review.
- Use short sentences in UI copy.
- Explain compliance precisely; do not overclaim legal compliance guarantees.
- Avoid fear-based selling.
- Avoid generic transformation language.

## 14.3 Good copy vs avoid

| Good Plethora copy | Avoid |
|---|---|
| “See uncovered posts before the shift starts.” | “Revolutionise workforce optimisation.” |
| “Turn approved attendance into payroll-ready hours.” | “Unlock seamless payroll synergies.” |
| “Know who is assigned to every site.” | “Gain 360-degree human-capital visibility.” |
| “Review exceptions before month-end.” | “Harness next-generation intelligent automation.” |
| “One operational record from roster to payslip.” | “The future of HR is here.” |

---

# 15. Messaging Architecture

## One-line description

**Plethora is a workforce operations platform that connects guards, sites, rosters, attendance and payroll for private security companies.**

## 30-second description

Plethora helps private security companies run the workforce operation from the site level through to payroll. Teams can manage guards and documents, create sites and posts, build rosters, capture attendance and timesheets, manage approvals and incidents, and carry trusted hours into payroll and reporting from one operational record.

## Website hero headline

**Every post covered. Every hour accounted for.**

## Website subheading

**Run guards, sites, rosters, attendance and payroll from one operational system built for private security companies.**

## Short product description

**Security workforce operations, from roster to payroll.**

## Longer company description

Plethora is a South African B2B SaaS platform for private security companies. It brings employee records, security sites and posts, rostering, attendance, leave, incidents, approvals, payroll, training, compliance records and reporting into one operational system. Plethora is designed around the realities of guarding operations so management can see what is happening across sites, administrators can reduce duplicate capture, and payroll can work from more reliable operational records.

## LinkedIn company description

Plethora builds workforce operations software for private security companies. Our platform connects guards, sites, posts, rostering, attendance, payroll, compliance records, incidents, training and reporting so security teams can manage operations from the gate to the payslip. Built in South Africa for the realities of distributed guarding operations.

## Sales pitch

Security companies often run the same operation across rosters, WhatsApp messages, attendance sheets, spreadsheets and payroll files. Plethora connects those steps. You can see who is assigned to every post, capture what actually happened, review exceptions and turn approved operational data into payroll-ready records without rebuilding the month from scratch.

## Software directory description

Plethora is a security workforce operations platform for private security companies. It combines guard and employee records, sites and posts, rostering, attendance, leave, incidents, approvals, academy/training, compliance records, documents, reporting and payroll workflows in one system.

## Email signature descriptor

**Workforce operations for private security companies.**

## Social bio

**Security workforce operations. Guards, sites, shifts, attendance and payroll — connected.**

## Tagline hierarchy

1. **Primary:** Every post covered, every hour accounted for.
2. **Supporting/end-to-end:** From the gate to the payslip.
3. **Campaign/feature:** Cover the post. The rest follows.

“Cover the post. The rest follows.” is a strong campaign headline for explaining data flow, but it should not replace the primary corporate line.

---

# 16. Brand Pillars

## 16.1 Visibility

**Meaning:** Know what is happening across the workforce and sites.  
**Benefit:** Fewer blind spots and faster operational decisions.  
**Proof:** Site/post views, roster coverage, attendance status, dashboards, reports.  
**Message:** “See the operation before it becomes a month-end problem.”

## 16.2 Accountability

**Meaning:** Maintain a traceable record of assignment, attendance, approvals and changes.  
**Benefit:** Better confidence when resolving disputes or reviewing exceptions.  
**Proof:** Audit trails, approval records, attendance, documents, incidents.  
**Message:** “Every hour should have a record behind it.”

## 16.3 Control

**Meaning:** Bring distributed operations into one structured workflow.  
**Benefit:** Management can act on exceptions instead of chasing information.  
**Proof:** Sites/posts, roster management, approvals, tasks, incidents.  
**Message:** “Run the operation from one duty board.”

## 16.4 Accuracy

**Meaning:** Reduce repeated manual capture between operations and payroll.  
**Benefit:** Cleaner month-end inputs and fewer avoidable corrections.  
**Proof:** Attendance-to-hours workflows, approvals, payroll calculations and reports.  
**Message:** “Carry trusted operational data into payroll.”

## 16.5 Compliance-ready records

**Meaning:** Keep the records and workflows needed to support security-sector administration and internal controls.  
**Benefit:** Better preparedness for reviews, audits and reporting.  
**Proof:** Employee documents, compliance records, training, audit trails, reports.  
**Message:** “Keep the record with the operation.”

Avoid claiming that software alone guarantees regulatory compliance.

---

# 17. Brand Applications

## Web application
- Graphite chrome + white work surface
- Signal orange for active/attention/focus
- Status spines for operational rows/cards where useful
- Dense but ordered data

## Mobile
- Prioritise shift/site identity, time, status and one primary action
- Minimum 44px touch targets
- Avoid dense desktop tables collapsed without rethinking hierarchy

## Website
- Migrate to canonical product palette and typography
- Use operational timelines/coverage graphics as hero/supporting devices
- Use real South African security photography

## Sales presentations
- Dark graphite title slides
- White/paper content slides
- Orange as a small navigational or emphasis device
- Show product screenshots and operational diagrams more than abstract illustrations

## Proposals / invoices / reports / payslips
- Professional document-first layout
- Strong company/client metadata hierarchy
- Minimal colour usage
- Orange only for Plethora identity or selected highlights
- Never let the software brand overpower the customer's own company identity on customer-facing operational documents

## Email
- Plain, legible signatures
- Logo + descriptor + contact data
- No decorative banners by default

## Social media
- Strong headline + one operational visual idea
- 1–2 brand colours per graphic
- Product UI crops, real people and useful insights

## Events / exhibition stands
- Lead with the primary line
- Use one strong guard/site image
- Show the roster-to-payroll operating chain
- Avoid walls of feature icons

## Training / manuals
- Prioritise screenshots, annotated steps and consistent terminology
- Use orange callouts sparingly for “do this” moments

---

# 18. Social Media Identity

## Platform roles

**LinkedIn:** buyer education, product milestones, industry operations, customer outcomes.  
**YouTube:** demos, explainers, implementation stories, company journey.  
**Instagram:** visual brand building, people, product moments, startup journey.  
**Facebook:** practical updates, customer/community reach, educational content.

## Content categories

1. Product
2. Security operations education
3. Industry insights
4. Product development / build journey
5. Customer stories
6. Operational tips
7. Company journey

## Social visual template

- Graphite or paper background
- Small orange signal device
- Space Grotesk headline
- Archivo supporting text
- Optional mono timestamp/operational code
- One product crop, photo or structured graphic
- Consistent logo placement

Avoid turning every tile orange.

---

# 19. Brand Do's and Don'ts

## Do

- Use graphite as the structural base
- Use orange to signal what matters
- Use real security operations as subject matter
- Keep layouts structured and calm
- Use the canonical type stack
- Use consistent operational terms
- Use green for successful/covered state
- Design data for quick scanning
- Preserve strong customer branding on their generated documents

## Don't

- Flood dashboards or documents with orange
- Introduce random gradients
- Mix unrelated font families
- Use tactical/military aesthetics
- Use cyberpunk security imagery
- Use excessively rounded consumer-app cards and controls
- Add heavy/glowing shadows
- Mix icon families
- Use generic Western/American guard stock imagery as the default
- Call Plethora a generic HR platform
- Change terminology between modules without a product reason

---

# 20. Design Tokens

These tokens map to the existing Tailwind direction and should become the shared vocabulary across product and marketing repositories.

## Colour tokens

```text
color.brand.signal       #F97A08
color.brand.signalDeep   #A8480A
color.brand.signalWash   #FFF6EC
color.graphite.950       #0E1013
color.graphite.900       #171A1F
color.graphite.800       #1F242B
color.graphite.700       #2E343D
color.graphite.600       #434A55
color.graphite.500       #5A626E
color.graphite.400       #7C8593
color.graphite.300       #AFB6C1
color.graphite.200       #D3D7DE
color.graphite.100       #E8EAEE
color.graphite.50        #F5F6F8
color.paper              #FFFFFF
color.success            #0E8A5F
color.error              #C42B1C
color.info               #2563A6
```

## Typography tokens

```text
font.display  "Space Grotesk", "Archivo", system-ui, sans-serif
font.body     "Archivo", system-ui, sans-serif
font.mono     "JetBrains Mono", ui-monospace, monospace
```

## Radius

```text
radius.sm       4px
radius.default  8px
radius.lg       14px
radius.full     9999px  // badges/chips only; not default cards/buttons
```

## Spacing

Use a 4px base scale:

```text
space.1  4px
space.2  8px
space.3  12px
space.4  16px
space.5  20px
space.6  24px
space.8  32px
space.10 40px
space.12 48px
space.16 64px
```

## Borders

```text
border.light   1px #E8EAEE
border.medium  1px #D3D7DE
border.strong  1px #AFB6C1
focus          2px #F97A08 + 2px offset
```

## Shadows

```text
shadow.card
0 1px 2px rgb(23 26 31 / .05),
0 1px 3px -1px rgb(23 26 31 / .06)

shadow.cardHover
0 2px 4px -1px rgb(23 26 31 / .07),
0 6px 14px -6px rgb(23 26 31 / .12)

shadow.elevated
0 4px 8px -3px rgb(23 26 31 / .08),
0 18px 32px -14px rgb(23 26 31 / .22)
```

## Chart sequence

Recommended sequence:

1. `#F97A08` — primary/live
2. `#2E343D` — graphite comparison
3. `#0E8A5F` — positive/covered
4. `#5A626E` — neutral series
5. `#2563A6` — information
6. `#A8480A` — secondary orange/deep signal

Never use semantic red for a neutral categorical series.

---

# 21. Brand Asset Inventory Summary

## Product repo: `Eduv4814711/Plethora`

| Asset / system | Location | Status |
|---|---|---|
| Full logo export | `apps/web/public/Plethora Logo SVG new.svg` | Duplicate naming; consolidate |
| Full logo | `apps/web/public/plethora-logo.svg` | Recommended canonical candidate |
| Header logo | `apps/web/public/plethora-logo-header.svg` | Review against canonical candidate |
| Brand colours | `apps/web/tailwind.config.ts` | **Canonical** |
| Global brand/component rules | `apps/web/app/globals.css` | **Canonical** |
| Chart colours | `apps/web/lib/chart-theme.ts` | Retain / align to tokens |
| Auth brand line | `apps/web/app/(auth)/layout.tsx` | Retain |
| Product definition | `README.md` | Retain; align category wording over time |

## Landing repo: `Eduv4814711/Plethora-Landing-Page`

| Asset / system | Location | Status |
|---|---|---|
| Full logo | `assets/plethora-logo.svg` | Retain, consolidate export |
| Header logo | `assets/plethora-logo-header.svg` | Review duplication |
| Standalone mark | `assets/plethora-mark.svg` | **Retain / canonical mark** |
| Website visual tokens | `index.html` | **Migrate toward product system** |
| Website messaging | `index.html` | Retain strongest operational language; align tagline hierarchy |

No assets should be deleted until a canonical asset set has been visually verified and all references have been migrated.

---

# 22. Brand Gap Analysis

## Critical

1. **One canonical token source** across product and website
2. **Canonical logo package** with documented light/dark/mono variants
3. **Website typography and colour alignment** with product brand
4. **Accessibility verification** for semantic states, CTAs and dark mode
5. **Icon-family standardisation**
6. **Canonical product/category wording**
7. **Favicon/app-icon export set**

## Recommended

1. South African security photography library
2. Open Graph/social card templates
3. Presentation template
4. Proposal/document template
5. Email signature standard
6. Report/payslip visual spec
7. Social templates
8. Dark-mode component matrix
9. Product terminology glossary
10. Chart/data visualisation component standards

## Nice to have

1. Short motion-ident system for video
2. Exhibition/event system
3. Branded illustration pack
4. Customer co-branding rules
5. Internal swag/merchandise rules
6. Extended icon subset for marketing

---

# 23. Implementation Roadmap

## Phase 1 — standardise without visual disruption

- Adopt this document as canonical guidance
- Keep existing production code unchanged
- Confirm canonical logo export visually
- Create shared token reference
- Align future new work to canonical colours/type

## Phase 2 — website alignment

- Replace competing landing-page fonts with Space Grotesk / Archivo / JetBrains Mono
- Replace `#FF9800` with `#F97A08`
- Replace plum-black structural colours with graphite scale
- Reduce default pill geometry
- Preserve strong landing-page operational storytelling and timeline concepts

## Phase 3 — brand asset system

- Consolidate logo exports
- Create favicon/app/social assets
- Build photography library
- Build presentation/document/social templates

## Phase 4 — governance

- Add design-token package or documented shared token source
- Add accessibility checks to component review
- Add terminology and copy review to product QA
- Review brand guidelines quarterly as the product matures

---

# 24. Final Brand Standard

Plethora should look and sound like an **operational command platform for private security companies**.

When evaluating a new design or message, ask:

1. Does this clearly relate to security operations?
2. Can a managing director trust it?
3. Can a guard understand it?
4. Is the important state obvious?
5. Is orange being used as a signal rather than decoration?
6. Does it connect people, sites, shifts, time, accountability or payroll?
7. Does it feel like Plethora rather than a generic technology startup?

If the answer is yes, the work is likely on-brand.
