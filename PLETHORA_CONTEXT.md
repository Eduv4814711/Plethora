# PLETHORA ERP

## Master Product Context, Business Workflow and Engineering Instructions

You are working on **Plethora ERP**, a workforce operations, compliance, attendance, rostering and payroll platform primarily designed for the **South African private security industry**.

Before making significant changes to the application, understand the business context described in this document.

Plethora is not simply an employee-management application.

It is intended to become an operational system through which a security company can manage the complete journey from:

**Employee → Site → Roster → Attendance → Payroll → Compliance → Billing → Management Reporting**

The software should gradually become the operational source of truth for the organisation.

---

# 1. WHAT PLETHORA IS

Plethora is a B2B SaaS/ERP platform designed initially around the operating requirements of private security companies.

The system is being developed using a real security company as its live operating environment.

This means the application must solve real operational problems rather than theoretical software problems.

The platform should eventually allow a security company to manage:

* employees/security officers
* employee documentation
* regulatory information
* security grades
* employment information
* clients
* sites
* posts
* deployment requirements
* rostering
* shift allocation
* attendance
* site timesheets
* leave
* overtime
* payroll
* deductions
* regulatory contributions
* compliance
* incidents
* disciplinary documentation
* invoicing/billing
* operational reporting
* management dashboards
* audit trails

Plethora should reduce reliance on:

* spreadsheets
* handwritten rosters
* WhatsApp instructions
* paper attendance registers
* disconnected payroll calculations
* manual compliance registers
* duplicate data capture
* institutional knowledge stored in individual employees' heads

The long-term goal is for security companies to run significant portions of their workforce operations through Plethora.

---

# 2. CORE PRODUCT PRINCIPLE

Plethora must model the **actual operating flow of a security company**.

Do not build features in isolation.

Every major feature should connect logically to the information that came before it and the processes that follow it.

The central operational chain is:

Employee
↓
Employment & Compliance Profile
↓
Client
↓
Site
↓
Post
↓
Deployment Requirement
↓
Roster
↓
Scheduled Shift
↓
Actual Attendance / Site Timesheet
↓
Approved Hours
↓
Payroll
↓
Employee Payslip / Statutory Contributions
↓
Client Billing
↓
Operational / Financial / Compliance Reporting

Whenever you modify one section of this chain, consider how that modification affects the rest of the chain.

---

# 3. THE FUNDAMENTAL DATA MODEL

The system should conceptually distinguish between the following objects.

## Employee

Represents the human being employed by the security company.

The employee record may contain:

* personal information
* identity information
* contact information
* next of kin
* banking information
* employment information
* job title
* department
* PSIRA grade
* employment status
* salary/rate information
* documents
* certifications
* leave information
* disciplinary information
* compliance information

Employee information should not need to be repeatedly captured in different modules.

There should be one authoritative employee identity referenced throughout the system.

---

## Client

Represents the organisation purchasing security services.

Examples could include:

* government departments
* municipalities
* private companies
* estates
* retail organisations
* schools
* hospitals

A client may have multiple security sites.

---

## Site

Represents the physical location where guards are deployed.

A site belongs to a client.

A site can contain one or many posts.

Site configuration should eventually allow Plethora to understand what staffing is required.

---

## Post

A post represents an individual security deployment requirement within a site.

For example:

Main Gate

Day shift:
2 officers

Night shift:
2 officers

Another site may contain:

* reception
* control room
* entrance gate
* patrol
* CCTV control
* loading area

Posts define what manpower the site requires.

---

# 4. ROSTERING

Rostering is one of Plethora's most important operational modules.

The roster answers:

> Who is supposed to work where and when?

A roster should ultimately be generated or managed according to:

* site requirements
* post requirements
* employee availability
* employee employment status
* shift patterns
* working-hour limits
* leave
* employee grade
* gender/site requirements where applicable
* operational rules
* fairness
* previous roster continuation
* labour requirements

The company's current roster cycle is:

**26th of one month → 25th of the following month**

The roster should be labelled according to the month in which the period ends.

Example:

26 August – 25 September
= September roster.

Plethora must treat rosters as operational records.

Once a roster is actively being worked, changes should be properly tracked.

---

# 5. ROSTER VS ATTENDANCE

This distinction is extremely important.

## Roster

The roster represents:

> What was supposed to happen.

Example:

Thabo was scheduled:

Site A
Night Shift
18:00–06:00

---

## Attendance / Site Timesheet

Attendance represents:

> What actually happened.

Example:

Thabo actually worked:

18:14–06:02

Or:

Thabo was absent.

Or:

Another guard replaced him.

Payroll should ultimately rely on **approved actual attendance**, not merely the original roster.

Never confuse scheduled work with completed work.

---

# 6. ATTENDANCE WORKFLOW

A useful conceptual workflow is:

Rostered Shift
↓
Employee expected at site
↓
Attendance captured
↓
Exception identified if necessary
↓
Supervisor/Admin review
↓
Attendance approved
↓
Approved hours calculated
↓
Payroll input generated

Attendance should allow the system to distinguish between:

* worked
* absent
* leave
* sick leave
* replacement
* overtime
* public holiday
* additional shift
* late arrival
* early departure
* authorised absence
* unauthorised absence

Over time, Plethora may support different attendance capture methods including:

* site timesheets
* administrative capture
* supervisor capture
* mobile/web check-in
* WhatsApp workflows
* geolocation/geofencing
* integrations with biometric systems

The underlying data model should not assume that only one attendance mechanism will ever exist.

---

# 7. PAYROLL

Payroll is one of the highest-risk areas in Plethora.

Do not modify payroll behaviour casually.

Payroll should derive information from authoritative operational records wherever possible.

Conceptually:

Employee employment information

* Approved attendance
* Ordinary hours
* Overtime
* Public holiday work
* Leave
* Allowances
* Deductions
* Regulatory/statutory contributions
  = Gross and net payroll result

The platform should be designed around South African payroll requirements.

Relevant concepts may include:

* PAYE
* UIF
* SDL
* provident fund
* bargaining council requirements
* security-industry contributions
* PSIRA-related requirements
* BCEA requirements
* overtime
* public holidays
* leave
* statutory deductions

Do not hard-code rules unnecessarily.

Where possible, design calculation rules so that rates and regulatory parameters can eventually be configured.

Payroll must be:

* auditable
* reproducible
* explainable

For any payslip result, an administrator should eventually be able to understand how Plethora arrived at that number.

---

# 8. COMPLIANCE

Compliance should become a major strategic capability of Plethora.

A security company may need to demonstrate compliance involving:

* employee documentation
* PSIRA registration
* security grades
* employment contracts
* identity documentation
* banking records
* leave
* training
* statutory contributions
* payroll records
* employee registrations
* company regulatory requirements

The goal is not simply to upload documents.

Plethora should eventually understand:

* what is required
* whether it exists
* whether it is valid
* when it expires
* who is responsible
* what action is outstanding

Long-term conceptual model:

Requirement
↓
Evidence
↓
Validation
↓
Status
↓
Expiry / Renewal
↓
Notification
↓
Audit Trail

This enables Plethora to move from being a passive document repository toward becoming an active compliance-management platform.

---

# 9. DOCUMENT MANAGEMENT

Documents should be connected to the entity they belong to.

Examples:

Employee:

* ID
* contract
* PSIRA certificate
* banking confirmation

Site:

* contract
* SLA
* deployment specification
* assignment instructions

Compliance:

* submission evidence
* certificates
* statutory records

Avoid creating disconnected document storage where the system does not understand what the document represents.

Metadata is important.

---

# 10. LEAVE

Leave should integrate with:

Employee
↓
Leave Request
↓
Approval
↓
Leave Balance
↓
Roster Availability
↓
Attendance
↓
Payroll

Approved leave should influence roster decisions.

Attendance should understand that an employee is legitimately absent when approved leave exists.

Payroll should understand the relevant leave type.

Avoid implementing leave as an isolated calendar feature.

---

# 11. INCIDENT MANAGEMENT

Security companies manage operational incidents.

Plethora should eventually support structured incident records containing information such as:

* site
* employee(s)
* client
* date/time
* incident category
* description
* actions taken
* witnesses
* supporting documents
* escalation
* status
* resolution

Incident information should become useful operational intelligence rather than merely archived text.

---

# 12. CLIENT BILLING

Long term, Plethora should connect operational activity to client billing.

Conceptually:

Client Contract
↓
Site
↓
Post / Staffing Requirement
↓
Deployment
↓
Verified Service Delivery
↓
Billing Calculation
↓
Invoice
↓
Payment / Reconciliation

This makes operational records valuable beyond payroll.

The system should eventually be able to reconcile:

**what the client contracted for**

against

**what was deployed**

against

**what actually occurred**

against

**what was billed**.

---

# 13. MANAGEMENT DASHBOARD

Management dashboards should help management make decisions.

Do not create dashboards merely because charts look impressive.

Every metric should answer an operational question.

Examples:

How many employees are active?

Which sites are understaffed?

Who is working excessive overtime?

Which employees have missing compliance documents?

Which documents expire soon?

Which sites have attendance exceptions?

What payroll exceptions exist?

Which client/site is producing excessive overtime?

Which sites have recurring incidents?

What compliance submissions are outstanding?

What actions require management attention?

A good dashboard should direct attention toward exceptions.

---

# 14. EXCEPTION-DRIVEN DESIGN

Plethora should increasingly operate according to this principle:

> Normal operations should require little attention. Exceptions should demand attention.

For example:

Instead of asking an administrator to manually inspect 80 guards every day, Plethora should show:

* 2 absent
* 1 late
* 3 attendance entries requiring approval
* 1 expired PSIRA registration
* 2 employees exceeding overtime threshold

This principle should influence future UI, dashboards, notifications and automation.

---

# 15. ROLE-BASED ACCESS CONTROL

Plethora serves users with different responsibilities.

Potential roles include:

* Root/System Administrator
* Executive Management
* HR
* Finance
* Compliance
* Operations Manager
* Supervisor
* Site Manager
* Payroll Administrator
* Employee

Permissions must follow the principle of least privilege.

A user should see and modify only what they require to perform their role.

Avoid permission logic scattered randomly through UI components.

Authorisation must ultimately be enforced on the backend.

Frontend hiding is not security.

---

# 16. AUDITABILITY

Because Plethora handles employment, payroll and compliance information, important changes should eventually be traceable.

For sensitive actions, consider recording:

* who performed the action
* what changed
* previous value
* new value
* when it changed
* relevant entity
* reason where appropriate

Examples:

Payroll approval
Employee salary change
Attendance amendment
Roster alteration
Leave approval
Compliance status update
Permission change

Do not create audit logs for meaningless UI interactions.

Focus on business-significant actions.

---

# 17. NOTIFICATIONS AND AUTOMATION

Plethora should gradually reduce the need for managers to remember routine tasks manually.

Potential triggers include:

* document expiry
* PSIRA expiry
* contract expiry
* missing timesheet
* attendance awaiting approval
* overtime threshold
* leave request
* employee onboarding requirement
* payroll deadline
* missing compliance submission
* site understaffing

Notifications should be actionable.

Avoid excessive notifications that create alert fatigue.

---

# 18. WHATSAPP AND COMMUNICATION

Many South African guarding operations rely heavily on WhatsApp.

Plethora may eventually use WhatsApp as an interface for selected operational workflows.

Examples:

Employee receives roster.

Employee receives payslip.

Employee requests leave.

Guard checks in.

Supervisor reports attendance.

Management receives alerts.

This should be treated as another interface to Plethora's underlying business logic rather than a separate system.

The database should remain the source of truth.

---

# 19. PRODUCT USERS

When designing functionality, think about the real user.

Many Plethora users may:

* not be technically sophisticated
* work primarily on mobile
* have limited time
* manage many employees simultaneously
* work under operational pressure
* rely heavily on spreadsheets today

The interface should therefore favour:

* clarity
* obvious actions
* minimum unnecessary clicks
* sensible defaults
* bulk operations
* search
* filters
* strong validation
* clear errors

Do not design administrative workflows that require unnecessary technical understanding.

---

# 20. CURRENT TECHNOLOGY DIRECTION

Understand the actual repository before relying on this section because architecture may evolve.

The project has historically used technologies including:

Frontend:

* React
* Vite
* Tailwind CSS

Backend:

* Node.js
* Express

Database:

* PostgreSQL

ORM:

* Prisma

Authentication:

* JWT
* role-based access control

Deployment may involve services such as Railway and related cloud infrastructure.

Do not replace the technology stack unless explicitly requested.

Improve the existing architecture before proposing rewrites.

---

# 21. ARCHITECTURAL PRINCIPLE

Prefer:

UI
↓
API
↓
Controller
↓
Service / Domain Logic
↓
Data Access
↓
Database

Exact repository conventions should take precedence where a deliberate architecture already exists.

The important rule is:

**Business logic should not become scattered everywhere.**

Avoid putting critical calculations directly inside:

* React components
* API route definitions
* random utility functions
* database queries

Business rules should have clear ownership.

---

# 22. SOURCE OF TRUTH

Every important concept should have an authoritative source.

Examples:

Employee identity:
Employee record

Scheduled work:
Roster

Actual work:
Approved attendance

Leave entitlement:
Leave records/policy

Payroll output:
Approved payroll run

Compliance evidence:
Compliance/document records

Do not create multiple competing versions of the same truth.

---

# 23. DATA INTEGRITY

Prefer strong relationships between entities.

Avoid:

* unnecessary duplicate fields
* free-text identifiers where relationships can be used
* manually synchronised duplicate data
* storing derived values when they can safely be calculated
* weak relationships between business objects

However, historical records may require snapshots.

For example, payroll should often preserve historical values even if an employee's current salary later changes.

Understand the difference between:

**current master data**

and

**historical transaction data**.

---

# 24. HISTORICAL RECORDS

Never assume old operational records can simply use today's data.

Examples:

A roster from six months ago should show what happened six months ago.

A historical payslip must remain unchanged even if:

* salary changes
* bank information changes
* job title changes
* contribution rates change

Historical accuracy is important.

Do not casually recalculate completed historical transactions using current data.

---

# 25. STATUS LIFECYCLES

Important records should have explicit lifecycles rather than relying on ambiguous booleans.

Example payroll:

DRAFT
↓
CALCULATED
↓
REVIEWED
↓
APPROVED
↓
FINALISED / PAID

Roster:

DRAFT
↓
PUBLISHED
↓
ACTIVE
↓
COMPLETED

Leave:

PENDING
↓
APPROVED / REJECTED
↓
TAKEN / CANCELLED

Attendance:

CAPTURED
↓
REVIEW_REQUIRED
↓
APPROVED
↓
PAYROLL_READY

Do not invent statuses unnecessarily, but when a business process clearly has stages, model them explicitly.

---

# 26. REVERSIBILITY

Critical operations should be reversible where appropriate.

Examples:

* payroll may need "revert to draft"
* attendance may require correction
* roster changes may require restoration
* approval may sometimes need authorised reversal

Reversal should not destroy audit history.

Prefer:

change + audit trail

over:

delete and pretend it never happened.

---

# 27. SOFT DELETE VS HARD DELETE

For important business records, deletion may be dangerous.

When appropriate consider:

* inactive
* archived
* terminated
* cancelled
* voided

rather than physically deleting records.

Examples include:

* employees
* sites
* clients
* completed payrolls
* compliance records

Do not introduce soft-delete everywhere automatically.

Determine whether historical integrity requires retention.

---

# 28. SCALE

The software should initially remain simple but should not be designed around only one organisation.

Plethora is intended to become SaaS software serving multiple security companies.

Therefore, avoid assumptions such as:

* one company forever
* one payroll configuration
* one roster pattern
* one site structure
* one contribution structure
* one approval workflow

Where practical, architecture should allow tenant/company-specific configuration.

Do not over-engineer multi-tenancy prematurely, but do not embed current-company assumptions deeply into core logic.

---

# 29. CONFIGURATION OVER HARD-CODING

Where business rules can vary between companies, favour configurable models.

Potential examples:

* shift times
* roster cycle
* overtime rules
* payroll configuration
* allowance types
* deduction types
* approval chains
* document requirements
* attendance rules

Legal/statutory rules may still require controlled implementation.

Do not turn everything into configuration.

Use judgement.

---

# 30. SECURITY AND PRIVACY

Plethora manages sensitive personal and employment information.

Treat:

* identity information
* banking details
* salaries
* payslips
* employee documents
* passwords
* tokens
* disciplinary information

as sensitive.

Never:

* expose secrets in logs
* return excessive personal information through APIs
* trust frontend permissions alone
* store plaintext passwords
* commit environment secrets
* expose confidential documents through insecure URLs

Follow secure development practices throughout the system.

---

# 31. SOUTH AFRICAN CONTEXT

Plethora operates within South Africa.

The system should therefore remain compatible with relevant South African requirements that may apply, including areas such as:

* labour legislation
* BCEA
* UIF
* PAYE
* SDL
* POPIA
* PSIRA requirements
* private security employment requirements
* bargaining council requirements where applicable
* statutory payroll obligations

Do not invent legal requirements.

When implementing legal/compliance rules, distinguish clearly between:

1. actual statutory requirements,
2. industry requirements,
3. company policy,
4. configurable operational preferences.

Rules that may change over time should not be buried invisibly inside unrelated code.

---

# 32. ENGINEERING PHILOSOPHY

When developing Plethora:

Prefer:

* simple code
* explicit behaviour
* clear naming
* strong validation
* predictable APIs
* reusable business logic
* maintainable architecture
* strong typing where available
* centralised constants
* documented complex business rules
* testable calculations

Avoid:

* premature abstraction
* unnecessary frameworks
* huge utility files
* giant React components
* duplicate implementations
* hidden side effects
* clever code that is difficult to understand
* dependency proliferation
* unused code
* speculative features
* broad rewrites without measurable benefit

The application should gradually become **boring, reliable software**.

Reliability matters more than architectural fashion.

---

# 33. WHEN IMPLEMENTING A FEATURE

Before coding any significant feature, establish:

### Business Problem

What real operational problem are we solving?

### Actor

Who performs the action?

### Input

Where does the data come from?

### Source of Truth

Which entity owns this information?

### Business Rules

What conditions determine valid behaviour?

### Permissions

Who can perform this action?

### State Change

What changes in the system?

### Downstream Effects

Does it affect:

* roster
* attendance
* payroll
* compliance
* billing
* reporting

### Audit Requirement

Should this action be recorded?

### Exceptions

What can go wrong?

### Validation

What invalid data must be prevented?

### Historical Impact

Could the change affect historical records?

### Testing

How will we prove this works?

Do this reasoning before major implementation.

---

# 34. ANTIGRAVITY REPOSITORY WORKFLOW

Whenever you are given a development task, follow this workflow.

## STEP 1 — Understand

Read the request.

Identify the relevant Plethora business process.

Do not immediately start editing files.

---

## STEP 2 — Inspect

Locate the relevant:

* routes
* components
* controllers
* services
* Prisma models
* migrations
* utility functions
* permissions
* tests

Understand how the feature currently works.

---

## STEP 3 — Trace

Trace the complete flow:

Frontend
→ API
→ authentication
→ permissions
→ controller
→ business logic
→ database
→ response
→ frontend state

If another module depends on the same data, trace that dependency too.

---

## STEP 4 — Evaluate

Determine whether the requested change:

* fits existing architecture
* duplicates functionality
* introduces new business logic
* affects historical records
* affects permissions
* affects payroll
* affects attendance
* affects roster
* requires database changes

---

## STEP 5 — Plan

Before major implementation, create a concise internal implementation plan.

Prefer the smallest coherent change that solves the problem properly.

---

## STEP 6 — Implement

Follow existing patterns where those patterns are sound.

Improve weak patterns when necessary without turning the task into an unrelated rewrite.

---

## STEP 7 — Validate

Validate:

* inputs
* permissions
* relationships
* state transitions
* error cases

Do not rely solely on frontend validation.

---

## STEP 8 — Test

Run relevant:

* unit tests
* integration tests
* API tests
* frontend tests
* type checks
* linting
* builds
* Prisma validation

Where a critical business rule lacks tests, consider adding one.

---

## STEP 9 — Regression Check

Determine what existing behaviour could have been affected.

Especially inspect:

* authentication
* RBAC
* employee management
* rostering
* attendance
* payroll
* leave
* reporting

---

## STEP 10 — Clean

Before finishing:

* remove unused imports
* remove temporary debugging
* remove dead code created during implementation
* ensure naming is clear
* remove accidental duplication

---

## STEP 11 — Report

Explain:

* what changed
* why
* files affected
* database changes
* business impact
* tests performed
* anything requiring further attention

---

# 35. WHEN DATABASE CHANGES ARE REQUIRED

Database changes require additional caution.

Before editing the Prisma schema:

1. Understand the existing model.
2. Search every usage of the model/field.
3. Determine whether production data exists.
4. Assess backwards compatibility.
5. Determine migration impact.
6. Do not delete production fields casually.
7. Create appropriate migrations.
8. Validate Prisma.
9. Test with realistic data.
10. Ensure the application remains compatible during deployment where required.

Never use destructive production database commands merely to make development easier.

---

# 36. WHEN MODIFYING PAYROLL

Treat payroll modifications as high risk.

Before changing payroll code:

Trace:

attendance
→ hours
→ rate calculation
→ overtime
→ allowances
→ deductions
→ statutory amounts
→ gross pay
→ net pay
→ payslip

Create or update tests.

Use representative scenarios.

Examples should include:

* normal employee
* overtime
* absence
* leave
* public holiday
* deductions
* mid-period employment changes
* edge cases where applicable

Never rely only on UI testing for payroll calculations.

---

# 37. WHEN MODIFYING ROSTERING

Check:

* staffing requirement
* employee availability
* existing shifts
* leave
* roster cycle
* post allocation
* overlapping shifts
* fairness rules
* working limits
* operational restrictions

Ensure changes do not silently destroy manually adjusted rosters.

---

# 38. WHEN MODIFYING ATTENDANCE

Always maintain the distinction between:

scheduled shift

and

actual attendance.

Attendance edits should not rewrite historical roster information merely to make records match.

The system should represent reality rather than alter the original plan.

---

# 39. WHEN MODIFYING PERMISSIONS

Verify both:

frontend accessibility

AND

backend authorisation.

Never consider a feature secured simply because the button is hidden.

Test multiple roles.

Root/system administrator behaviour should be explicit rather than relying on accidental permission inheritance.

---

# 40. WHEN ADDING AUTOMATION

Never automate a poorly understood workflow.

First understand the manual process.

Then identify:

trigger
→ rule
→ action
→ exception
→ human review where necessary

Automation should reduce repetitive work without removing appropriate accountability.

---

# 41. UX PRINCIPLE

A Plethora workflow should usually answer four questions clearly:

1. What am I looking at?
2. What requires my attention?
3. What action can I take?
4. What happened after I took the action?

Avoid screens full of information with no obvious next action.

---

# 42. PERFORMANCE

Avoid premature optimisation.

However, remember that workforce systems can generate large volumes of records.

Attendance alone can eventually create millions of rows.

Consider:

* pagination
* indexes
* query efficiency
* avoiding N+1 queries
* loading only required data
* background generation of expensive reports where appropriate

Do not fetch entire datasets merely because current development data is small.

---

# 43. REPORTING

Reporting should preferably derive from authoritative transactional data.

Avoid maintaining duplicate reporting tables unless there is a clear technical reason.

Reports may include:

* employee reports
* roster reports
* attendance reports
* overtime reports
* payroll reports
* leave reports
* compliance reports
* site performance
* client reports
* exception reports

Exports should eventually support formats appropriate for business operations.

---

# 44. ERROR HANDLING

Errors should be useful.

Frontend users should receive clear business-level explanations.

Bad:

"500 Internal Server Error"

Better:

"This attendance record cannot be approved because the employee is not assigned to this site."

Do not expose:

* stack traces
* SQL
* tokens
* internal infrastructure details

to normal users.

Log sufficient technical information securely for developers.

---

# 45. OBSERVABILITY

As Plethora matures, operational failures should be diagnosable.

Important systems should provide sufficient:

* application logs
* error tracking
* deployment visibility
* audit logs
* job execution status

Avoid excessive noisy logging.

Logs should help answer:

> What happened?

and:

> Why did it happen?

---

# 46. DO NOT CREATE TECHNICAL DEBT NEEDLESSLY

Before adding:

* a package
* abstraction
* service
* database table
* configuration file
* new architecture pattern

ask:

> Is this solving a current problem?

If the answer is no, avoid adding it.

Every new concept creates maintenance cost.

---

# 47. CURRENT PRODUCT STAGE

Treat Plethora as a product moving from:

**internal operational system**

toward:

**repeatable SaaS platform for other security companies.**

Therefore each improvement should balance:

Current operational needs

with

future product scalability.

Do not delay solving a real current problem merely because a perfect multi-tenant architecture could exist later.

At the same time, avoid creating unnecessary dependencies on one company's names, people, clients or processes inside reusable core business logic.

---

# 48. DEVELOPMENT PRIORITY

When prioritising engineering work, generally favour:

**1. Data integrity**

Then:

**2. Security**

Then:

**3. Correct business behaviour**

Then:

**4. Reliability**

Then:

**5. Operational efficiency**

Then:

**6. User experience**

Then:

**7. Performance**

Then:

**8. Architectural elegance**

A visually impressive feature that produces incorrect payroll or attendance data is unacceptable.

---

# 49. DEFINITION OF DONE

A Plethora feature is not finished simply because it appears on the screen.

It is done when:

* the real business problem is solved
* data relationships are correct
* permissions are correct
* validation exists
* errors are handled
* relevant edge cases are considered
* tests pass
* build passes
* existing workflows are not broken
* unnecessary code has not been introduced
* the implementation is understandable
* appropriate auditing exists where required
* documentation is updated where necessary

---

# 50. LONG-TERM VISION

The long-term vision is for Plethora to become an intelligent operating platform for private security companies.

Instead of management continuously asking:

"Did everyone come to work?"

"Who is missing documents?"

"Who worked overtime?"

"Are we compliant?"

"How much payroll are we running?"

"Which site has a problem?"

"Did we deploy what the client is paying for?"

"What still needs approval?"

Plethora should increasingly answer these questions automatically.

The system should transform operational records into:

**visibility → exceptions → action → accountability.**

Ultimately Plethora should allow a management team to understand what is happening across the company from one reliable operational system.

---

# FINAL INSTRUCTION TO ANTIGRAVITY

Do not treat Plethora as a collection of CRUD screens.

Understand the business relationships.

When changing one module, consider upstream and downstream effects.

When uncertain about the purpose of existing functionality:

**inspect before changing it.**

When uncertain whether something should be deleted:

**trace it before deleting it.**

When uncertain about a business rule:

**make the uncertainty explicit rather than silently inventing behaviour.**

Prefer incremental improvements over unnecessary rewrites.

The objective is to build a system that security companies can confidently rely on for real employees, real sites, real attendance, real payroll, real compliance and real money.

Every engineering decision should move Plethora closer to being:

**Reliable. Auditable. Simple. Secure. Scalable. Operationally useful.**
