import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma.js";

// ===========================================================================
// IN-MEMORY REAL STATE STORE FOR ACADEMY LIFECYCLE
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
      {
        companyId: "company-beta",
        trainingCentreName: "Beta Defense School",
        psiraTrainingProviderNumber: "TP-99999",
        psiraBusinessRegistrationNumber: "BR-99999",
        accreditationStatus: "active",
        reAccreditationDueDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    ],
    employees: [],
  };
}

let store = createInitialState();

// In-memory query matcher
function matchesFilter(item: any, filter: any): boolean {
  if (!filter) return true;
  for (const [key, val] of Object.entries(filter)) {
    if (key === "deletedAt" && val === null) {
      if (item.deletedAt != null) return false;
      continue;
    }
    if (key === "status" && typeof val === "object" && val !== null) {
      if ("notIn" in val) {
        if ((val as any).notIn.includes(item.status)) return false;
        continue;
      }
      if ("not" in val) {
        if (item.status === (val as any).not) return false;
        continue;
      }
      if ("in" in val) {
        if (!(val as any).in.includes(item.status)) return false;
        continue;
      }
    }
    if (key === "verificationStatus" && typeof val === "object" && val !== null) {
      if ("in" in val) {
        if (!(val as any).in.includes(item.verificationStatus)) return false;
        continue;
      }
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
      if (!run) return false;
      if (!matchesFilter(run, val)) return false;
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
      const pays = store.payments.filter((p) => p.invoiceId === item.id);
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

// Mock Prisma
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
          status: "prospect",
          adminFeeStatus: "unpaid",
          psiraPreRegistrationStatus: "unknown",
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
      delete: vi.fn(async ({ where }: any) => {
        const idx = store.students.findIndex((s) => s.id === where.id);
        if (idx !== -1) store.students.splice(idx, 1);
        return {};
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
          status: "planned",
          capacity: 0,
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
        const alert = { id: `alert-${Date.now()}-${Math.random()}`, ...data };
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

// Auth middleware mock
let currentTenant = "company-alpha";
vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: async (req: any) => {
    req.user = {
      sub: "user-test-123",
      email: "operator@example.com",
      companyId: currentTenant,
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

// Import routes and services after mocks
import { academyStudentsRoutes } from "../students.js";
import { academyCourseRunsRoutes } from "../course-runs.js";
import { academyEnrolmentsRoutes } from "../enrolments.js";
import { academyInvoicesRoutes } from "../invoices.js";
import { academyPaymentsRoutes } from "../payments.js";
import { academyAttendanceRoutes } from "../attendance.js";
import { academyAssessmentsRoutes } from "../assessments.js";
import { academyCertificatesRoutes } from "../certificates.js";

import * as studentService from "../../../services/academy-student.service.js";
import * as enrolmentService from "../../../services/academy-enrolment.service.js";
import * as financeService from "../../../services/academy-finance.service.js";
import * as attendanceService from "../../../services/academy-attendance.service.js";
import * as assessmentService from "../../../services/academy-assessment.service.js";
import * as certificateService from "../../../services/academy-certificate.service.js";

describe("Milestone 3 End-to-End Business Flow Lifecycle Test Suite", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    store = createInitialState();
    currentTenant = "company-alpha";
    vi.clearAllMocks();

    app = Fastify();
    await app.register(academyStudentsRoutes, { prefix: "/students" });
    await app.register(academyCourseRunsRoutes, { prefix: "/course-runs" });
    await app.register(academyEnrolmentsRoutes, { prefix: "/enrolments" });
    await app.register(academyInvoicesRoutes, { prefix: "/invoices" });
    await app.register(academyPaymentsRoutes, { prefix: "/payments" });
    await app.register(academyAttendanceRoutes, { prefix: "/attendance" });
    await app.register(academyAssessmentsRoutes, { prefix: "/assessments" });
    await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
    await app.ready();
  });

  // =========================================================================
  // STEP 1: LEARNER ONBOARDING & DOCUMENT GATING
  // =========================================================================
  describe("Step 1: Learner Onboarding & Document Gating", () => {
    it("assigns sequential student numbers and records admin fee", async () => {
      // 1. Register student
      const resReg = await app.inject({
        method: "POST",
        url: "/students",
        payload: { firstName: "Sipho", lastName: "Dlamini" },
      });
      expect(resReg.statusCode).toBe(201);
      const student = resReg.json().student;
      expect(student.studentNumber).toMatch(/^STU-\d{4}-\d{4}$/);
      expect(student.adminFeeStatus).toBe("unpaid");

      // 2. Record admin fee as paid
      const resFee = await app.inject({
        method: "POST",
        url: `/students/${student.id}/admin-fee`,
        payload: { status: "paid", amount: 250, method: "EFT", reference: "REF-123" },
      });
      expect(resFee.statusCode).toBe(200);
      expect(resFee.json().student.adminFeeStatus).toBe("paid");
    });

    it("evaluates checkLearnerEnrolmentEligibility accurately with full blocker diagnostics", async () => {
      // Setup student with unpaid admin fee
      const student = await studentService.registerStudent("company-alpha", "user-123", {
        firstName: "Themba",
        lastName: "Nkosi",
      });

      // Setup course run requiring documents & PSIRA
      const course = {
        id: "course-grade-c",
        companyId: "company-alpha",
        code: "SEC-C",
        title: "PSIRA Grade C",
        psiraCategory: "Grade C",
        requiresDocuments: true,
        requiresAssessment: true,
        feeAmount: new Prisma.Decimal("1500"),
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const branch = { id: "branch-jhb", companyId: "company-alpha", name: "JHB Branch" };
      store.branches.push(branch);

      const run = {
        id: "run-c-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-C-2026-01",
        academyBranchId: branch.id,
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-05"),
        status: "planned",
        capacity: 10,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      // Check eligibility when unpaid, no docs, no psira pre-reg
      const check1 = await studentService.checkLearnerEnrolmentEligibility(
        "company-alpha",
        student.id,
        run.id
      );
      expect(check1.eligible).toBe(false);
      expect(check1.checks.adminFeePaidOrWaived).toBe(false);
      expect(check1.checks.documentsCompliant).toBe(false);
      expect(check1.checks.psiraPreRegistrationCompliant).toBe(false);
      expect(check1.blockers.length).toBeGreaterThanOrEqual(3);

      // Fix admin fee
      await studentService.recordAdminFee("company-alpha", student.id, "user-123", {
        status: "paid",
        amount: 250,
      });

      // Upload mandatory document
      store.studentDocuments.push({
        id: "doc-id-1",
        companyId: "company-alpha",
        studentId: student.id,
        documentType: "id_copy",
        deletedAt: null,
      });

      // Update student PSIRA pre-reg status
      await studentService.updateStudent("company-alpha", student.id, "user-123", {
        psiraPreRegistrationStatus: "completed",
      });

      // Re-check eligibility: now eligible!
      const check2 = await studentService.checkLearnerEnrolmentEligibility(
        "company-alpha",
        student.id,
        run.id
      );
      expect(check2.eligible).toBe(true);
      expect(check2.blockers).toHaveLength(0);
    });

    it("allows enrolment without documents when course.requiresDocuments is false", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-123", {
        firstName: "Lerato",
        lastName: "Molefe",
      });
      await studentService.recordAdminFee("company-alpha", student.id, "user-123", {
        status: "waived",
        notes: "Corporate sponsorship waiver",
      });

      // Course with requiresDocuments = false (e.g. online seminar)
      const course = {
        id: "course-seminar",
        companyId: "company-alpha",
        code: "SEM-01",
        title: "Security Refresher Seminar",
        requiresDocuments: false,
        requiresAssessment: false,
        feeAmount: new Prisma.Decimal("500"),
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const branch = { id: "branch-jhb", companyId: "company-alpha", name: "JHB Branch" };
      store.branches.push(branch);

      const run = {
        id: "run-sem-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-SEM-01",
        academyBranchId: branch.id,
        startDate: new Date("2026-10-01"),
        endDate: new Date("2026-10-02"),
        status: "open",
        capacity: 20,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      // Enrolment succeeds without uploading any studentDocument!
      const result = await enrolmentService.createEnrolment("company-alpha", "user-123", {
        studentId: student.id,
        courseRunId: run.id,
      });
      expect(result.enrolment).toBeDefined();
      expect(result.enrolment.studentId).toBe(student.id);
    });
  });

  // =========================================================================
  // STEP 2: COURSE RUN SCHEDULING GUARDRAILS
  // =========================================================================
  describe("Step 2: Course Run Scheduling Guardrails", () => {
    it("enforces state machine transition validation on CourseRun.status", async () => {
      const branch = { id: "branch-1", companyId: "company-alpha", name: "Branch 1" };
      store.branches.push(branch);

      const course = { id: "c-1", companyId: "company-alpha", code: "C1", title: "Course 1", feeAmount: new Prisma.Decimal("100") };
      store.courses.push(course);

      // Create run in planned status
      const resCreate = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: course.id,
          runCode: "RUN-STATUS-1",
          academyBranchId: branch.id,
          startDate: "2026-11-01",
          endDate: "2026-11-05",
          capacity: 10,
        },
      });
      expect(resCreate.statusCode).toBe(201);
      const runId = resCreate.json().courseRun.id;

      // 1. Invalid jump: planned -> completed (rejected!)
      const resBadJump = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "completed" },
      });
      expect(resBadJump.statusCode).toBe(400);
      expect(resBadJump.json().message).toContain("Cannot transition course run status from 'planned' to 'completed'");

      // 2. Valid transition: planned -> open
      const resOpen = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "open" },
      });
      expect(resOpen.statusCode).toBe(200);

      // 3. Valid transition: open -> in_progress
      const resInProgress = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "in_progress" },
      });
      expect(resInProgress.statusCode).toBe(200);

      // 4. Valid transition: in_progress -> completed
      const resCompleted = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "completed" },
      });
      expect(resCompleted.statusCode).toBe(200);

      // 5. Invalid backwards transition: completed -> planned (rejected!)
      const resReopen = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "planned" },
      });
      expect(resReopen.statusCode).toBe(400);
      expect(resReopen.json().message).toContain("Cannot transition course run status from 'completed' to 'planned'");

      // 6. Valid transition: completed -> closed
      const resClosed = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "closed" },
      });
      expect(resClosed.statusCode).toBe(200);
    });

    it("rejects classroom bookings when classroom.academyBranchId !== courseRun.academyBranchId", async () => {
      const branchA = { id: "branch-jhb", companyId: "company-alpha", name: "Johannesburg" };
      const branchB = { id: "branch-dbn", companyId: "company-alpha", name: "Durban" };
      store.branches.push(branchA, branchB);

      const classroomInDurban = {
        id: "room-dbn-1",
        companyId: "company-alpha",
        academyBranchId: branchB.id,
        name: "Room D1",
      };
      store.classrooms.push(classroomInDurban);

      const course = { id: "c-2", companyId: "company-alpha", code: "C2", title: "Course 2", feeAmount: new Prisma.Decimal("100") };
      store.courses.push(course);

      // POST /course-runs with branchA (JHB) but classroom in Durban (branchB) -> Rejected!
      const resCreate = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: course.id,
          runCode: "RUN-CROSS-ROOM",
          academyBranchId: branchA.id,
          classroomId: classroomInDurban.id,
          startDate: "2026-11-01",
          endDate: "2026-11-05",
        },
      });
      expect(resCreate.statusCode).toBe(400);
      expect(resCreate.json().message).toBe("Classroom branch does not match course run branch");
    });
  });

  // =========================================================================
  // STEP 3: ENROLMENT & FINANCIAL RECONCILIATION FIXES
  // =========================================================================
  describe("Step 3: Enrolment & Financial Reconciliation Fixes", () => {
    it("correctly sets financialStatus = 'paid' for zero-fee courses and 100% discount invoices", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-123", {
        firstName: "Kagiso",
        lastName: "Moeketsi",
      });
      await studentService.recordAdminFee("company-alpha", student.id, "user-123", {
        status: "paid",
        amount: 200,
      });

      // Free course (feeAmount = 0)
      const course = {
        id: "course-free",
        companyId: "company-alpha",
        code: "FREE-101",
        title: "Community Orientation",
        feeAmount: new Prisma.Decimal("0"),
        requiresDocuments: false,
        requiresAssessment: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const branch = { id: "branch-main", companyId: "company-alpha", name: "Main Branch" };
      store.branches.push(branch);

      const run = {
        id: "run-free-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-FREE-1",
        academyBranchId: branch.id,
        startDate: new Date("2026-10-10"),
        endDate: new Date("2026-10-11"),
        status: "open",
        capacity: 30,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      // Create enrolment for 0-fee course
      const { enrolment } = await enrolmentService.createEnrolment("company-alpha", "user-123", {
        studentId: student.id,
        courseRunId: run.id,
      });

      // Sync financial status: MUST be "paid", NOT "unpaid"!
      await financeService.syncEnrolmentFinancialStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      const updatedEnrolment = store.enrolments.find((e) => e.id === enrolment.id);
      expect(updatedEnrolment.financialStatus).toBe("paid");
    });

    it("rejects negative discount amounts in invoices", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          studentId: "stu-1",
          invoiceDate: "2026-10-01",
          dueDate: "2026-10-15",
          discountAmount: -50, // Negative discount disallowed!
          items: [{ description: "Tuition", quantity: 1, unitAmount: 500 }],
        },
      });
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(res.json())).toContain("Discount amount cannot be negative");
    });

    it("rejects payment verification against cancelled invoices with 400 Bad Request", async () => {
      const invoice = {
        id: "inv-cancel-test",
        companyId: "company-alpha",
        studentId: "stu-1",
        invoiceNumber: "INV-CAN-01",
        status: "cancelled", // Cancelled!
        totalAmount: new Prisma.Decimal("1000"),
      };
      store.invoices.push(invoice);

      const payment = {
        id: "pay-cancel-test",
        companyId: "company-alpha",
        invoiceId: invoice.id,
        studentId: "stu-1",
        amount: new Prisma.Decimal("1000"),
        verificationStatus: "pending",
      };
      store.payments.push(payment);

      // Attempt verification -> MUST reject with 400 Bad Request
      await expect(
        financeService.verifyPayment("company-alpha", "user-123", payment.id)
      ).rejects.toThrow("Cannot verify payment against a cancelled invoice");
    });

    it("rejects enrolment deletion when verified payments exist (409 Conflict) and cleans draft invoices on success", async () => {
      const enr = {
        id: "enr-delete-guard",
        companyId: "company-alpha",
        studentId: "stu-1",
        courseRunId: "run-1",
      };
      store.enrolments.push(enr);

      const run = {
        id: "run-1",
        companyId: "company-alpha",
        enrolledCount: 1,
      };
      store.courseRuns.push(run);

      const inv = {
        id: "inv-linked-verified",
        companyId: "company-alpha",
        enrolmentId: enr.id,
        status: "issued",
      };
      store.invoices.push(inv);

      const verifiedPayment = {
        id: "pay-verified-1",
        companyId: "company-alpha",
        invoiceId: inv.id,
        verificationStatus: "verified",
      };
      store.payments.push(verifiedPayment);

      // 1. Delete enrolment when verified payments exist -> Rejected with 409 Conflict!
      await expect(
        enrolmentService.cancelOrDeleteEnrolment("company-alpha", enr.id, "user-123")
      ).rejects.toThrow("Cannot delete enrolment with verified payments");

      // 2. Remove verified payment and convert invoice to draft
      store.payments = [];
      inv.status = "draft";

      // 3. Now delete enrolment -> succeeds, draft invoice cleaned up, enrolledCount decremented!
      await enrolmentService.cancelOrDeleteEnrolment("company-alpha", enr.id, "user-123");
      expect(store.enrolments.find((e) => e.id === enr.id)).toBeUndefined();
      expect(store.invoices.find((i) => i.id === inv.id)).toBeUndefined();
      expect(store.courseRuns.find((r) => r.id === run.id).enrolledCount).toBe(0);
    });

    it("supports draft invoice creation during batch enrolment", async () => {
      const student = await studentService.registerStudent("company-alpha", "user-123", {
        firstName: "Ayanda",
        lastName: "Khumalo",
      });
      await studentService.recordAdminFee("company-alpha", student.id, "user-123", {
        status: "paid",
        amount: 300,
      });

      const courseA = {
        id: "c-batch-1",
        companyId: "company-alpha",
        code: "BA-1",
        title: "Course A",
        feeAmount: new Prisma.Decimal("1200"),
        requiresDocuments: false,
      };
      const courseB = {
        id: "c-batch-2",
        companyId: "company-alpha",
        code: "BA-2",
        title: "Course B",
        feeAmount: new Prisma.Decimal("800"),
        requiresDocuments: false,
      };
      store.courses.push(courseA, courseB);

      const branch = { id: "branch-b", companyId: "company-alpha", name: "Branch B" };
      store.branches.push(branch);

      const runA = {
        id: "run-ba-1",
        companyId: "company-alpha",
        courseId: courseA.id,
        runCode: "RUN-BA-1",
        academyBranchId: branch.id,
        startDate: new Date("2026-11-01"),
        status: "open",
        capacity: 10,
        enrolledCount: 0,
      };
      const runB = {
        id: "run-ba-2",
        companyId: "company-alpha",
        courseId: courseB.id,
        runCode: "RUN-BA-2",
        academyBranchId: branch.id,
        startDate: new Date("2026-11-15"),
        status: "open",
        capacity: 10,
        enrolledCount: 0,
      };
      store.courseRuns.push(runA, runB);

      // Batch enrol with createInvoice: true
      const enrolments = await enrolmentService.batchEnrolLearners("company-alpha", "user-123", {
        studentId: student.id,
        courseRunIds: [runA.id, runB.id],
        createInvoice: true,
      });

      expect(enrolments).toHaveLength(2);
      const invoices = store.invoices.filter((inv) => inv.studentId === student.id);
      expect(invoices).toHaveLength(2);
      expect(invoices[0].status).toBe("draft");
      expect(invoices[1].status).toBe("draft");
    });
  });

  // =========================================================================
  // STEP 4: ATTENDANCE TRACKING & DENOMINATOR CALCULATION
  // =========================================================================
  describe("Step 4: Attendance Tracking & Denominator Fix", () => {
    it("distinguishes in_progress from compliant attendance based on total scheduled sessions", async () => {
      const course = {
        id: "c-att",
        companyId: "company-alpha",
        code: "ATT-101",
        title: "Tactical Response",
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = {
        id: "run-att-5",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-ATT-5",
      };
      store.courseRuns.push(run);

      // Schedule 5 daily sessions
      const sessions = [1, 2, 3, 4, 5].map((day) => ({
        id: `sess-${day}`,
        companyId: "company-alpha",
        courseRunId: run.id,
        sessionDate: new Date(`2026-10-0${day}`),
      }));
      store.attendanceSessions.push(...sessions);

      const enrolment = {
        id: "enr-att-test",
        companyId: "company-alpha",
        studentId: "stu-att-1",
        courseRunId: run.id,
        attendanceStatus: "pending",
        completionStatus: "in_progress",
        reportingReadinessStatus: "not_started",
        financialStatus: "paid",
      };
      store.enrolments.push(enrolment);

      // Session 1 attended: (1/5) = 20% < 80%. Status MUST be in_progress (NOT compliant)!
      store.attendanceRecords.push({
        id: "ar-1",
        companyId: "company-alpha",
        sessionId: sessions[0].id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      const status1 = await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );
      expect(status1).toBe("in_progress");
      expect(store.enrolments.find((e) => e.id === enrolment.id).attendanceStatus).toBe("in_progress");

      // Session 2 and 3 attended: (3/5) = 60% < 80% -> still in_progress
      store.attendanceRecords.push(
        { id: "ar-2", companyId: "company-alpha", sessionId: sessions[1].id, enrolmentId: enrolment.id, attendanceStatus: "present" },
        { id: "ar-3", companyId: "company-alpha", sessionId: sessions[2].id, enrolmentId: enrolment.id, attendanceStatus: "present" }
      );
      const status2 = await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );
      expect(status2).toBe("in_progress");

      // Session 4 attended: (4/5) = 80% >= 80% -> now compliant!
      store.attendanceRecords.push({
        id: "ar-4",
        companyId: "company-alpha",
        sessionId: sessions[3].id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });
      const status3 = await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );
      expect(status3).toBe("compliant");
    });
  });

  // =========================================================================
  // STEP 5: UNIFIED ENROLMENT LIFECYCLE & CERTIFICATE GATING
  // =========================================================================
  describe("Step 5: Unified Enrolment Lifecycle Synchronizer & Certificate Gating", () => {
    it("completes and certifies non-assessment courses automatically once attendance is compliant", async () => {
      const course = {
        id: "c-non-ass",
        companyId: "company-alpha",
        code: "FIRST-AID",
        title: "Basic First Aid",
        requiresAssessment: false, // Non-assessment course!
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = {
        id: "run-fa",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-FA-01",
      };
      store.courseRuns.push(run);

      const session = {
        id: "sess-fa-1",
        companyId: "company-alpha",
        courseRunId: run.id,
      };
      store.attendanceSessions.push(session);

      const student = {
        id: "stu-fa",
        companyId: "company-alpha",
        studentNumber: "STU-2026-0099",
      };
      store.students.push(student);

      const enrolment = {
        id: "enr-fa",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "paid",
        attendanceStatus: "pending",
        completionStatus: "pending",
        reportingReadinessStatus: "not_started",
      };
      store.enrolments.push(enrolment);

      // Record attendance session as present
      store.attendanceRecords.push({
        id: "ar-fa",
        companyId: "company-alpha",
        sessionId: session.id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      // Sync attendance -> triggers evaluateAndSyncEnrolmentLifecycle
      await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // Verify completionStatus = completed and reportingReadinessStatus = ready
      const enrUpdated = store.enrolments.find((e) => e.id === enrolment.id);
      expect(enrUpdated.attendanceStatus).toBe("compliant");
      expect(enrUpdated.completionStatus).toBe("completed");
      expect(enrUpdated.reportingReadinessStatus).toBe("ready");

      // Verify certificate prerequisites pass WITHOUT assessment records!
      const prereq = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );
      expect(prereq.ok).toBe(true);
      expect(prereq.blockers).toHaveLength(0);
    });

    it("rejects certificate issuance when enrolment.financialStatus is not 'paid'", async () => {
      const course = {
        id: "c-fin-gate",
        companyId: "company-alpha",
        code: "FIN-GATE",
        title: "Finance Gating Course",
        requiresAssessment: false,
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = { id: "run-fin", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const student = { id: "stu-fin", companyId: "company-alpha" };
      store.students.push(student);

      const enrolment = {
        id: "enr-fin-unpaid",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "partial", // Unpaid or partial!
        attendanceStatus: "compliant",
        completionStatus: "completed",
        reportingReadinessStatus: "ready",
      };
      store.enrolments.push(enrolment);

      // Verify certificate prerequisites -> MUST block on tuition fee not fully paid!
      const prereq = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );
      expect(prereq.ok).toBe(false);
      expect(prereq.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
    });

    it("executes the full 5-step lifecycle end-to-end with certificate generation & public verification", async () => {
      // 1. Onboarding
      const student = await studentService.registerStudent("company-alpha", "user-123", {
        firstName: "Bongani",
        lastName: "Ndlovu",
      });
      await studentService.recordAdminFee("company-alpha", student.id, "user-123", {
        status: "paid",
        amount: 250,
      });
      store.studentDocuments.push({
        id: "doc-bongani",
        companyId: "company-alpha",
        studentId: student.id,
        documentType: "id_copy",
        deletedAt: null,
      });

      // 2. Course & Run Scheduling
      const course = {
        id: "c-armed",
        companyId: "company-alpha",
        code: "ARM-01",
        title: "Armed Response Specialization",
        requiresAssessment: true,
        requiresDocuments: true,
        feeAmount: new Prisma.Decimal("2000"),
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const branch = { id: "branch-hq", companyId: "company-alpha", name: "HQ Branch" };
      store.branches.push(branch);

      const run = {
        id: "run-armed-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-ARMED-01",
        academyBranchId: branch.id,
        startDate: new Date("2026-11-01"),
        endDate: new Date("2026-11-02"),
        status: "open",
        capacity: 15,
        enrolledCount: 0,
      };
      store.courseRuns.push(run);

      // 3. Enrolment & Financial Flow
      const { enrolment, invoice } = await enrolmentService.createEnrolment("company-alpha", "user-123", {
        studentId: student.id,
        courseRunId: run.id,
        createInvoice: true,
        invoiceStatus: "issued",
      });
      expect(enrolment).toBeDefined();
      expect(invoice).toBeDefined();

      // Record payment & verify -> generates receipt & reconciles financialStatus to "paid"
      const payment = await financeService.recordPayment("company-alpha", "user-123", {
        invoiceId: invoice!.id,
        paymentDate: "2026-11-01",
        amount: 2000,
        paymentMethod: "EFT",
      });
      const verified = await financeService.verifyPayment("company-alpha", "user-123", payment.id);
      expect(verified.verificationStatus).toBe("verified");
      expect(verified.receipt).toBeDefined();

      const enrPaid = store.enrolments.find((e) => e.id === enrolment.id);
      expect(enrPaid.financialStatus).toBe("paid");

      // 4. Attendance Session & Bulk Register
      const session = {
        id: "sess-armed-1",
        companyId: "company-alpha",
        courseRunId: run.id,
        sessionDate: new Date("2026-11-01"),
      };
      store.attendanceSessions.push(session);

      await attendanceService.markAttendanceBulk(
        "company-alpha",
        "user-123",
        session.id,
        [{ enrolmentId: enrolment.id, attendanceStatus: "present" }]
      );

      const enrAtt = store.enrolments.find((e) => e.id === enrolment.id);
      expect(enrAtt.attendanceStatus).toBe("compliant");

      // 5. Assessment Recording & Certificate Issuance
      await assessmentService.recordAssessment("company-alpha", "user-123", {
        learnerId: student.id,
        courseId: course.id,
        assessmentType: "Practical Shoot & Move",
        assessmentDate: "2026-11-02",
        mark: 92,
        result: "competent",
      });

      const enrReady = store.enrolments.find((e) => e.id === enrolment.id);
      expect(enrReady.completionStatus).toBe("completed");
      expect(enrReady.reportingReadinessStatus).toBe("ready");

      // Issue Certificate
      const certResult = await certificateService.issueCertificate("company-alpha", "user-123", {
        learnerId: student.id,
        courseId: course.id,
        enrolmentId: enrolment.id,
        issueDate: "2026-11-02",
      });
      expect(certResult.certificate.certificateNumber).toMatch(/^CERT-\d{5}$/);
      expect(certResult.certificate.verificationCode).toHaveLength(16);

      // Public Verification Endpoint (unauthenticated)
      const resVerify = await app.inject({
        method: "GET",
        url: `/certificates/verify/${certResult.certificate.verificationCode}`,
      });
      expect(resVerify.statusCode).toBe(200);
      const verifyJson = resVerify.json();
      expect(verifyJson.valid).toBe(true);
      expect(verifyJson.certificate.certificateNumber).toBe(certResult.certificate.certificateNumber);
    });
  });
});
