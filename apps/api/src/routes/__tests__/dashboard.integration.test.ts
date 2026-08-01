import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { detectAndPersistExceptions } from "../../modules/attendance-exceptions/exceptions.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("dashboard attention alerts (PostgreSQL integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({ data: { name: `Dashboard Test Co ${runId}` } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Dashboard Admin",
        email: `dashboard-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("dashboard-test-password-32chars!!"),
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });
    accessToken = jwt.sign({ sub: user.id, email: user.email, companyId }, config.jwt.accessSecret, { expiresIn: "1h" });
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  it("does not surface a stale historical unattended shift as a needs-attention alert", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DASH-OLD-${runId}`, firstName: "Old", lastName: "Shift", status: "active", employeeType: "security_officer", hourlyRate: 100 },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Dash Old Site ${runId}` } });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId: site.id,
        startTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000),
        shiftType: "day",
        status: "assigned",
      },
    });

    const response = await app.inject({ method: "GET", url: "/dashboard", headers: authHeader(accessToken) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.alerts.some((alert: { type: string }) => alert.type === "attendance_exceptions")).toBe(false);
    expect(body.payrollReadiness?.openExceptions ?? 0).toBe(0);
  });

  it("surfaces open attendance exceptions from the current pay period as a needs-attention alert, even after an earlier dashboard read cached a zero-count readiness row", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DASH-CUR-${runId}`, firstName: "Current", lastName: "Shift", status: "active", employeeType: "security_officer", hourlyRate: 100 },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Dash Current Site ${runId}` } });
    await prisma.shift.create({
      data: {
        companyId,
        employeeId: employee.id,
        siteId: site.id,
        startTime: new Date(Date.now() - 3 * 60 * 60 * 1000),
        endTime: new Date(Date.now() - 1 * 60 * 60 * 1000),
        shiftType: "day",
        status: "assigned",
      },
    });
    const scan = await detectAndPersistExceptions({ companyId, lookbackHours: 24 });
    expect(scan.created).toBeGreaterThan(0);

    const response = await app.inject({ method: "GET", url: "/dashboard", headers: authHeader(accessToken) });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    const alert = body.alerts.find((a: { type: string }) => a.type === "attendance_exceptions");
    expect(alert).toBeDefined();
    expect(alert.count).toBeGreaterThan(0);
    expect(body.payrollReadiness?.openExceptions).toBeGreaterThan(0);
  });

  it("honours the dateRange filter instead of silently returning the same window", async () => {
    const [today, week, month] = await Promise.all(
      ["today", "week", "month"].map(async (range) => {
        const response = await app.inject({
          method: "GET",
          url: `/dashboard?dateRange=${range}`,
          headers: authHeader(accessToken),
        });
        expect(response.statusCode).toBe(200);
        return response.json();
      })
    );

    expect(today.dateRange).toBe("today");
    expect(week.dateRange).toBe("week");
    expect(month.dateRange).toBe("month");

    // Hourly buckets for today, daily for the others — the series must differ.
    expect(today.shiftsOverTime).toHaveLength(24);
    expect(week.shiftsOverTime).toHaveLength(7);
    expect(month.shiftsOverTime.length).toBeGreaterThanOrEqual(28);

    // Windows must be strictly nested: today ⊂ week, and week starts no earlier
    // than the month for a mid-month date.
    expect(new Date(today.windowStart).getTime()).toBeGreaterThanOrEqual(
      new Date(week.windowStart).getTime()
    );
    expect(new Date(month.windowStart).getTime()).toBeLessThanOrEqual(
      new Date(today.windowStart).getTime()
    );
  });

  it("falls back to the month window when dateRange is unrecognised", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dashboard?dateRange=decade",
      headers: authHeader(accessToken),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().dateRange).toBe("month");
  });

  it("returns a rostered-guards series distinct from the shift-volume series", async () => {
    const employee = await prisma.employee.create({
      data: { companyId, employeeNumber: `DASH-ROSTER-${runId}`, firstName: "Roster", lastName: "Guard", status: "active", employeeType: "security_officer", hourlyRate: 100 },
    });
    const site = await prisma.site.create({ data: { companyId, name: `Dash Roster Site ${runId}` } });
    // Two shifts for the same guard on the same day: 2 shifts, 1 distinct guard.
    const base = new Date();
    base.setHours(8, 0, 0, 0);
    for (const offset of [0, 4]) {
      await prisma.shift.create({
        data: {
          companyId,
          employeeId: employee.id,
          siteId: site.id,
          startTime: new Date(base.getTime() + offset * 60 * 60 * 1000),
          endTime: new Date(base.getTime() + (offset + 2) * 60 * 60 * 1000),
          shiftType: "day",
          status: "assigned",
        },
      });
    }

    const response = await app.inject({
      method: "GET",
      url: "/dashboard?dateRange=month",
      headers: authHeader(accessToken),
    });
    const body = response.json();

    expect(body.rosteredGuardsOverTime).toBeDefined();
    expect(body.rosteredGuardsOverTime).toHaveLength(body.shiftsOverTime.length);

    const totalShifts = body.shiftsOverTime.reduce(
      (s: number, p: { value: number }) => s + p.value,
      0
    );
    const peakGuards = Math.max(
      ...body.rosteredGuardsOverTime.map((p: { value: number }) => p.value)
    );
    // Distinct guards can never exceed shift count, and here it is strictly less.
    expect(totalShifts).toBeGreaterThanOrEqual(2);
    expect(peakGuards).toBe(1);
  });

  it("does not duplicate persisted operational alerts into the derived alerts array", async () => {
    const created = await prisma.operationalAlert.create({
      data: {
        companyId,
        title: `Dedup check ${runId}`,
        message: "Should appear exactly once",
        priority: "CRITICAL",
        status: "OPEN",
        sourceModule: "SITES",
        dedupeKey: `dedup-${runId}`,
      },
    });

    const response = await app.inject({ method: "GET", url: "/dashboard", headers: authHeader(accessToken) });
    const body = response.json();

    expect(
      body.operationalAlerts.some((a: { id: string }) => a.id === created.id)
    ).toBe(true);
    // The same alert must NOT also be present in `alerts` — that double-counted
    // it in the "Needs attention" KPI.
    expect(body.alerts.some((a: { id?: string }) => a.id === created.id)).toBe(false);
    expect(body.alertCounts.critical).toBeGreaterThan(0);
  });

  it("site-scopes alert counts consistently with the alert list", async () => {
    const site = await prisma.site.create({ data: { companyId, name: `Alert Site ${runId}` } });
    const other = await prisma.site.create({ data: { companyId, name: `Other Site ${runId}` } });
    await prisma.operationalAlert.create({
      data: {
        companyId,
        siteId: site.id,
        title: `Scoped alert ${runId}`,
        message: "Only for the selected site",
        priority: "MEDIUM",
        status: "OPEN",
        sourceModule: "SITES",
        dedupeKey: `scoped-${runId}`,
      },
    });

    const scoped = (
      await app.inject({
        method: "GET",
        url: `/dashboard?siteIds=${site.id}`,
        headers: authHeader(accessToken),
      })
    ).json();
    expect(scoped.alertCounts.allOpen).toBe(scoped.operationalAlerts.length);
    expect(scoped.operationalAlerts.every((a: { siteId: string | null }) => a.siteId === site.id)).toBe(true);

    const otherScoped = (
      await app.inject({
        method: "GET",
        url: `/dashboard?siteIds=${other.id}`,
        headers: authHeader(accessToken),
      })
    ).json();
    expect(otherScoped.alertCounts.allOpen).toBe(0);
    expect(otherScoped.operationalAlerts).toHaveLength(0);
  });
});
