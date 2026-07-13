import { randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import type { UserRole } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { config } from "../lib/config.js";
import { hashPassword } from "../services/auth.service.js";
import { grantSystemOwner, setUserPermissions } from "../services/user-access.service.js";
import {
  permissionsForPreset,
  type PresetKey,
} from "../lib/permissions.js";

export const DEFAULT_TEST_MODULE_ACCESS = [
  "/",
  "/employees",
  "/sites",
  "/rostering",
  "/attendance",
  "/payroll",
  "/settings",
  "/reports",
  "/tasks",
  "/whatsapp",
] as const;

export type TenantCompanyFixture = {
  companyId: string;
  userId: string;
  email: string;
  accessToken: string;
  employeeId: string;
  employeeGroupId: string;
  siteId: string;
  postId: string;
  shiftId: string;
  attendanceId: string;
  payrollRunId: string;
  taskId: string;
  whatsAppMessageId: string;
};

export type TenantFixture = {
  runId: string;
  tenantA: TenantCompanyFixture;
  tenantB: TenantCompanyFixture;
  teardown: () => Promise<void>;
};

export function signAccessToken(user: {
  id: string;
  email: string;
  companyId: string;
  role: UserRole;
  accessVersion?: number;
  moduleAccess?: string[] | null;
}): string {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      companyId: user.companyId,
      role: user.role,
      accessVersion: user.accessVersion ?? 1,
      ...(user.moduleAccess?.length ? { moduleAccess: user.moduleAccess } : {}),
    },
    config.jwt.accessSecret,
    { expiresIn: "1h" }
  );
}

async function provisionCompany(label: "A" | "B", runId: string): Promise<TenantCompanyFixture> {
  const suffix = `${label.toLowerCase()}-${runId}`;
  const company = await prisma.company.create({
    data: { name: `Tenant Test Co ${label} ${runId}` },
  });

  const email = `tenant-admin-${suffix}@plethora-test.local`;
  const user = await prisma.user.create({
    data: {
      companyId: company.id,
      name: `Admin ${label}`,
      email,
      passwordHash: await hashPassword("tenant-test-password-32chars!!"),
      role: "admin",
      isSystemOwner: true,
      accessVersion: 1,
      moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
    },
  });

  await grantSystemOwner(user.id);
  const accessRecord = await prisma.user.findUnique({
    where: { id: user.id },
    select: { accessVersion: true },
  });

  const group = await prisma.employeeGroup.create({
    data: {
      companyId: company.id,
      name: `Default ${label}`,
      sortOrder: 0,
    },
  });

  const employee = await prisma.employee.create({
    data: {
      companyId: company.id,
      employeeNumber: `EMP-${suffix}`,
      firstName: "Test",
      lastName: `Employee${label}`,
      status: "active",
      employeeType: "office",
      monthlySalary: 15000,
      groupId: group.id,
    },
  });

  const site = await prisma.site.create({
    data: {
      companyId: company.id,
      name: `Site ${label}`,
    },
  });

  const post = await prisma.sitePost.create({
    data: {
      siteId: site.id,
      name: "Day Post",
    },
  });
  await prisma.coverageRequirement.create({
    data: {
      siteId: site.id,
      sitePostId: post.id,
      shiftTypeCode: "day",
      guardsRequired: 1,
      genderRule: "any",
    },
  });

  const shiftStart = new Date("2026-08-01T06:00:00.000Z");
  const shiftEnd = new Date("2026-08-01T18:00:00.000Z");

  const shift = await prisma.shift.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      siteId: post.siteId,
      shiftType: "day",
      legacyPostName: post.name,
      startTime: shiftStart,
      endTime: shiftEnd,
      status: "assigned",
    },
  });

  const attendance = await prisma.attendance.create({
    data: {
      shiftId: shift.id,
      status: "pending",
    },
  });

  const payrollRun = await prisma.payrollRun.create({
    data: {
      companyId: company.id,
      periodStart: new Date("2026-07-01T00:00:00.000Z"),
      periodEnd: new Date("2026-07-31T23:59:59.999Z"),
      status: "draft",
    },
  });

  const task = await prisma.task.create({
    data: {
      companyId: company.id,
      title: `Task ${label}`,
      status: "todo",
      priority: "medium",
      createdById: user.id,
    },
  });

  const whatsAppMessage = await prisma.whatsAppMessage.create({
    data: {
      companyId: company.id,
      employeeId: employee.id,
      direction: "inbound",
      type: "text",
      text: `Hello from ${label}`,
    },
  });

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    companyId: company.id,
    role: user.role,
    accessVersion: accessRecord?.accessVersion ?? 1,
    moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
  });

  return {
    companyId: company.id,
    userId: user.id,
    email: user.email,
    accessToken,
    employeeId: employee.id,
    employeeGroupId: group.id,
    siteId: site.id,
    postId: post.id,
    shiftId: shift.id,
    attendanceId: attendance.id,
    payrollRunId: payrollRun.id,
    taskId: task.id,
    whatsAppMessageId: whatsAppMessage.id,
  };
}

/** Provision a system-owner test user with a valid access token for integration tests. */
export async function provisionTestAdminUser(
  companyId: string,
  email: string,
  name: string
): Promise<{ userId: string; accessToken: string }> {
  const modules = [...DEFAULT_TEST_MODULE_ACCESS];
  const user = await prisma.user.create({
    data: {
      companyId,
      name,
      email,
      passwordHash: await hashPassword("integration-test-password-32chars!!"),
      role: "admin",
      isSystemOwner: true,
      moduleAccess: modules,
    },
  });
  await grantSystemOwner(user.id);
  const accessRecord = await prisma.user.findUnique({
    where: { id: user.id },
    select: { accessVersion: true },
  });
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    companyId,
    role: user.role,
    accessVersion: accessRecord?.accessVersion ?? 1,
    moduleAccess: modules,
  });
  return { userId: user.id, accessToken };
}

/** Provision a user with a specific permission preset (non-system-owner). */
export async function provisionTestUserWithPreset(
  companyId: string,
  email: string,
  name: string,
  presetKey: PresetKey,
  role: UserRole = "admin"
): Promise<{ userId: string; accessToken: string; accessVersion: number }> {
  const user = await prisma.user.create({
    data: {
      companyId,
      name,
      email,
      passwordHash: await hashPassword("integration-test-password-32chars!!"),
      role,
      isSystemOwner: false,
      moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
    },
  });
  const record = await setUserPermissions(user.id, permissionsForPreset(presetKey));
  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    companyId,
    role: user.role,
    accessVersion: record.accessVersion,
    moduleAccess: [...DEFAULT_TEST_MODULE_ACCESS],
  });
  return { userId: user.id, accessToken, accessVersion: record.accessVersion };
}

/** Returns true when DATABASE_URL is set and PostgreSQL accepts connections. */
export async function isIntegrationDatabaseAvailable(): Promise<boolean> {
  if (!process.env.DATABASE_URL?.trim()) return false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/** Provision two isolated tenants with sample records for route-level isolation tests. */
export async function provisionTenantFixture(): Promise<TenantFixture> {
  const runId = randomBytes(6).toString("hex");
  const tenantA = await provisionCompany("A", runId);
  const tenantB = await provisionCompany("B", runId);

  return {
    runId,
    tenantA,
    tenantB,
    teardown: async () => {
      await prisma.company.deleteMany({
        where: { id: { in: [tenantA.companyId, tenantB.companyId] } },
      });
    },
  };
}

export function authHeader(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
