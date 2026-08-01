import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { prisma } from "../../lib/prisma.js";
import { isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { processIncomingMessage } from "../services/handler.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

describe.runIf(dbReady)("WhatsApp leave commands (integration)", () => {
  let companyId: string;
  let employeeId: string;
  const suffix = randomBytes(6).toString("hex");
  const phone = `27821${suffix.slice(0, 6)}`;

  beforeAll(async () => {
    const company = await prisma.company.create({ data: { name: `WA Leave Test Co ${suffix}` } });
    companyId = company.id;
    const employee = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `WA-${suffix}`,
        firstName: "WhatsApp",
        lastName: "User",
        status: "active",
        employeeType: "general",
        monthlySalary: 15000,
        phone,
        commencementDate: new Date("2022-01-01T00:00:00.000Z"),
      },
    });
    employeeId = employee.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
  });

  it("creates a leave request via 'leave <date> <type> <reason>'", async () => {
    const result = await processIncomingMessage(phone, "leave 2026-08-01 2026-08-03 annual family trip");
    expect(result.reply).toMatch(/submitted/i);

    const requests = await prisma.leaveRequest.findMany({ where: { companyId, employeeId } });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.leaveType).toBe("ANNUAL");
    expect(requests[0]!.unitsRequested.toString()).toBe("3"); // 3 calendar days, Aug 1-3 inclusive
    expect(requests[0]!.reason).toBe("family trip");
  });

  it("rejects parental leave without a scenario keyword", async () => {
    const result = await processIncomingMessage(phone, "leave 2026-09-01 parental");
    expect(result.reply).toMatch(/scenario/i);
  });

  it("creates parental leave with a scenario keyword", async () => {
    const result = await processIncomingMessage(phone, "leave 2026-09-01 2026-09-05 parental sole welcome baby");
    expect(result.reply).toMatch(/submitted/i);
    const request = await prisma.leaveRequest.findFirst({ where: { companyId, employeeId, leaveType: "PARENTAL" } });
    expect(request?.parentalLeaveScenario).toBe("SOLE_OR_ONLY_EMPLOYED_PARENT");
    expect(request?.reason).toBe("welcome baby");
  });

  it("rejects family responsibility leave without a reason keyword", async () => {
    const result = await processIncomingMessage(phone, "leave 2026-10-01 family");
    expect(result.reply).toMatch(/reason keyword/i);
  });

  it("creates family responsibility leave with a reason keyword", async () => {
    const result = await processIncomingMessage(phone, "leave 2026-10-01 family child_sick");
    expect(result.reply).toMatch(/submitted/i);
    const request = await prisma.leaveRequest.findFirst({ where: { companyId, employeeId, leaveType: "FAMILY_RESPONSIBILITY" } });
    expect(request?.familyResponsibilityReason).toBe("CHILD_SICK");
  });

  it("reports leave balance", async () => {
    const result = await processIncomingMessage(phone, "leave balance");
    expect(result.reply).toMatch(/ANNUAL/);
    expect(result.reply).toMatch(/available/);
  });

  it("reports leave history", async () => {
    const result = await processIncomingMessage(phone, "leave history");
    expect(result.reply).toMatch(/ANNUAL/);
    expect(result.reply).toMatch(/pending/);
  });

  it("withdraws a pending leave request", async () => {
    const request = await prisma.leaveRequest.findFirst({ where: { companyId, employeeId, leaveType: "ANNUAL" } });
    const result = await processIncomingMessage(phone, `leave withdraw ${request!.id}`);
    expect(result.reply).toMatch(/withdrawn/i);
    const updated = await prisma.leaveRequest.findUnique({ where: { id: request!.id } });
    expect(updated?.status).toBe("CANCELLED");
  });
});
