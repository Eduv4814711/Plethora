# Plethora – Workforce & Payroll Management System

## User Manual for Your Team

**Version 1.0**  
This manual helps your team understand and use the Plethora system for workforce scheduling, attendance tracking, and payroll management.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Module Capabilities](#3-module-capabilities)
4. [Company Setup](#4-company-setup)
5. [Employees](#5-employees)
6. [Sites & Posts](#6-sites--posts)
7. [Rostering](#7-rostering)
8. [Attendance](#8-attendance)
9. [Payroll](#9-payroll)
10. [Settings](#10-settings)
11. [Reports & Audit](#11-reports--audit)
12. [Bulk Import (Migration)](#12-bulk-import-migration)
13. [Quick Reference](#13-quick-reference)

---

## 1. Overview

**Plethora** is a workforce and payroll management system designed for security companies and businesses that manage guards, sites, shifts, and payroll. It supports:

- **Employee management** – Security guards and office staff, with PSIRA and Labour Law (BCEA) compliance fields
- **Site management** – Client sites, posts, and guard assignments
- **Rostering** – Create and manage shifts with drag-and-drop
- **Attendance** – Clock in/out, missed shifts, and guard replacement
- **Payroll** – Pay grades, earnings/deductions, payroll runs, and payslips

The system is **multi-tenant**: each company has its own data. Users belong to one company and can only see and manage that company’s information.

---

## 2. Getting Started

### Logging In

1. Open the application URL (e.g. `http://localhost:3000` or your deployed URL).
2. Enter your **email** and **password**.
3. Click **Sign in**.

The first user created during company registration becomes the company owner.
Seeded environments require `SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`; there
is no hard-coded default password.

### First-Time Setup

If your company name is still "My Company", you will see a **Company Setup** modal. The company owner must:

1. Enter the **Company Name** (required).
2. Fill in **Business Details** (legal name, PSIRA registration, tax number, UIF reference, contact info, address).
3. Configure **Business Settings** (currency, date format, timezone, payroll period, employee ID prefix).
4. Click **Save & Continue**.

Until setup is complete, access to the main app is blocked.

### Navigation

The sidebar provides access to:

| Section      | Description                                      |
|-------------|---------------------------------------------------|
| Dashboard   | Overview: guards on duty, active sites, payroll status, alerts |
| Employees   | Add, edit, and manage employees                   |
| Sites       | Register and manage client sites and posts       |
| Rostering   | Create and manage shifts                          |
| Attendance  | Clock in/out, view records, handle missed shifts  |
| Payroll     | Payroll runs, configuration, payslips             |
| Reports     | (Coming soon) Reports and analytics               |
| Audit       | Activity log (requires Audit view access)          |
| Settings    | Company details, users, bulk import, factory reset |

### Global Search

Use the search bar in the header to quickly find:

- **Employees** – Type 2+ characters; results link to the filtered employees list.
- **Sites** – Results link to the site detail page.

---

## 3. Module Capabilities

Access is assigned directly to each user for each module. Job titles and account
types describe the user; they never grant authority.

| Capability | Allows |
|------------|--------|
| **View** | Open and read the module |
| **Create** | Add records |
| **Edit** | Change records and perform edit-like workflow actions |
| **Delete** | Remove records or perform destructive resets |
| **Approve** | Approve, reject, verify, publish, unlock, or finalize controlled workflows |
| **Export** | Download reports, payroll files, payslips, or other bulk data |
| **Manage access** | Assign capabilities; user creation, editing, and deletion also require their matching action capability |

Capabilities are independent: Edit does not automatically include View or
Export. A more specific assignment, such as **Team / Leave**, overrides its
parent **Team** assignment for that submodule.

Each company has one transferable **owner**. The owner has full system access
and is the only user who can transfer ownership or run a full factory reset.
The owner cannot be deactivated or deleted until ownership is transferred.

---

## 4. Company Setup

**Settings → Profile** – View your profile, account type, and job title.

**Settings → Business Details** – Configure company information used across the system (invoices, payslips, reports):

- Company name, legal name
- PSIRA registration, company registration
- Tax number, UIF reference
- Contact info (phone, email, fax, address, website)
- Logo upload

**Settings → Business Settings** – Configure defaults:

- **Currency** – ZAR (default), USD, EUR, GBP
- **Date format** – DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD
- **Timezone** – e.g. Africa/Johannesburg
- **Payroll period** – Weekly, bi-weekly, monthly
- **Employee ID prefix** – For auto-generated IDs (e.g. EMP-0001)

Editing business details and settings requires Settings edit access.

---

## 5. Employees

### Employee Types

- **Guard (Security)** – Hourly rate, pay grade, PSIRA compliance. Requires PSIRA number.
- **Office Staff** – Monthly salary, Labour Law (BCEA) fields.

### Employee Statuses

| Status      | Description                                      |
|-------------|--------------------------------------------------|
| Applicant   | Applied, not yet hired                           |
| Hired       | Hired, not yet in training                       |
| Training    | In training                                     |
| Active      | Active and available for shifts                  |
| Suspended   | Temporarily suspended                            |
| Offboarded  | Left the company                                 |

### Status Transitions

- Applicant → Hired
- Hired → Training, Offboarded
- Training → Active, Offboarded
- Active → Suspended, Offboarded
- Suspended → Active, Offboarded
- Offboarded → (no transitions)

### Adding an Employee

1. Go to **Employees** → **Add Employee**.
2. Choose **Staff type** (Office or Guard).
3. Use tabs: **Basic**, **Labour Law (BCEA)**, **Bank Details**, **PSIRA**.
4. Complete required fields:
   - **Basic:** First name, last name; status; optional employee ID.
   - **Guard:** PSIRA number required.
   - **Office:** Monthly salary.
5. Click **Create Employee**.

### Editing an Employee

Click an employee card to expand it, then click **Edit**. Update the relevant tabs and save.

### Deleting an Employee

Deleting employees requires Team delete access. In the edit modal, use the **Delete** button.

### Filtering

- **Status filter** – All, Applicant, Hired, Training, Active, Suspended, Offboarded.
- **Search** – Use the header search to filter by name or employee number.

---

## 6. Sites & Posts

### Sites

A **site** is a client location (e.g. office building, warehouse). Each site has:

- Name, physical address, short location
- Contact person and phone
- Service type (Guarding, Access Control, Patrols, etc.)
- Contract reference
- Assigned guards (optional)

### Posts

A **post** is a specific position at a site:

- Name (e.g. "Main Gate", "Rear Entrance")
- Shift type: **Day** (6:00–18:00) or **Night** (18:00–6:00)

### Assigning Guards to Sites

When creating or editing a site, you can:

- Assign guards to the site (overall assignment).
- Add posts and assign guards to posts.

### Managing Sites

- **Register Site** – Create a new site.
- **Edit** – Update site details (requires Sites edit).
- **Delete** – Remove a site (requires Sites delete).
- **View detail** – Click a site card to open the site detail page with roster and calendar.

---

## 7. Rostering

Rostering is used to schedule guards on shifts.

### Viewing the Roster

- **Week view** – Default view (Mon–Sun).
- **Month view** – Use the Week/Month dropdown.
- **Navigation** – Prev, Next, Today.

### Adding Shifts

**Method 1: Single shift**

1. Click **Add Shift**.
2. Select employee, post, start time, end time.
3. Click **Create Shift**.

**Method 2: Bulk (drag and drop)**

1. Select a **site** in the sidebar.
2. Choose a **pattern** (e.g. 3 on 3 off, weekdays, custom).
3. Drag a guard from the **Available guards** list.
4. Drop onto a **post** or **site** (for dual patterns like 3 on 3 off).

### Patterns

- **All days** – Every day
- **Weekdays** – Mon–Fri
- **2 on 2 off** – 2 days, 2 off
- **4 on 4 off** – 4 days, 4 off
- **5 on 2 off** – 5 days, 2 off
- **6 on 3 off** – 6 days, 3 off
- **3 on 3 off** – 3 days, 3 nights, 3 off (drop on site)
- **Custom days** – Select specific weekdays
- **Build custom pattern** – Define blocks (day/night/off)

### Resetting Shifts

- **Reset** menu → **Reset whole roster** – Clears all shifts in the visible period.
- **Reset for person** – Clears shifts for a specific guard.

### PDF Export

- **PDF** menu → **Full roster** – Preview or download the full roster.
- **Per guard** – Preview or download roster for each guard.

---

## 8. Attendance

**Attendance** has two tabs, because security officers and office staff are recorded
differently. The office tab only appears if the company has office staff on record.

### Guards (by site)

Guards are captured against the site they were rostered to, in two steps.

**Step 1 — choose the work**

1. Go to **Attendance** and stay on the **Guards (by site)** tab.
2. Choose the **pay period**, the **shift** (day, night, or all), and optionally search for
   a site.
3. Sites needing attention are listed first. Click one to open it.

**Step 2 — confirm who worked**

For a normal day where everyone turned up as rostered:

1. Click **Confirm all as scheduled**. Only shifts that match the roster are included —
   swaps, absences and unrostered work are left out for you to handle individually.
2. Enter the **Duty ON OB** number for the first shift. The rest fill in automatically by
   counting up from it; correct any that differ.
3. Enter the **Duty OFF OB** numbers and click **Confirm**.

Anything that could not be confirmed comes back with the reason against it. A guard being
absent does not stop their colleagues from being confirmed together.

For a shift that differs from the roster, use the card or table row:

1. Click **Change** to pick a different guard, mark that nobody worked, or adjust the shift
   type, times and notes.
2. Enter both **OB numbers** — they can be typed in either order.
3. Click **Confirm attendance**.

The attendance status (present, absent, shift swapped, reliever) is set automatically from
what you confirm; you never choose it by hand. Once an OB number is saved it is locked, and
changing it needs Attendance **approve** access.

**Add a reliever** records someone who worked but was never listed for the day.

**Approve the timesheet** when every visible entry is confirmed. The approved timesheet is
the official attendance record and the source of payroll hours. **Admin unlock** reopens an
approved timesheet and requires a typed reason, which is saved to the audit trail.

### Office staff (daily)

Office staff have no site, no roster and no occurrence book, so their attendance is a
simple daily roll call.

1. Go to **Attendance** and choose the **Office staff (daily)** tab.
2. Use the date stepper to pick the day.
3. Tap **Present** or **Absent** for each person. This saves immediately.
4. Use **Mark all remaining present** to finish everyone who has not been captured.
5. **Adjust** opens start/end times and a note if a day was not standard.

Anyone with approved leave for that date is shown as **On approved leave** and cannot be
marked present — cancel or change the leave first.

Office staff are paid a fixed monthly salary, so this record does **not** affect their pay.
It exists for leave cross-checks and reporting.

### Clocking in from WhatsApp

Where WhatsApp is enabled, employees can send `clock in` and `clock out` from their
registered phone number. For sites with a geofence they are asked to share their location.
These clock events feed the site timesheet, where a supervisor still confirms them.

### Attendance issues

**Review attendance issues** lists detected exceptions — late arrivals, missing clock-outs,
duplicate events and so on. Critical unresolved issues block payroll calculation, so clear
them before the pay run.

---

## 9. Payroll

### Pipeline

Payroll runs move through:

1. **Attendance** – Clock in/out data
2. **Calculation** – Compute hours and pay
3. **Approval** – Approve for payment
4. **Paid** – Mark as paid

### Creating a Payroll Run

1. Go to **Payroll** → **New Payroll Run**.
2. Set **Period start** and **Period end**.
3. Click **Create**.

### Run Actions

- **Draft** → **Calculate** – Compute payroll items from attendance.
- **Calculated** → **Approve** – Approve for payment.
- **Approved** → **Mark Paid** – Mark as paid.
- **View Items** – See employees and net pay; **Preview Payslip** for each.

### Payroll Configuration

Click **Configuration** to manage:

- **Pay grades** – Hourly rates (e.g. Grade A, Senior Guard).
- **Pay rules** – Overtime, Sunday, public holiday multipliers.
- **Earnings** – Fixed or percentage (e.g. transport, allowances).
- **Deductions** – Fixed or percentage (e.g. UIF, tax).

Editing configuration requires Payroll edit access.

---

## 10. Settings

### Profile

View your name, email, account type, and job title.

### Business Details

Company information for payslips and compliance. See [Company Setup](#4-company-setup).

### Business Settings

Defaults for payroll, dates, and reporting. See [Company Setup](#4-company-setup).

### User Access

- **View** requires User Access view.
- **Add User** requires User Access create and manage-access capabilities.
- **Edit** requires User Access edit and manage-access capabilities.
- **Delete** requires User Access delete and manage-access capabilities.
- The owner can transfer ownership to another active user after confirming their password.

### Bulk Import

See [Bulk Import (Migration)](#12-bulk-import-migration).

### Factory Reset (Owner Only)

**Warning:** Module resets clear selected module data only. A full **Reset all modules** permanently deletes the current company, all users, and all company data.

**Modules you can reset individually:**

- **Employees** – Clear all employees, assignments, leave records, and deductions
- **Sites** – Clear sites, posts, and site/post assignments
- **Shifts** – Clear shifts and attendance records
- **Payroll** – Clear payroll runs, items, and payslips
- **Timesheets** – Clear all timesheet records
- **Pay Rules** – Reset to defaults (overtime, sunday, public holiday rates; UIF, PSIRA)
- **Public Holidays** – Reset to SA public holidays (2025–2026)
- **Audit Logs** – Clear activity and audit history
- **Company Settings** – Reset company name, business details, and settings to defaults

User accounts are affected only by full **Reset all modules**. Partial module resets do not delete users or the company.

To reset:

1. Choose **Reset all modules** for a full factory reset, or select specific modules to reset.
2. Type **FACTORY RESET** in the confirmation field.
3. Click **Factory Reset**.

---

## 11. Reports & Audit

### Reports

The Reports module is planned for future releases. For now, use:

- **Attendance** – Attendance records
- **Payroll** – Payroll runs and items

### Audit Logs

Audit view access is required. Exporting audit data additionally requires Audit
export access.

View a log of actions:

- Timestamp
- User
- Action (create, update, delete, etc.)
- Entity type and ID

---

## 12. Bulk Import (Migration)

Bulk import is used to add many employees and sites at once via CSV.

### Step 1: Download Templates

1. Go to **Settings** → **Bulk Import**.
2. Download:
   - **Employees** – Employee data
   - **Sites** – Site data

### Step 2: Prepare CSV Files

- Fill in the templates according to the column headers.
- Ensure required fields are present and valid.
- Save as CSV (UTF-8 recommended).

### Step 3: Validate

1. Upload your CSV files.
2. Click **Validate**.
3. Review the preview: valid count and any errors.
4. Fix errors in the CSV and re-validate if needed.

### Step 4: Import

1. When validation shows no errors, click **Import**.
2. Review the result (created counts and any errors).

Imports always target the current company and require Settings edit access.
Exports require Settings export access.

---

## 13. Quick Reference

### Initial Owner

Register a company through the application, or provide `SEED_ADMIN_EMAIL` and
`SEED_ADMIN_PASSWORD` when seeding a development environment.

### Employee Status Flow

```
Applicant → Hired → Training → Active
                ↘ Offboarded ↗
Active ↔ Suspended
```

### Payroll Run Flow

```
Draft → Calculate → Approve → Mark Paid
```

### Shift Statuses

- **Created** – Shift created, not yet assigned
- **Assigned** – Assigned to a guard
- **Active** – Guard is on shift
- **Completed** – Shift finished
- **Verified** – Verified for payroll

### Support

For technical issues or questions, contact your system administrator or IT support.

---

*Plethora – Workforce & Payroll Management. Built for security companies and workforce operations.*
