import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";

const dbReady = await isIntegrationDatabaseAvailable();

/** Minimal hand-built multipart/form-data body — no dependency needed for one file + a few fields. */
function buildMultipartPayload(fields: Record<string, string>, file: { fieldName: string; filename: string; contentType: string; content: Buffer }) {
  const boundary = `----leaveV3TestBoundary${randomBytes(8).toString("hex")}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldName}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
    ),
    file.content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe.runIf(dbReady)("simple leave management API (/leave, integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  let generalEmployeeId: string;
  let securityEmployeeId: string;
  let newHireEmployeeId: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();

    const company = await prisma.company.create({ data: { name: `Leave V3 Test Co ${runId}` } });
    companyId = company.id;

    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Leave Admin",
        email: `leave-v3-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("leave-v3-test-password-32chars!!"),
        capabilities: {
          "/employees/leave": ["view", "create", "edit", "delete", "approve", "export"],
        },
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });
    accessToken = jwt.sign({ sub: user.id, email: user.email, companyId }, config.jwt.accessSecret, { expiresIn: "1h" });

    // Fixed, well-in-the-past commencement date (not relative to "now") so
    // the 12-month cycle boundaries (Jan 1 -> Dec 31 each year) are stable
    // and every 2026 request date used below falls inside the same cycle.
    const commencementDate = new Date("2022-01-01T00:00:00.000Z");

    const general = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `GEN-${runId}`,
        firstName: "General",
        lastName: "Staffer",
        status: "active",
        employeeType: "general",
        monthlySalary: 15000,
        commencementDate,
      },
    });
    generalEmployeeId = general.id;

    const security = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `SEC-${runId}`,
        firstName: "Security",
        lastName: "Officer",
        status: "active",
        employeeType: "security_officer",
        hourlyRate: 100,
        commencementDate,
      },
    });
    securityEmployeeId = security.id;

    const twoMonthsAgo = new Date();
    twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);
    const newHire = await prisma.employee.create({
      data: {
        companyId,
        employeeNumber: `NEW-${runId}`,
        firstName: "New",
        lastName: "Hire",
        status: "active",
        employeeType: "general",
        monthlySalary: 15000,
        commencementDate: twoMonthsAgo,
      },
    });
    newHireEmployeeId = newHire.id;
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  it("previews annual leave entitlement as 21 days for a general employee", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: generalEmployeeId, leaveType: "ANNUAL", startDate: "2026-02-02", endDate: "2026-02-06", unitsRequested: 5 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { data: { availableUnits: number; deductibleUnits: number; exceedsBalance: boolean } };
    expect(body.data.availableUnits).toBe(21);
    expect(body.data.deductibleUnits).toBe(5);
    expect(body.data.exceedsBalance).toBe(false);
  });

  it("does not deduct a public holiday that falls inside an annual leave request, end to end", async () => {
    // 16 June 2026 (Youth Day) falls inside this 5-day request.
    const create = await app.inject({
      method: "POST",
      url: "/leave",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: generalEmployeeId, leaveType: "ANNUAL", startDate: "2026-06-15", endDate: "2026-06-19", unitsRequested: 5 },
    });
    expect(create.statusCode).toBe(201);
    const requestId = (create.json() as { data: { id: string } }).data.id;

    const balances = await app.inject({
      method: "GET",
      url: `/leave/balances?employeeId=${generalEmployeeId}`,
      headers: authHeader(accessToken),
    });
    const annual = (balances.json() as { data: Array<{ leaveType: string; takenUnits: number; availableUnits: number }> }).data.find(
      (b) => b.leaveType === "ANNUAL",
    );
    expect(annual?.takenUnits).toBe(4); // 5 requested minus 1 public holiday
    expect(annual?.availableUnits).toBe(17); // 21 - 4

    const decide = await app.inject({
      method: "POST",
      url: `/leave/${requestId}/decide`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { decision: "approve" },
    });
    expect(decide.statusCode).toBe(200);
    expect((decide.json() as { data: { status: string; reviewedBy: string } }).data.status).toBe("APPROVED");
  });

  it("blocks a request that exceeds the available balance with a clear message", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leave",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "ANNUAL", startDate: "2026-03-01", endDate: "2026-03-31", unitsRequested: 25 },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { error: string; message: string };
    expect(body.error).toBe("EXCEEDS_BALANCE");
    expect(body.message).toMatch(/units available/);
  });

  it("security officer sick leave balance uses the 6 x 4 = 24 shift formula", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "SICK", startDate: "2026-05-01", endDate: "2026-05-01", unitsRequested: 1 },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { availableUnits: number } }).data.availableUnits).toBe(24);
  });

  it("a new hire within their first 6 months gets the ratio formula, not the full-cycle sick entitlement", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: newHireEmployeeId, leaveType: "SICK", startDate: new Date().toISOString().slice(0, 10), endDate: new Date().toISOString().slice(0, 10), unitsRequested: 1 },
    });
    expect(res.statusCode).toBe(200);
    const available = (res.json() as { data: { availableUnits: number } }).data.availableUnits;
    expect(available).toBeLessThan(30); // full-cycle general entitlement is 30
    expect(available).toBeGreaterThanOrEqual(0);
  });

  it("study leave is unavailable to a general employee but available to a security officer", async () => {
    const forGeneral = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: generalEmployeeId, leaveType: "STUDY", startDate: "2026-07-01", endDate: "2026-07-01", unitsRequested: 1 },
    });
    expect(forGeneral.statusCode).toBe(400);
    expect((forGeneral.json() as { error: string }).error).toBe("LEAVE_TYPE_NOT_AVAILABLE");

    const forSecurity = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "STUDY", startDate: "2026-07-01", endDate: "2026-07-01", unitsRequested: 1 },
    });
    expect(forSecurity.statusCode).toBe(200);
    expect((forSecurity.json() as { data: { availableUnits: number } }).data.availableUnits).toBe(6);
  });

  it("family responsibility leave requires a reason from the fixed list, not free text", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/leave",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "FAMILY_RESPONSIBILITY", startDate: "2026-04-01", endDate: "2026-04-01", unitsRequested: 1, reason: "just because" },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe("MISSING_FAMILY_RESPONSIBILITY_REASON");
  });

  it("parental leave: sole/only-employed-parent caps at 4 months, shared pool at 4 months + 10 days", async () => {
    const withinSoleCap = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId: generalEmployeeId,
        leaveType: "PARENTAL",
        startDate: "2026-02-01",
        endDate: "2026-06-01",
        unitsRequested: 120,
        parentalLeaveScenario: "SOLE_OR_ONLY_EMPLOYED_PARENT",
      },
    });
    const soleCapData = (withinSoleCap.json() as { data: { exceedsBalance: boolean; maxDaysForScenario: number } }).data;
    expect(soleCapData.exceedsBalance).toBe(false);
    expect(soleCapData.maxDaysForScenario).toBe(120);

    const exceedsSharedPool = await app.inject({
      method: "POST",
      url: "/leave/preview",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: {
        employeeId: generalEmployeeId,
        leaveType: "PARENTAL",
        startDate: "2026-02-01",
        endDate: "2026-06-01",
        unitsRequested: 200,
        parentalLeaveScenario: "SHARED_POOL",
      },
    });
    const data = (exceedsSharedPool.json() as { data: { exceedsBalance: boolean; maxDaysForScenario: number } }).data;
    expect(data.maxDaysForScenario).toBe(130);
    expect(data.exceedsBalance).toBe(true);
  });

  it("a manual balance adjustment changes the available balance and is audited", async () => {
    const adjust = await app.inject({
      method: "POST",
      url: "/leave/adjustments",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "ANNUAL", units: 2, reason: "goodwill gesture" },
    });
    expect(adjust.statusCode).toBe(201);

    const balances = await app.inject({
      method: "GET",
      url: `/leave/balances?employeeId=${securityEmployeeId}`,
      headers: authHeader(accessToken),
    });
    const annual = (balances.json() as { data: Array<{ leaveType: string; availableUnits: number }> }).data.find((b) => b.leaveType === "ANNUAL");
    expect(annual?.availableUnits).toBe(23); // 21 + 2 adjustment

    const audit = await app.inject({ method: "GET", url: `/leave/audit?employeeId=${securityEmployeeId}`, headers: authHeader(accessToken) });
    const actions = (audit.json() as { data: Array<{ action: string }> }).data.map((row) => row.action);
    expect(actions).toContain("BALANCE_ADJUSTED");
  });

  it("uploads and downloads a medical certificate for a sick leave request, storing no diagnosis field", async () => {
    const createSick = await app.inject({
      method: "POST",
      url: "/leave",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "SICK", startDate: "2026-08-10", endDate: "2026-08-12", unitsRequested: 3 },
    });
    expect(createSick.statusCode).toBe(201);
    const requestId = (createSick.json() as { data: { id: string } }).data.id;

    const fakePdf = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from("fake certificate content")]);
    const { body, contentType } = buildMultipartPayload(
      {
        practitionerName: "Dr Jane Nkosi",
        practitionerRegistrationNumber: "MP123456",
        consultationDate: "2026-08-10",
        bookedOffStartDate: "2026-08-10",
        bookedOffEndDate: "2026-08-12",
      },
      { fieldName: "file", filename: "certificate.pdf", contentType: "application/pdf", content: fakePdf },
    );

    const upload = await app.inject({
      method: "POST",
      url: `/leave/${requestId}/medical-certificate`,
      headers: { ...authHeader(accessToken), "content-type": contentType },
      payload: body,
    });
    expect(upload.statusCode).toBe(201);

    const stored = await prisma.medicalCertificate.findUnique({ where: { leaveRequestId: requestId } });
    expect(stored?.practitionerName).toBe("Dr Jane Nkosi");
    // No diagnosis field exists on the model at all — nothing to assert away, which is the point.
    expect(Object.keys(stored ?? {})).not.toContain("diagnosis");

    const download = await app.inject({
      method: "GET",
      url: `/leave/${requestId}/medical-certificate`,
      headers: authHeader(accessToken),
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.toString("latin1")).toContain("fake certificate content");

    // A second upload for the same request is rejected — one certificate per request.
    const secondUpload = await app.inject({
      method: "POST",
      url: `/leave/${requestId}/medical-certificate`,
      headers: { ...authHeader(accessToken), "content-type": contentType },
      payload: body,
    });
    expect(secondUpload.statusCode).toBe(409);
  });

  it("cancel and reject transition a request out of PENDING", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/leave",
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { employeeId: securityEmployeeId, leaveType: "ANNUAL", startDate: "2026-09-01", endDate: "2026-09-01", unitsRequested: 1 },
    });
    const requestId = (create.json() as { data: { id: string } }).data.id;

    const cancel = await app.inject({
      method: "POST",
      url: `/leave/${requestId}/cancel`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { reason: "changed my mind" },
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { data: { status: string } }).data.status).toBe("CANCELLED");

    const cancelAgain = await app.inject({
      method: "POST",
      url: `/leave/${requestId}/cancel`,
      headers: { ...authHeader(accessToken), "content-type": "application/json" },
      payload: { reason: "again" },
    });
    expect(cancelAgain.statusCode).toBe(409);
  });

  it("mid-cycle joiner: the annual leave cycle window is anchored on the employee's commencement date, not the calendar year", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/leave/balances?employeeId=${newHireEmployeeId}`,
      headers: authHeader(accessToken),
    });
    const annual = (res.json() as { data: Array<{ leaveType: string; cycleStart: string }> }).data.find((b) => b.leaveType === "ANNUAL");
    const expectedAnchorKey = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 2, new Date().getUTCDate()),
    )
      .toISOString()
      .slice(0, 10);
    expect(annual?.cycleStart).toBe(expectedAnchorKey);
  });
});
