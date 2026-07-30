import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { buildApp } from "../../app.js";
import { prisma } from "../../lib/prisma.js";
import { config } from "../../lib/config.js";
import { hashPassword } from "../../services/auth.service.js";
import { authHeader, isIntegrationDatabaseAvailable } from "../../test-utils/tenant-harness.js";

const dbReady = await isIntegrationDatabaseAvailable();

/**
 * Dashboard active-sites semantics: counts operational ACTIVE sites, not sites
 * with a shift clocked in right now. The delta is sites *added* this month.
 */
describe.runIf(dbReady)("dashboard active sites (PostgreSQL integration)", () => {
  let app: FastifyInstance;
  let companyId: string;
  let accessToken: string;
  const runId = randomBytes(6).toString("hex");

  beforeAll(async () => {
    app = await buildApp();
    const company = await prisma.company.create({ data: { name: `Active Sites Co ${runId}` } });
    companyId = company.id;
    const user = await prisma.user.create({
      data: {
        companyId,
        name: "Sites Admin",
        email: `sites-admin-${runId}@plethora-test.local`,
        passwordHash: await hashPassword("dashboard-test-password-32chars!!"),
      },
    });
    await prisma.company.update({ where: { id: companyId }, data: { ownerUserId: user.id } });
    accessToken = jwt.sign(
      { sub: user.id, email: user.email, companyId },
      config.jwt.accessSecret,
      { expiresIn: "1h" }
    );
  });

  afterAll(async () => {
    await prisma.company.deleteMany({ where: { id: companyId } });
    await app.close();
  });

  async function getDashboard(query = "") {
    const response = await app.inject({
      method: "GET",
      url: `/dashboard${query}`,
      headers: authHeader(accessToken),
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it("counts ACTIVE sites and excludes inactive ones", async () => {
    const before = await getDashboard();
    const baseline = before.activeSitesCount;

    await prisma.site.create({
      data: { companyId, name: `Active Site ${runId}`, siteStatus: "ACTIVE" },
    });
    await prisma.site.create({
      data: { companyId, name: `Inactive Site ${runId}`, siteStatus: "INACTIVE" },
    });

    const after = await getDashboard();
    expect(after.activeSitesCount).toBe(baseline + 1);
  });

  it("reports the delta as sites added this month, not a month-over-month change", async () => {
    // A site backdated to before this month must not count toward the delta.
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 2);
    const old = await prisma.site.create({
      data: { companyId, name: `Old Site ${runId}`, siteStatus: "ACTIVE" },
    });
    await prisma.site.update({ where: { id: old.id }, data: { createdAt: lastMonth } });

    const body = await getDashboard();
    // The site created in the previous test is this month; the backdated one is not.
    expect(body.activeSitesDelta).toBe(1);
    expect(body.activeSitesAddedThisMonth).toBe(body.activeSitesDelta);
  });

  it("honours the siteIds filter", async () => {
    const target = await prisma.site.create({
      data: { companyId, name: `Filtered Site ${runId}`, siteStatus: "ACTIVE" },
    });

    const body = await getDashboard(`?siteIds=${target.id}`);
    expect(body.activeSitesCount).toBe(1);
  });
});
