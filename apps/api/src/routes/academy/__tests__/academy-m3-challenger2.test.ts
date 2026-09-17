import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

// ===========================================================================
// IN-MEMORY COMPREHENSIVE STORE FOR CHALLENGER 2 (FINANCIAL & GATING STRESS)
// ===========================================================================

interface StateStore {
  students: any[];
  courses: any[];
  branches: any[];
  classrooms: any[];
  courseRuns: any[];
  enrolments: any[];
  feePlans: any[];
  invoices: any[];
  invoiceLines: any[];
  payments: any[];
  receipts: any[];
  attendanceSessions: any[];
  attendanceRecords: any[];
  assessments: any[];
  certificates: any[];
  renewalAlerts: any[];
  studentDocuments: any[];
  academyProfiles: any[];
  employees: any[];
}

function createInitialState(): StateStore {
  return {
    students: [],
    courses: [],
    branches: [],
    classrooms: [],
    courseRuns: [],
    enrolments: [],
    feePlans: [],
    invoices: [],
    invoiceLines: [],
    payments: [],
    receipts: [],
    attendanceSessions: [],
    attendanceRecords: [],
    assessments: [],
    certificates: [],
    renewalAlerts: [],
    studentDocuments: [],
    academyProfiles: [
      {
        companyId: "company-alpha",
        trainingCentreName: "Alpha Security Academy",
        psiraTrainingProviderNumber: "TP-12345",
        psiraBusinessRegistrationNumber: "BR-67890",
        accreditationStatus: "active",
        reAccreditationDueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    ],
    employees: [],
  };
}

let store = createInitialState();

function matchesFilter(item: any, filter: any): boolean {
  if (!filter) return true;
  for (const [key, val] of Object.entries(filter)) {
    if (key === "deletedAt" && val === null) {
      if (item.deletedAt != null) return false;
      continue;
    }
    if (key === "status" && typeof val === "object" && val !== null) {
      if ("notIn" in val && (val as any).notIn.includes(item.status)) return false;
      if ("not" in val && item.status === (val as any).not) return false;
      if ("in" in val && !(val as any).in.includes(item.status)) return false;
      continue;
    }
    if (key === "verificationStatus" && typeof val === "object" && val !== null) {
      if ("in" in val && !(val as any).in.includes(item.verificationStatus)) return false;
      continue;
    }
    if (key === "id" && typeof val === "object" && val !== null && "in" in val) {
      if (!(val as any).in.includes(item.id)) return false;
      continue;
    }
    if (key === "studentId_courseRunId" && typeof val === "object" && val !== null) {
      const pair = val as { studentId: string; courseRunId: string };
      if (item.studentId !== pair.studentId || item.courseRunId !== pair.courseRunId) return false;
      continue;
    }
    if (key === "courseRun" && typeof val === "object" && val !== null) {
      const run = store.courseRuns.find((r) => r.id === item.courseRunId);
      if (!run || !matchesFilter(run, val)) return false;
      continue;
    }
    if (key === "result" && typeof val === "object" && val !== null && "in" in val) {
      if (!(val as any).in.includes(item.result)) return false;
      continue;
    }
    if (item[key] !== val) {
      return false;
    }
  }
  return true;
}

function hydrateRelations(collectionName: string, item: any, include?: any): any {
  if (!item || !include) return item;
  const clone = { ...item };

  if (collectionName === "courseRuns") {
    if (include.course) {
      clone.course = store.courses.find((c) => c.id === item.courseId) ?? null;
    }
    if (include.branch) {
      clone.branch = store.branches.find((b) => b.id === item.academyBranchId) ?? null;
    }
    if (include.academyAttendanceSessions) {
      clone.academyAttendanceSessions = store.attendanceSessions.filter(
        (s) => s.courseRunId === item.id
      );
    }
    if (include._count) {
      clone._count = {
        enrolments: store.enrolments.filter((e) => e.courseRunId === item.id).length,
      };
    }
  }

  if (collectionName === "enrolments") {
    if (include.student) {
      clone.student = store.students.find((s) => s.id === item.studentId) ?? null;
    }
    if (include.courseRun) {
      const run = store.courseRuns.find((r) => r.id === item.courseRunId) ?? null;
      clone.courseRun = run ? hydrateRelations("courseRuns", run, include.courseRun.include) : null;
    }
    if (include.feePlan) {
      clone.feePlan = store.feePlans.find((f) => f.id === item.feePlanId) ?? null;
    }
    if (include.academyAttendanceRecords) {
      clone.academyAttendanceRecords = store.attendanceRecords.filter(
        (ar) => ar.enrolmentId === item.id
      );
    }
  }

  if (collectionName === "invoices") {
    if (include.items) {
      clone.items = store.invoiceLines.filter((l) => l.invoiceId === item.id);
    }
    if (include.payments) {
      const paymentWhere = include.payments.where ?? {};
      const pays = store.payments
        .filter((p) => p.invoiceId === item.id)
        .filter((p) => matchesFilter(p, paymentWhere));
      clone.payments = pays.map((p) => hydrateRelations("payments", p, include.payments.include));
    }
    if (include.student) {
      clone.student = store.students.find((s) => s.id === item.studentId) ?? null;
    }
  }

  if (collectionName === "payments") {
    if (include.receipt) {
      clone.receipt = store.receipts.find((r) => r.paymentId === item.id) ?? null;
    }
  }

  if (collectionName === "certificates") {
    if (include.learner) {
      clone.learner = store.students.find((s) => s.id === item.learnerId) ?? null;
    }
    if (include.course) {
      clone.course = store.courses.find((c) => c.id === item.courseId) ?? null;
    }
    if (include.enrolment) {
      clone.enrolment = store.enrolments.find((e) => e.id === item.enrolmentId) ?? null;
    }
  }

  return clone;
}

vi.mock("../../../lib/prisma.js", () => {
  const mockClient = {
    academyProfile: {
      findUnique: vi.fn(async ({ where }: any) => {
        return store.academyProfiles.find((p) => p.companyId === where.companyId) ?? null;
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return store.academyProfiles.find((p) => matchesFilter(p, where)) ?? null;
      }),
    },
    student: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const s = store.students.find((item) => matchesFilter(item, where));
        return s ? hydrateRelations("students", s, include) : null;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.students
          .filter((item) => matchesFilter(item, where))
          .map((s) => hydrateRelations("students", s, include));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.students.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const created = {
          id: `stu-${Date.now()}-${Math.random()}`,
          createdAt: new Date(),
          status: "active",
          adminFeeStatus: "paid",
          psiraPreRegistrationStatus: "completed",
          ...data,
        };
        store.students.push(created);
        return hydrateRelations("students", created, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.students.findIndex((s) => s.id === where.id);
        if (idx === -1) throw new Error("Student not found");
        store.students[idx] = { ...store.students[idx], ...data };
        return hydrateRelations("students", store.students[idx], include);
      }),
    },
    studentDocument: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.studentDocuments.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.studentDocuments.filter((item) => matchesFilter(item, where));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.studentDocuments.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data }: any) => {
        const doc = { id: `doc-${Date.now()}-${Math.random()}`, createdAt: new Date(), ...data };
        store.studentDocuments.push(doc);
        return doc;
      }),
    },
    course: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.courses.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.courses.filter((item) => matchesFilter(item, where));
      }),
      create: vi.fn(async ({ data }: any) => {
        const c = { id: `course-${Date.now()}-${Math.random()}`, ...data };
        store.courses.push(c);
        return c;
      }),
    },
    academyBranch: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.branches.find((item) => matchesFilter(item, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const b = { id: `branch-${Date.now()}-${Math.random()}`, ...data };
        store.branches.push(b);
        return b;
      }),
    },
    academyClassroom: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.classrooms.find((item) => matchesFilter(item, where)) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const cr = { id: `classroom-${Date.now()}-${Math.random()}`, ...data };
        store.classrooms.push(cr);
        return cr;
      }),
    },
    courseRun: {
      findFirst: vi.fn(async ({ where, include, select }: any) => {
        const r = store.courseRuns.find((item) => matchesFilter(item, where));
        return r ? hydrateRelations("courseRuns", r, include ?? select) : null;
      }),
      findMany: vi.fn(async ({ where, include, select }: any) => {
        return store.courseRuns
          .filter((item) => matchesFilter(item, where))
          .map((r) => hydrateRelations("courseRuns", r, include ?? select));
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const run = {
          id: `run-${Date.now()}-${Math.random()}`,
          enrolledCount: 0,
          status: "open",
          capacity: 20,
          ...data,
        };
        store.courseRuns.push(run);
        return hydrateRelations("courseRuns", run, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.courseRuns.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error("CourseRun not found");
        let updated = { ...store.courseRuns[idx] };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in v) {
            updated[k] = (updated[k] ?? 0) + (v as any).increment;
          } else if (v && typeof v === "object" && "decrement" in v) {
            updated[k] = (updated[k] ?? 0) - (v as any).decrement;
          } else {
            updated[k] = v;
          }
        }
        store.courseRuns[idx] = updated;
        return hydrateRelations("courseRuns", updated, include);
      }),
    },
    enrolment: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const e = store.enrolments.find((item) => matchesFilter(item, where));
        return e ? hydrateRelations("enrolments", e, include) : null;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const e = store.enrolments.find((item) => matchesFilter(item, where));
        return e ? hydrateRelations("enrolments", e, include) : null;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.enrolments
          .filter((item) => matchesFilter(item, where))
          .map((e) => hydrateRelations("enrolments", e, include));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.enrolments.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const enr = {
          id: `enr-${Date.now()}-${Math.random()}`,
          financialStatus: "unpaid",
          attendanceStatus: "pending",
          completionStatus: "pending",
          reportingReadinessStatus: "not_started",
          createdAt: new Date(),
          ...data,
        };
        store.enrolments.push(enr);
        return hydrateRelations("enrolments", enr, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.enrolments.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error("Enrolment not found");
        store.enrolments[idx] = { ...store.enrolments[idx], ...data };
        return hydrateRelations("enrolments", store.enrolments[idx], include);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (let i = 0; i < store.enrolments.length; i++) {
          if (matchesFilter(store.enrolments[i], where)) {
            store.enrolments[i] = { ...store.enrolments[i], ...data };
            count++;
          }
        }
        return { count };
      }),
      delete: vi.fn(async ({ where }: any) => {
        const idx = store.enrolments.findIndex((e) => e.id === where.id);
        if (idx !== -1) store.enrolments.splice(idx, 1);
        return {};
      }),
    },
    feePlan: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.feePlans.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.feePlans.filter((item) => matchesFilter(item, where));
      }),
    },
    academyInvoice: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const inv = store.invoices.find((item) => matchesFilter(item, where));
        return inv ? hydrateRelations("invoices", inv, include) : null;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const inv = store.invoices.find((item) => item.id === where.id);
        return inv ? hydrateRelations("invoices", inv, include) : null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where, include }: any) => {
        const inv = store.invoices.find((item) => item.id === where.id);
        if (!inv) throw new Error("Invoice not found");
        return hydrateRelations("invoices", inv, include);
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.invoices
          .filter((item) => matchesFilter(item, where))
          .map((inv) => hydrateRelations("invoices", inv, include));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.invoices.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const items = data.items?.create ?? [];
        const inv = {
          id: `inv-${Date.now()}-${Math.random()}`,
          status: "draft",
          ...data,
        };
        delete inv.items;
        store.invoices.push(inv);
        for (const it of items) {
          store.invoiceLines.push({
            id: `line-${Date.now()}-${Math.random()}`,
            invoiceId: inv.id,
            ...it,
          });
        }
        return hydrateRelations("invoices", inv, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.invoices.findIndex((inv) => inv.id === where.id);
        if (idx === -1) throw new Error("Invoice not found");
        store.invoices[idx] = { ...store.invoices[idx], ...data };
        return hydrateRelations("invoices", store.invoices[idx], include);
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (let i = 0; i < store.invoices.length; i++) {
          if (matchesFilter(store.invoices[i], where)) {
            store.invoices[i] = { ...store.invoices[i], ...data };
            count++;
          }
        }
        return { count };
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = store.invoices.length;
        store.invoices = store.invoices.filter((item) => !matchesFilter(item, where));
        return { count: before - store.invoices.length };
      }),
    },
    academyInvoiceLine: {
      findMany: vi.fn(async ({ where }: any) => {
        return store.invoiceLines.filter((item) => matchesFilter(item, where));
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = store.invoiceLines.length;
        store.invoiceLines = store.invoiceLines.filter((item) => !matchesFilter(item, where));
        return { count: before - store.invoiceLines.length };
      }),
    },
    academyPayment: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const p = store.payments.find((item) => matchesFilter(item, where));
        return p ? hydrateRelations("payments", p, include) : null;
      }),
      findFirstOrThrow: vi.fn(async ({ where, include }: any) => {
        const p = store.payments.find((item) => matchesFilter(item, where));
        if (!p) throw new Error("Payment not found");
        return hydrateRelations("payments", p, include);
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.payments
          .filter((item) => matchesFilter(item, where))
          .map((p) => hydrateRelations("payments", p, include));
      }),
      create: vi.fn(async ({ data }: any) => {
        const p = {
          id: `pay-${Date.now()}-${Math.random()}`,
          verificationStatus: "pending",
          ...data,
        };
        store.payments.push(p);
        return p;
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.payments.findIndex((p) => p.id === where.id);
        if (idx === -1) throw new Error("Payment not found");
        store.payments[idx] = { ...store.payments[idx], ...data };
        return hydrateRelations("payments", store.payments[idx], include);
      }),
    },
    academyReceipt: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.receipts.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.receipts.filter((item) => matchesFilter(item, where));
      }),
      create: vi.fn(async ({ data }: any) => {
        const r = { id: `rec-${Date.now()}-${Math.random()}`, ...data };
        store.receipts.push(r);
        return r;
      }),
    },
    academyAttendanceSession: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.attendanceSessions.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.attendanceSessions.filter((item) => matchesFilter(item, where));
      }),
      create: vi.fn(async ({ data }: any) => {
        const s = { id: `session-${Date.now()}-${Math.random()}`, ...data };
        store.attendanceSessions.push(s);
        return s;
      }),
    },
    academyAttendanceRecord: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.attendanceRecords.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.attendanceRecords.filter((item) => matchesFilter(item, where));
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        const idx = store.attendanceRecords.findIndex(
          (r) =>
            r.sessionId === where.sessionId_enrolmentId?.sessionId &&
            r.enrolmentId === where.sessionId_enrolmentId?.enrolmentId
        );
        if (idx !== -1) {
          store.attendanceRecords[idx] = { ...store.attendanceRecords[idx], ...update };
          return store.attendanceRecords[idx];
        }
        const rec = { id: `rec-${Date.now()}-${Math.random()}`, ...create };
        store.attendanceRecords.push(rec);
        return rec;
      }),
    },
    academyAssessment: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.assessments.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.assessments.filter((item) => matchesFilter(item, where));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.assessments.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data }: any) => {
        const ass = { id: `ass-${Date.now()}-${Math.random()}`, ...data };
        store.assessments.push(ass);
        return ass;
      }),
    },
    academyCertificate: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const c = store.certificates.find((item) => matchesFilter(item, where));
        return c ? hydrateRelations("certificates", c, include) : null;
      }),
      findUnique: vi.fn(async ({ where, include }: any) => {
        const c = store.certificates.find(
          (item) => item.verificationCode === where.verificationCode || item.id === where.id
        );
        return c ? hydrateRelations("certificates", c, include) : null;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.certificates
          .filter((item) => matchesFilter(item, where))
          .map((c) => hydrateRelations("certificates", c, include));
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const cert = {
          id: `cert-${Date.now()}-${Math.random()}`,
          certificateNumber: "CERT-00002",
          verificationCode: "VER-1234-5678-90AB",
          status: "active",
          createdAt: new Date(),
          ...data,
        };
        store.certificates.push(cert);
        return hydrateRelations("certificates", cert, include);
      }),
    },
    academyRenewalAlert: {
      create: vi.fn(async ({ data }: any) => {
        const alert = { id: `alert-${Date.now()}`, ...data };
        store.renewalAlerts.push(alert);
        return alert;
      }),
    },
    employee: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.employees.find((item) => matchesFilter(item, where)) ?? null;
      }),
    },
    $transaction: vi.fn(async (fnOrArray: any) => {
      if (typeof fnOrArray === "function") {
        return await fnOrArray(mockClient);
      }
      return Promise.all(fnOrArray);
    }),
    $queryRaw: vi.fn(async () => []),
    $executeRaw: vi.fn(async () => 1),
  };

  return { prisma: mockClient };
});

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: async (req: any) => {
    req.user = {
      sub: "user-challenger-2",
      email: "challenger2@example.com",
      companyId: "company-alpha",
      capabilities: {
        "/academy": ["view", "create", "edit", "delete", "approve"],
      },
    };
  },
}));

vi.mock("../../../middleware/authorization.js", () => ({
  requireCapability: () => async () => {},
  requireCrudCapability: () => async () => {},
}));

import { academyEnrolmentsRoutes } from "../enrolments.js";
import { academyInvoicesRoutes } from "../invoices.js";
import { academyPaymentsRoutes } from "../payments.js";
import { academyCertificatesRoutes } from "../certificates.js";

import * as enrolmentService from "../../../services/academy-enrolment.service.js";
import * as financeService from "../../../services/academy-finance.service.js";
import * as certificateService from "../../../services/academy-certificate.service.js";
import * as studentService from "../../../services/academy-student.service.js";
import { prisma } from "../../../lib/prisma.js";

describe("Milestone 3 Challenger 2: Financial Reconciliation, Deletion Protection & Certificate Tuition Gate Stress Harness", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    store = createInitialState();
    vi.clearAllMocks();

    app = Fastify();
    await app.register(academyEnrolmentsRoutes, { prefix: "/enrolments" });
    await app.register(academyInvoicesRoutes, { prefix: "/invoices" });
    await app.register(academyPaymentsRoutes, { prefix: "/payments" });
    await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
    await app.ready();
  });

  // =========================================================================
  // 1. FINANCIAL RECONCILIATION: ZERO-FEE COURSES & 100% DISCOUNT INVOICES
  // =========================================================================
  describe("1. Financial Reconciliation: Zero-fee course & 100% discount invoice", () => {
    it("sets enrolment.financialStatus = 'paid' for a zero-fee course with no invoice", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-c2", {
        firstName: "Karabo",
        lastName: "Seboko",
      });

      const course = {
        id: "c-zero-1",
        companyId: "company-alpha",
        code: "ZERO-101",
        title: "Free Community Security Awareness",
        feeAmount: new Prisma.Decimal("0"), // Zero fee course
        requiresDocuments: false,
        requiresAssessment: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = {
        id: "run-zero-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-ZERO-1",
        status: "open",
        capacity: 25,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      // Create enrolment without creating an invoice
      const { enrolment } = await enrolmentService.createEnrolment("company-alpha", "user-c2", {
        studentId: student.id,
        courseRunId: run.id,
        createInvoice: false,
      });
      expect(enrolment).toBeDefined();

      // Explicitly trigger syncEnrolmentFinancialStatus
      await financeService.syncEnrolmentFinancialStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // Empirical assertion: financialStatus MUST be "paid"
      const refreshed = store.enrolments.find((e) => e.id === enrolment.id);
      expect(refreshed.financialStatus).toBe("paid");
      expect(refreshed.financialStatus).not.toBe("unpaid");
    });

    it("sets enrolment.financialStatus = 'paid' for a 100% discount draft invoice", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-c2", {
        firstName: "Nthabiseng",
        lastName: "Khosa",
      });

      const course = {
        id: "c-paid-course-1",
        companyId: "company-alpha",
        code: "DISC-100",
        title: "Specialized Guarding",
        feeAmount: new Prisma.Decimal("1200"),
        requiresDocuments: false,
        requiresAssessment: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = {
        id: "run-disc-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-DISC-1",
        status: "open",
        capacity: 20,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      const { enrolment } = await enrolmentService.createEnrolment("company-alpha", "user-c2", {
        studentId: student.id,
        courseRunId: run.id,
        createInvoice: false,
      });

      // Draft invoice with 100% discount: subtotal 1200, discount 1200 -> totalAmount = 0
      const draftInvoice = {
        id: "inv-draft-100disc",
        companyId: "company-alpha",
        studentId: student.id,
        enrolmentId: enrolment.id,
        status: "draft",
        subtotal: new Prisma.Decimal("1200"),
        discountAmount: new Prisma.Decimal("1200"),
        totalAmount: new Prisma.Decimal("0"),
      };
      store.invoices.push(draftInvoice);

      await financeService.syncEnrolmentFinancialStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // Empirical assertion: 100% discount draft invoice transitions financialStatus to "paid"
      const refreshed = store.enrolments.find((e) => e.id === enrolment.id);
      expect(refreshed.financialStatus).toBe("paid");
    });

    it("sets enrolment.financialStatus = 'paid' for an issued invoice with 100% discount (0 total due)", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-c2", {
        firstName: "Tshepo",
        lastName: "Mokoena",
      });

      const course = {
        id: "c-issued-disc",
        companyId: "company-alpha",
        code: "FULL-DISC",
        title: "Full Bursary Guard Course",
        feeAmount: new Prisma.Decimal("2500"),
        requiresDocuments: false,
        requiresAssessment: false,
      };
      store.courses.push(course);

      const run = {
        id: "run-issued-disc",
        companyId: "company-alpha",
        courseId: course.id,
        status: "open",
      };
      store.courseRuns.push(run);

      const { enrolment } = await enrolmentService.createEnrolment("company-alpha", "user-c2", {
        studentId: student.id,
        courseRunId: run.id,
        createInvoice: false,
      });

      // Issued invoice with 0 total due (bursary / 100% discount)
      const issuedInvoice = {
        id: "inv-issued-zero-due",
        companyId: "company-alpha",
        studentId: student.id,
        enrolmentId: enrolment.id,
        status: "issued",
        dueDate: new Date("2026-11-30"),
        subtotal: new Prisma.Decimal("2500"),
        discountAmount: new Prisma.Decimal("2500"),
        totalAmount: new Prisma.Decimal("0"),
      };
      store.invoices.push(issuedInvoice);

      await financeService.syncEnrolmentFinancialStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // Empirical assertion: totalDue <= 0 on issued invoice results in "paid"
      const refreshed = store.enrolments.find((e) => e.id === enrolment.id);
      expect(refreshed.financialStatus).toBe("paid");
    });

    it("tracks incremental financialStatus transitions: unpaid -> partial -> paid across payments", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-c2", {
        firstName: "Precious",
        lastName: "Zulu",
      });

      const course = {
        id: "c-partial-flow",
        companyId: "company-alpha",
        feeAmount: new Prisma.Decimal("1000"),
        requiresDocuments: false,
      };
      store.courses.push(course);

      const run = { id: "run-part-1", companyId: "company-alpha", courseId: course.id, status: "open" };
      store.courseRuns.push(run);

      const { enrolment } = await enrolmentService.createEnrolment("company-alpha", "user-c2", {
        studentId: student.id,
        courseRunId: run.id,
      });

      const invoice = {
        id: "inv-part-1",
        companyId: "company-alpha",
        studentId: student.id,
        enrolmentId: enrolment.id,
        status: "issued",
        dueDate: new Date("2026-11-30"),
        totalAmount: new Prisma.Decimal("1000"),
      };
      store.invoices.push(invoice);

      // 1. Initially unpaid
      await financeService.syncEnrolmentFinancialStatus(prisma as any, enrolment.id, "company-alpha");
      expect(store.enrolments.find((e) => e.id === enrolment.id).financialStatus).toBe("unpaid");

      // 2. Verified payment 1: 400 / 1000 -> partial
      const pay1 = {
        id: "pay-part-1",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        amount: new Prisma.Decimal("400"),
        verificationStatus: "verified",
      };
      store.payments.push(pay1);
      await financeService.syncEnrolmentFinancialStatus(prisma as any, enrolment.id, "company-alpha");
      expect(store.enrolments.find((e) => e.id === enrolment.id).financialStatus).toBe("partial");

      // 3. Verified payment 2: 600 / 1000 -> total 1000 / 1000 -> paid
      const pay2 = {
        id: "pay-part-2",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        amount: new Prisma.Decimal("600"),
        verificationStatus: "verified",
      };
      store.payments.push(pay2);
      await financeService.syncEnrolmentFinancialStatus(prisma as any, enrolment.id, "company-alpha");
      expect(store.enrolments.find((e) => e.id === enrolment.id).financialStatus).toBe("paid");
    });
  });

  // =========================================================================
  // 2. PAYMENT VERIFICATION AGAINST CANCELLED INVOICE REJECTION (400 BAD REQUEST)
  // =========================================================================
  describe("2. Payment verification against cancelled invoice rejection (400 Bad Request)", () => {
    it("rejects verifyPayment with 400 Bad Request when parent invoice is cancelled (domain service)", async () => {
      const invoice = {
        id: "inv-cancelled-service",
        companyId: "company-alpha",
        studentId: "stu-pay-test",
        invoiceNumber: "INV-CANC-001",
        status: "cancelled", // Inactive/cancelled invoice!
        totalAmount: new Prisma.Decimal("1500"),
      };
      store.invoices.push(invoice);

      const payment = {
        id: "pay-on-cancelled-inv",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        studentId: "stu-pay-test",
        amount: new Prisma.Decimal("1500"),
        verificationStatus: "pending",
      };
      store.payments.push(payment);

      // Empirical assertion: verifyPayment must reject
      await expect(
        financeService.verifyPayment("company-alpha", "user-c2", payment.id)
      ).rejects.toThrow("Cannot verify payment against a cancelled invoice");

      // Payment remains pending, no receipt generated
      const untouchedPayment = store.payments.find((p) => p.id === payment.id);
      expect(untouchedPayment.verificationStatus).toBe("pending");
      expect(store.receipts).toHaveLength(0);
    });

    it("rejects POST /payments/:id/verify with HTTP 400 Bad Request when invoice is cancelled (HTTP route)", async () => {
      const invoice = {
        id: "inv-cancelled-http",
        companyId: "company-alpha",
        studentId: "stu-pay-http",
        invoiceNumber: "INV-CANC-002",
        status: "cancelled",
        totalAmount: new Prisma.Decimal("800"),
      };
      store.invoices.push(invoice);

      const payment = {
        id: "pay-cancelled-http",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        studentId: "stu-pay-http",
        amount: new Prisma.Decimal("800"),
        verificationStatus: "pending",
      };
      store.payments.push(payment);

      const res = await app.inject({
        method: "POST",
        url: `/payments/${payment.id}/verify`,
      });

      // Empirical assertion: 400 Bad Request contract
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe("Validation error");
      expect(json.message).toBe("Cannot verify payment against a cancelled invoice");
      expect(json.statusCode).toBe(400);

      // Store invariant: no receipt was created
      expect(store.receipts.find((r) => r.paymentId === payment.id)).toBeUndefined();
    });

    it("rejects verifyPayment with 409 Conflict if payment is already verified", async () => {
      const invoice = {
        id: "inv-active",
        companyId: "company-alpha",
        status: "issued",
        totalAmount: new Prisma.Decimal("500"),
      };
      store.invoices.push(invoice);

      const payment = {
        id: "pay-already-verified",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        amount: new Prisma.Decimal("500"),
        verificationStatus: "verified", // Already verified!
      };
      store.payments.push(payment);

      const res = await app.inject({
        method: "POST",
        url: `/payments/${payment.id}/verify`,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Payment is not pending verification");
    });
  });

  // =========================================================================
  // 3. ENROLMENT DELETION PROTECTION WITH VERIFIED PAYMENTS (409 CONFLICT)
  // =========================================================================
  describe("3. Enrolment deletion protection with verified payments (409 Conflict)", () => {
    it("rejects cancelOrDeleteEnrolment with 409 Conflict when verified payments exist (domain service)", async () => {
      const run = { id: "run-protect-1", companyId: "company-alpha", enrolledCount: 3 };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-with-verified-pay",
        companyId: "company-alpha",
        studentId: "stu-guard-1",
        courseRunId: run.id,
      };
      store.enrolments.push(enrolment);

      const invoice = {
        id: "inv-linked-verified",
        companyId: "company-alpha",
        enrolmentId: enrolment.id,
        status: "issued",
      };
      store.invoices.push(invoice);

      const verifiedPayment = {
        id: "pay-verified-guard",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        verificationStatus: "verified",
        amount: new Prisma.Decimal("1000"),
      };
      store.payments.push(verifiedPayment);

      // Empirical assertion: Domain service throws 409 AcademyConflictError
      await expect(
        enrolmentService.cancelOrDeleteEnrolment("company-alpha", enrolment.id, "user-c2")
      ).rejects.toThrow("Cannot delete enrolment with verified payments");

      // Invariants preserved: enrolment still exists, enrolledCount unchanged
      expect(store.enrolments.find((e) => e.id === enrolment.id)).toBeDefined();
      expect(store.courseRuns.find((r) => r.id === run.id).enrolledCount).toBe(3);
    });

    it("rejects DELETE /enrolments/:id with HTTP 409 Conflict when verified payments exist (HTTP route)", async () => {
      const run = { id: "run-protect-http", companyId: "company-alpha", enrolledCount: 2 };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-http-protected",
        companyId: "company-alpha",
        studentId: "stu-guard-2",
        courseRunId: run.id,
      };
      store.enrolments.push(enrolment);

      const invoice = {
        id: "inv-http-protected",
        companyId: "company-alpha",
        enrolmentId: enrolment.id,
        status: "issued",
      };
      store.invoices.push(invoice);

      store.payments.push({
        id: "pay-guard-http",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        verificationStatus: "verified",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/enrolments/${enrolment.id}`,
      });

      // Empirical assertion: HTTP 409 Conflict status and envelope
      expect(res.statusCode).toBe(409);
      const json = res.json();
      expect(json.error).toBe("Conflict");
      expect(json.message).toBe("Cannot delete enrolment with verified payments");
      expect(json.statusCode).toBe(409);

      // Enrolment must NOT have been deleted from store
      expect(store.enrolments.find((e) => e.id === enrolment.id)).toBeDefined();
    });

    it("blocks deletion even when verified payment is on secondary linked invoice", async () => {
      const run = { id: "run-multi-inv", companyId: "company-alpha", enrolledCount: 1 };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-multi-inv",
        companyId: "company-alpha",
        courseRunId: run.id,
      };
      store.enrolments.push(enrolment);

      // Invoice 1: no payments
      const inv1 = { id: "inv-1-empty", companyId: "company-alpha", enrolmentId: enrolment.id, status: "draft" };
      // Invoice 2: has verified payment
      const inv2 = { id: "inv-2-paid", companyId: "company-alpha", enrolmentId: enrolment.id, status: "issued" };
      store.invoices.push(inv1, inv2);

      store.payments.push({
        id: "pay-multi-inv-verified",
        companyId: "company-alpha",
        invoiceId: inv2.id,
        verificationStatus: "verified",
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/enrolments/${enrolment.id}`,
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Cannot delete enrolment with verified payments");
    });

    it("allows enrolment deletion when no verified payments exist, cleaning up draft invoices and decrementing enrolledCount", async () => {
      const run = { id: "run-safe-del", companyId: "company-alpha", enrolledCount: 5 };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-safe-del",
        companyId: "company-alpha",
        courseRunId: run.id,
      };
      store.enrolments.push(enrolment);

      const draftInv = {
        id: "inv-safe-draft",
        companyId: "company-alpha",
        enrolmentId: enrolment.id,
        status: "draft",
      };
      store.invoices.push(draftInv);

      // Only unverified/pending payment
      const pendingPayment = {
        id: "pay-pending-safe",
        companyId: "company-alpha",
        invoiceId: draftInv.id,
        verificationStatus: "pending",
      };
      store.payments.push(pendingPayment);

      const res = await app.inject({
        method: "DELETE",
        url: `/enrolments/${enrolment.id}`,
      });

      // HTTP 204 No Content
      expect(res.statusCode).toBe(204);

      // Enrolment deleted
      expect(store.enrolments.find((e) => e.id === enrolment.id)).toBeUndefined();
      // Draft invoice cleaned up
      expect(store.invoices.find((i) => i.id === draftInv.id)).toBeUndefined();
      // enrolledCount decremented from 5 to 4
      expect(store.courseRuns.find((r) => r.id === run.id).enrolledCount).toBe(4);
    });
  });

  // =========================================================================
  // 4. CERTIFICATE TUITION GATE: UNPAID & PARTIAL FINANCIAL STATUS REJECTION
  // =========================================================================
  describe("4. Certificate tuition gate: Attempt issuing when enrolment financialStatus is 'unpaid' or 'partial'", () => {
    it("blocks prerequisite verification when enrolment financialStatus is 'unpaid'", async () => {
      const course = {
        id: "c-cert-gate-1",
        companyId: "company-alpha",
        title: "Cash in Transit Specialization",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const student = { id: "stu-unpaid-cert", companyId: "company-alpha" };
      store.students.push(student);

      const run = { id: "run-unpaid-cert", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-unpaid-cert",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "unpaid", // UNPAID
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      const result = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );

      // Empirical assertion: prerequisite check fails with tuition blocker
      expect(result.ok).toBe(false);
      expect(result.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
    });

    it("blocks prerequisite verification when enrolment financialStatus is 'partial'", async () => {
      const course = {
        id: "c-cert-gate-2",
        companyId: "company-alpha",
        title: "Control Room Operator",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const student = { id: "stu-partial-cert", companyId: "company-alpha" };
      store.students.push(student);

      const run = { id: "run-partial-cert", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-partial-cert",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "partial", // PARTIAL PAYMENT
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      const result = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );

      // Empirical assertion: partial tuition blocks certification
      expect(result.ok).toBe(false);
      expect(result.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
    });

    it("rejects issueCertificate with 400 Bad Request and blocker details when financialStatus is 'unpaid' (domain service)", async () => {
      const course = {
        id: "c-svc-gate",
        companyId: "company-alpha",
        title: "VIP Protection",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const student = { id: "stu-svc-unpaid", companyId: "company-alpha" };
      store.students.push(student);

      const run = { id: "run-svc-unpaid", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-svc-unpaid",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "unpaid",
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      // Empirical assertion: issueCertificate throws with tuition blocker
      let errorThrown: any;
      try {
        await certificateService.issueCertificate("company-alpha", "user-c2", {
          learnerId: student.id,
          courseId: course.id,
          enrolmentId: enrolment.id,
          issueDate: "2026-10-15",
        });
      } catch (err) {
        errorThrown = err;
      }

      expect(errorThrown).toBeDefined();
      expect(errorThrown.statusCode).toBe(400);
      expect(errorThrown.message).toBe("Certificate issuance prerequisites not met");
      expect(errorThrown.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
      expect(store.certificates).toHaveLength(0);
    });

    it("rejects POST /certificates with HTTP 400 Bad Request when financialStatus is 'partial' (HTTP route)", async () => {
      const course = {
        id: "c-http-gate",
        companyId: "company-alpha",
        title: "Retail Security",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const student = { id: "stu-http-partial", companyId: "company-alpha" };
      store.students.push(student);

      const run = { id: "run-http-partial", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const enrolment = {
        id: "enr-http-partial",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "partial",
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: student.id,
          courseId: course.id,
          enrolmentId: enrolment.id,
          issueDate: "2026-10-15",
        },
      });

      // Empirical assertion: HTTP 400 with blocker list returned to client
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe("Validation error");
      expect(json.message).toBe("Certificate issuance prerequisites not met");
      expect(json.blockers).toBeDefined();
      expect(json.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
    });

    it("allows certificate issuance once financialStatus transitions to 'paid'", async () => {
      const course = {
        id: "c-cert-success",
        companyId: "company-alpha",
        title: "Accredited Patrol Officer",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const student = { id: "stu-cert-paid", companyId: "company-alpha" };
      store.students.push(student);

      const run = { id: "run-cert-paid", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      // Initially unpaid
      const enrolment = {
        id: "enr-cert-success",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "unpaid",
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      // Step 1: Rejection while unpaid
      const resUnpaid = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: student.id,
          courseId: course.id,
          enrolmentId: enrolment.id,
          issueDate: "2026-10-15",
        },
      });
      expect(resUnpaid.statusCode).toBe(400);

      // Step 2: Pay in full -> financialStatus transitions to "paid"
      enrolment.financialStatus = "paid";

      // Step 3: Now certificate issuance succeeds!
      const resPaid = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: student.id,
          courseId: course.id,
          enrolmentId: enrolment.id,
          issueDate: "2026-10-15",
        },
      });
      expect(resPaid.statusCode).toBe(201);
      const certJson = resPaid.json().certificate;
      expect(certJson).toBeDefined();
      expect(certJson.certificateNumber).toBe("CERT-00001");
      expect(certJson.verificationCode).toMatch(/^[0-9a-f]{16}$/);
      expect(certJson.status).toBe("active");
    });
  });
});
