# Plethora – Workforce & Payroll Management System

## User Manual for Your Team

**Version 1.0**  
This manual helps your team understand and use the Plethora system for workforce scheduling, attendance tracking, and payroll management.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [User Roles & Permissions](#3-user-roles--permissions)
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

**Default admin credentials** (for first-time setup):

- Email: `admin@quickbopha.com`
- Password: `admin123`

> **Important:** Change the default password after first login.

### First-Time Setup

If your company name is still "My Company", you will see a **Company Setup** modal. An administrator must:

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
| Audit       | Activity log (admin only)                         |
| Settings    | Company details, users, bulk import, factory reset |

### Global Search

Use the search bar in the header to quickly find:

- **Employees** – Type 2+ characters; results link to the filtered employees list.
- **Sites** – Results link to the site detail page.

---

## 3. User Roles & Permissions

Plethora has four roles with different access levels:

| Role                  | Description                                                                 |
|-----------------------|-----------------------------------------------------------------------------|
| **Admin**             | Full access: company setup, users, factory reset, bulk import, all features |
| **Operations Manager**| Rostering, attendance, shifts, sites, employees; no payroll config or users |
| **HR & Payroll**      | Employees, payroll, pay grades, earnings/deductions, attendance verification|
| **Supervisor**        | Rostering, attendance, shifts, sites, employees; no payroll or settings    |

### Permission Summary

| Feature              | Admin | Ops Manager | HR & Payroll | Supervisor |
|----------------------|-------|-------------|--------------|------------|
| Company setup        | ✓     | —           | —            | —          |
| Users & roles        | ✓     | —           | —            | —          |
| Business details     | ✓     | —           | —            | —          |
| Employees            | ✓     | ✓           | ✓            | ✓          |
| Sites                | ✓     | ✓           | ✓            | ✓          |
| Rostering            | ✓     | ✓           | ✓            | ✓          |
| Attendance           | ✓     | ✓           | ✓            | ✓          |
| Payroll runs         | ✓     | ✓           | ✓            | —          |
| Payroll config       | ✓     | —           | ✓            | —          |
| Pay grades           | ✓     | —           | ✓            | —          |
| Earnings/deductions  | ✓     | —           | ✓            | —          |
| Public holidays      | ✓     | —           | ✓            | —          |
| Bulk import          | ✓     | ✓           | ✓            | ✓          |
| Audit logs           | ✓     | —           | —            | —          |
| Factory reset        | ✓     | —           | —            | —          |

---

## 4. Company Setup

**Settings → Profile** – View your profile (name, email, role).

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

Only **admins** can edit business details and settings.

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

Only **admins** can delete employees. In the edit modal, use the **Delete** button.

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
- **Edit** – Update site details (admin only).
- **Delete** – Remove a site (admin only).
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

### Clock In / Clock Out

When a guard arrives for a shift:

1. Go to **Attendance**.
2. In **Clock in / Clock out**, find the shift.
3. Click **Clock In** when the guard arrives.
4. Click **Clock Out** when the guard leaves.

### Missed Shifts

If a guard does not clock in:

1. The shift appears under **Missed shifts (no clock-in)**.
2. Click **Replace**.
3. Choose an available reliever.
4. The shift is reassigned to the reliever.

### Filters

- **Date range** – Prev/Next month, This month.
- **Employee** – Filter by employee.
- **Site** – Filter by site.
- Click **Apply** to refresh.

### Attendance Records

- **Completed** – Expand a record to see clock in/out times, hours, overtime.
- **Active** – Guards currently on shift; use **Clock Out** when they finish.

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

Only **admins** and **HR & Payroll** can edit configuration.

---

## 10. Settings

### Profile

View your name, email, and role. Profile editing is not supported in this version.

### Business Details

Company information for payslips and compliance. See [Company Setup](#4-company-setup).

### Business Settings

Defaults for payroll, dates, and reporting. See [Company Setup](#4-company-setup).

### Users & Roles (Admin Only)

- **Add User** – Name, email, password, role.
- **Edit** – Update name, email, role, or password.
- **Delete** – Remove a user (cannot delete yourself).

### Bulk Import

See [Bulk Import (Migration)](#12-bulk-import-migration).

### Factory Reset (Admin Only)

**Warning:** This permanently deletes data. You can reset the entire system or choose specific modules.

**Modules you can reset individually:**

- **Employees** – All employees, assignments, leave records, and deductions
- **Sites** – Sites, posts, and site/post assignments
- **Shifts** – Shifts and attendance records
- **Payroll** – Payroll runs, items, and payslips
- **Timesheets** – All timesheet records
- **Pay Rules** – Pay grades, pay rules, earnings and deduction rules
- **Public Holidays** – Public holiday calendar
- **Audit Logs** – Activity and audit history
- **Company Settings** – Company name, business details, and settings

User accounts are never deleted.

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

### Audit Logs (Admin Only)

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
   - **Company** (admin only) – For multi-company import
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

**Admin:** Can import companies + employees + sites in one go.  
**Other roles:** Can import employees and sites into the current company only.

---

## 13. Quick Reference

### Default Login

- Email: `admin@quickbopha.com`
- Password: `admin123`

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
