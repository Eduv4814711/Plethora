import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

// ===========================================================================
// IN-MEMORY COMPREHENSIVE STORE FOR CHALLENGER 1 (M3 LIFECYCLE STRESS TESTS)
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
      const pays = store.payments.filter((p) => p.invoiceId === item.id);
      clone.payments = pays.map((p) => hydrateRelations("payments", p, include.payments.include));
    }
    if (include.student) {
      clone.student = store.students.find((s) => s.id === item.studentId) ?? null;
    }
  }

  if (collectionName === "attendanceSessions") {
    if (include.classroom) {
      clone.classroom = store.classrooms.find((c) => c.id === item.classroomId) ?? null;
    }
    if (include.courseRun) {
      clone.courseRun = store.courseRuns.find((r) => r.id === item.courseRunId) ?? null;
    }
    if (include.records) {
      clone.records = store.attendanceRecords.filter((r) => r.sessionId === item.id);
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
      findMany: vi.fn(async ({ where }: any) => {
        return store.classrooms.filter((item) => matchesFilter(item, where));
      }),
      create: vi.fn(async ({ data }: any) => {
        const cr = { id: `classroom-${Date.now()}-${Math.random()}`, ...data };
        store.classrooms.push(cr);
        return cr;
      }),
    },
    courseRun: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const r = store.courseRuns.find((item) => matchesFilter(item, where));
        return r ? hydrateRelations("courseRuns", r, include) : null;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.courseRuns
          .filter((item) => matchesFilter(item, where))
          .map((r) => hydrateRelations("courseRuns", r, include));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.courseRuns.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const cr = {
          id: `run-${Date.now()}-${Math.random()}`,
          enrolledCount: 0,
          createdAt: new Date(),
          status: "planned",
          ...data,
        };
        store.courseRuns.push(cr);
        return hydrateRelations("courseRuns", cr, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.courseRuns.findIndex((r) => r.id === where.id);
        if (idx === -1) throw new Error("CourseRun not found");
        store.courseRuns[idx] = { ...store.courseRuns[idx], ...data };
        return hydrateRelations("courseRuns", store.courseRuns[idx], include);
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
        const e = {
          id: `enr-${Date.now()}-${Math.random()}`,
          createdAt: new Date(),
          financialStatus: "unpaid",
          attendanceStatus: "pending",
          completionStatus: "pending",
          reportingReadinessStatus: "not_started",
          ...data,
        };
        store.enrolments.push(e);
        return hydrateRelations("enrolments", e, include);
      }),
      update: vi.fn(async ({ where, data, include }: any) => {
        const idx = store.enrolments.findIndex((e) => e.id === where.id);
        if (idx === -1) throw new Error("Enrolment not found");
        store.enrolments[idx] = { ...store.enrolments[idx], ...data };
        return hydrateRelations("enrolments", store.enrolments[idx], include);
      }),
    },
    academyAttendanceSession: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const s = store.attendanceSessions.find((item) => matchesFilter(item, where));
        return s ? hydrateRelations("attendanceSessions", s, include) : null;
      }),
      findMany: vi.fn(async ({ where, include }: any) => {
        return store.attendanceSessions
          .filter((item) => matchesFilter(item, where))
          .map((s) => hydrateRelations("attendanceSessions", s, include));
      }),
      count: vi.fn(async ({ where }: any) => {
        return store.attendanceSessions.filter((item) => matchesFilter(item, where)).length;
      }),
      create: vi.fn(async ({ data, include }: any) => {
        const s = {
          id: `sess-${Date.now()}-${Math.random()}`,
          createdAt: new Date(),
          ...data,
        };
        store.attendanceSessions.push(s);
        return hydrateRelations("attendanceSessions", s, include);
      }),
    },
    academyAttendanceRecord: {
      findFirst: vi.fn(async ({ where }: any) => {
        return store.attendanceRecords.find((item) => matchesFilter(item, where)) ?? null;
      }),
      findMany: vi.fn(async ({ where }: any) => {
        return store.attendanceRecords.filter((item) => matchesFilter(item, where));
      }),
      create: vi.fn(async ({ data }: any) => {
        const r = { id: `rec-${Date.now()}-${Math.random()}`, ...data };
        store.attendanceRecords.push(r);
        return r;
      }),
      upsert: vi.fn(async ({ where, update, create }: any) => {
        let r = store.attendanceRecords.find((item) => matchesFilter(item, where));
        if (r) {
          Object.assign(r, update);
        } else {
          r = { id: `rec-${Date.now()}-${Math.random()}`, ...create };
          store.attendanceRecords.push(r);
        }
        return r;
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
    },
    academyCertificate: {
      findFirst: vi.fn(async ({ where, include }: any) => {
        const c = store.certificates.find((item) => matchesFilter(item, where));
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
          certificateNumber: "CERT-00001",
          verificationCode: "VER-ABCD-1234",
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
      sub: "user-challenger-1",
      email: "challenger@example.com",
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

import { academyCourseRunsRoutes } from "../course-runs.js";
import { academyAttendanceRoutes } from "../attendance.js";
import { academyCertificatesRoutes } from "../certificates.js";
import * as attendanceService from "../../../services/academy-attendance.service.js";
import * as enrolmentService from "../../../services/academy-enrolment.service.js";
import * as certificateService from "../../../services/academy-certificate.service.js";
import { prisma } from "../../../lib/prisma.js";

describe("Empirical Challenger M3: Lifecycle Transitions & Gating Stress Harness", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    store = createInitialState();
    vi.clearAllMocks();

    app = Fastify();
    await app.register(academyCourseRunsRoutes, { prefix: "/course-runs" });
    await app.register(academyAttendanceRoutes, { prefix: "/attendance" });
    await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
    await app.ready();
  });

  // =========================================================================
  // 1. LIFECYCLE FLOW: NON-ASSESSMENT COURSE COMPLETION & CERTIFICATION GATING
  // =========================================================================
  describe("Challenge 1: Non-assessment course completion & certification gating", () => {
    it("automatically sets completionStatus='completed' and reportingReadinessStatus='ready' once attendance is compliant", async () => {
      const course = {
        id: "course-practical",
        companyId: "company-alpha",
        code: "HANDCUFF-01",
        title: "Handcuff & Restraint Practical",
        requiresAssessment: false, // NON-ASSESSMENT COURSE
        requiresDocuments: false,
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = {
        id: "run-prac-1",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-PRAC-01",
      };
      store.courseRuns.push(run);

      const session1 = { id: "sess-p1", companyId: "company-alpha", courseRunId: run.id };
      const session2 = { id: "sess-p2", companyId: "company-alpha", courseRunId: run.id };
      store.attendanceSessions.push(session1, session2);

      const student = {
        id: "stu-learner-1",
        companyId: "company-alpha",
        studentNumber: "STU-2026-1111",
        firstName: "Nelson",
        lastName: "Mandla",
      };
      store.students.push(student);

      const enrolment = {
        id: "enr-prac-1",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "paid",
        attendanceStatus: "pending",
        completionStatus: "pending",
        reportingReadinessStatus: "not_started",
      };
      store.enrolments.push(enrolment);

      // Session 1 attended (1 of 2 = 50% < 80%) -> in_progress
      store.attendanceRecords.push({
        id: "ar-p1",
        companyId: "company-alpha",
        sessionId: session1.id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      await attendanceService.syncEnrolmentAttendanceStatus(prisma as any, enrolment.id, "company-alpha");
      let currentEnrolment = store.enrolments.find((e) => e.id === enrolment.id);
      expect(currentEnrolment.attendanceStatus).toBe("in_progress");
      expect(currentEnrolment.completionStatus).toBe("in_progress");
      expect(currentEnrolment.reportingReadinessStatus).toBe("incomplete");

      // Session 2 attended (2 of 2 = 100% >= 80%) -> compliant
      store.attendanceRecords.push({
        id: "ar-p2",
        companyId: "company-alpha",
        sessionId: session2.id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      await attendanceService.syncEnrolmentAttendanceStatus(prisma as any, enrolment.id, "company-alpha");
      currentEnrolment = store.enrolments.find((e) => e.id === enrolment.id);

      // EMPIRICAL ASSERTION: Completed without any assessment!
      expect(currentEnrolment.attendanceStatus).toBe("compliant");
      expect(currentEnrolment.completionStatus).toBe("completed");
      expect(currentEnrolment.reportingReadinessStatus).toBe("ready");

      // Verify certificate prerequisites pass with ZERO assessment records
      const prereq = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );
      expect(prereq.ok).toBe(true);
      expect(prereq.blockers).toEqual([]);

      // Issue certificate directly
      const certResult = await certificateService.issueCertificate(
        "company-alpha",
        "user-challenger-1",
        {
          learnerId: student.id,
          courseId: course.id,
          enrolmentId: enrolment.id,
          issueDate: "2026-10-01",
        }
      );
      expect(certResult.certificate).toBeDefined();
      expect(certResult.certificate.status).toBe("active");
    });

    it("blocks certificate eligibility for non-assessment course when document or fee requirements fail", async () => {
      const course = {
        id: "course-doc-req",
        companyId: "company-alpha",
        code: "DOC-REQ-01",
        title: "Compliance Training",
        requiresAssessment: false,
        requiresDocuments: true, // Requires documents!
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = { id: "run-doc", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const session = { id: "sess-doc-1", companyId: "company-alpha", courseRunId: run.id };
      store.attendanceSessions.push(session);

      const student = { id: "stu-doc-fail", companyId: "company-alpha", firstName: "Thabo" };
      store.students.push(student);

      const enrolment = {
        id: "enr-doc-fail",
        companyId: "company-alpha",
        studentId: student.id,
        courseRunId: run.id,
        financialStatus: "unpaid", // Unpaid fee!
        attendanceStatus: "pending",
        completionStatus: "pending",
        reportingReadinessStatus: "not_started",
      };
      store.enrolments.push(enrolment);

      // Mark attendance present
      store.attendanceRecords.push({
        id: "rec-doc-1",
        companyId: "company-alpha",
        sessionId: session.id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      await attendanceService.syncEnrolmentAttendanceStatus(prisma as any, enrolment.id, "company-alpha");
      const currentEnrolment = store.enrolments.find((e) => e.id === enrolment.id);

      // Attendance is compliant, completion is completed, BUT readiness is NOT ready because docs and tuition fail!
      expect(currentEnrolment.attendanceStatus).toBe("compliant");
      expect(currentEnrolment.completionStatus).toBe("completed");
      expect(currentEnrolment.reportingReadinessStatus).not.toBe("ready");

      const prereq = await certificateService.verifyCertificateIssuancePrerequisites(
        prisma as any,
        "company-alpha",
        student.id,
        course.id,
        enrolment.id
      );
      expect(prereq.ok).toBe(false);
      expect(prereq.blockers).toContain("Tuition fee must be fully paid before certificate issuance");
      expect(prereq.blockers).toContain("Reporting readiness status must be 'ready'");
    });
  });

  // =========================================================================
  // 2. ATTENDANCE DENOMINATOR: 1 ATTENDED OUT OF 5 SESSIONS
  // =========================================================================
  describe("Challenge 2: Attendance denominator & compliance threshold stress tests", () => {
    it("keeps student as 'in_progress' and NOT 'compliant' when 1 out of 5 sessions is attended", async () => {
      const course = {
        id: "course-5sess",
        companyId: "company-alpha",
        code: "SESS-500",
        minimumAttendancePercent: 80,
      };
      store.courses.push(course);

      const run = { id: "run-5sess", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      // Create 5 sessions
      const sessions = [1, 2, 3, 4, 5].map((i) => ({
        id: `session-${i}`,
        companyId: "company-alpha",
        courseRunId: run.id,
      }));
      store.attendanceSessions.push(...sessions);

      const enrolment = {
        id: "enr-student-1of5",
        companyId: "company-alpha",
        studentId: "stu-any",
        courseRunId: run.id,
        attendanceStatus: "pending",
        completionStatus: "pending",
        financialStatus: "paid",
      };
      store.enrolments.push(enrolment);

      // Mark session 1 as present (1/5 = 20% < 80%)
      store.attendanceRecords.push({
        id: "rec-1",
        companyId: "company-alpha",
        sessionId: sessions[0].id,
        enrolmentId: enrolment.id,
        attendanceStatus: "present",
      });

      const syncResult = await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // EMPIRICAL ASSERTION: MUST BE in_progress, NEVER compliant!
      expect(syncResult).toBe("in_progress");
      const updatedEnr = store.enrolments.find((e) => e.id === enrolment.id);
      expect(updatedEnr.attendanceStatus).toBe("in_progress");
      expect(updatedEnr.attendanceStatus).not.toBe("compliant");
    });

    it("marks student as 'non_compliant' early when mathematically unable to reach required threshold", async () => {
      const course = {
        id: "course-math-fail",
        companyId: "company-alpha",
        minimumAttendancePercent: 80, // 80% of 5 sessions = 4 sessions needed
      };
      store.courses.push(course);

      const run = { id: "run-math", companyId: "company-alpha", courseId: course.id };
      store.courseRuns.push(run);

      const sessions = [1, 2, 3, 4, 5].map((i) => ({
        id: `sess-math-${i}`,
        companyId: "company-alpha",
        courseRunId: run.id,
      }));
      store.attendanceSessions.push(...sessions);

      const enrolment = {
        id: "enr-math-fail",
        companyId: "company-alpha",
        studentId: "stu-any",
        courseRunId: run.id,
        attendanceStatus: "pending",
      };
      store.enrolments.push(enrolment);

      // Student is absent for session 1 and session 2.
      // Maximum remaining attendance: (5 - 2) / 5 = 3 / 5 = 60% < 80%.
      store.attendanceRecords.push(
        { id: "r-m1", companyId: "company-alpha", sessionId: sessions[0].id, enrolmentId: enrolment.id, attendanceStatus: "absent" },
        { id: "r-m2", companyId: "company-alpha", sessionId: sessions[1].id, enrolmentId: enrolment.id, attendanceStatus: "absent" }
      );

      const syncResult = await attendanceService.syncEnrolmentAttendanceStatus(
        prisma as any,
        enrolment.id,
        "company-alpha"
      );

      // EMPIRICAL ASSERTION: Mathematical early detection of non_compliant
      expect(syncResult).toBe("non_compliant");
      expect(store.enrolments.find((e) => e.id === enrolment.id).attendanceStatus).toBe("non_compliant");
    });
  });

  // =========================================================================
  // 3. COURSERUN.STATUS STATE MACHINE: INVALID TRANSITIONS REJECTION (400)
  // =========================================================================
  describe("Challenge 3: CourseRun.status state machine invalid transitions rejection", () => {
    it("rejects invalid status transitions with 400 Bad Request", async () => {
      const branch = { id: "b-sm", companyId: "company-alpha", name: "SM Branch" };
      store.branches.push(branch);
      const course = { id: "c-sm", companyId: "company-alpha", code: "SM-101", title: "State Machine Course" };
      store.courses.push(course);

      // Create run (defaults to 'planned')
      const createRes = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: course.id,
          runCode: "RUN-SM-TEST",
          academyBranchId: branch.id,
          startDate: "2026-12-01",
          endDate: "2026-12-10",
        },
      });
      expect(createRes.statusCode).toBe(201);
      const runId = createRes.json().courseRun.id;

      // ATTEMPT 1: planned -> completed (INVALID JUMP)
      const res1 = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "completed" },
      });
      expect(res1.statusCode).toBe(400);
      expect(res1.json().message).toContain("Cannot transition course run status from 'planned' to 'completed'");

      // ATTEMPT 2: planned -> in_progress (INVALID JUMP)
      const res2 = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "in_progress" },
      });
      expect(res2.statusCode).toBe(400);
      expect(res2.json().message).toContain("Cannot transition course run status from 'planned' to 'in_progress'");

      // Advance: planned -> open -> in_progress -> completed -> closed
      await app.inject({ method: "PATCH", url: `/course-runs/${runId}`, payload: { status: "open" } });
      await app.inject({ method: "PATCH", url: `/course-runs/${runId}`, payload: { status: "in_progress" } });
      await app.inject({ method: "PATCH", url: `/course-runs/${runId}`, payload: { status: "completed" } });
      const resClose = await app.inject({ method: "PATCH", url: `/course-runs/${runId}`, payload: { status: "closed" } });
      expect(resClose.statusCode).toBe(200);

      // ATTEMPT 3: closed -> open (TERMINAL STATE CANNOT TRANSITION)
      const resClosedToOpen = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "open" },
      });
      expect(resClosedToOpen.statusCode).toBe(400);
      expect(resClosedToOpen.json().message).toContain("Cannot transition course run status from 'closed' to 'open'");

      // ATTEMPT 4: closed -> planned
      const resClosedToPlanned = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "planned" },
      });
      expect(resClosedToPlanned.statusCode).toBe(400);
      expect(resClosedToPlanned.json().message).toContain("Cannot transition course run status from 'closed' to 'planned'");

      // ATTEMPT 5: closed -> completed
      const resClosedToCompleted = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runId}`,
        payload: { status: "completed" },
      });
      expect(resClosedToCompleted.statusCode).toBe(400);
      expect(resClosedToCompleted.json().message).toContain("Cannot transition course run status from 'closed' to 'completed'");
    });
  });

  // =========================================================================
  // 4. CLASSROOM BRANCH MISMATCH REJECTION (400)
  // =========================================================================
  describe("Challenge 4: Classroom branch mismatch guardrails", () => {
    it("rejects POST /course-runs when classroom branch differs from course run branch", async () => {
      const branchGauteng = { id: "branch-gt", companyId: "company-alpha", name: "Gauteng Branch" };
      const branchCape = { id: "branch-cpt", companyId: "company-alpha", name: "Cape Town Branch" };
      store.branches.push(branchGauteng, branchCape);

      const classroomCape = {
        id: "room-cpt-101",
        companyId: "company-alpha",
        academyBranchId: branchCape.id, // In Cape Town
        name: "CPT Auditorium",
      };
      store.classrooms.push(classroomCape);

      const course = { id: "course-iso", companyId: "company-alpha", code: "ISO-1" };
      store.courses.push(course);

      // Attempt to schedule run in Gauteng with classroom in Cape Town
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: course.id,
          runCode: "RUN-BRANCH-MISMATCH",
          academyBranchId: branchGauteng.id, // Gauteng
          classroomId: classroomCape.id,      // Cape Town
          startDate: "2026-11-01",
          endDate: "2026-11-05",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("Classroom branch does not match course run branch");
    });

    it("rejects PATCH /course-runs/:id when assigning a classroom from a different branch", async () => {
      const branchA = { id: "b-a", companyId: "company-alpha", name: "Branch A" };
      const branchB = { id: "b-b", companyId: "company-alpha", name: "Branch B" };
      store.branches.push(branchA, branchB);

      const roomInB = {
        id: "room-b-1",
        companyId: "company-alpha",
        academyBranchId: branchB.id,
      };
      store.classrooms.push(roomInB);

      const course = { id: "c-patch", companyId: "company-alpha", code: "PATCH-1" };
      store.courses.push(course);

      const runInA = {
        id: "run-in-a",
        companyId: "company-alpha",
        courseId: course.id,
        runCode: "RUN-IN-A",
        academyBranchId: branchA.id,
        startDate: new Date("2026-11-01"),
        endDate: new Date("2026-11-05"),
        status: "planned",
      };
      store.courseRuns.push(runInA);

      // PATCH run in Branch A to book classroom in Branch B
      const resPatchRoom = await app.inject({
        method: "PATCH",
        url: `/course-runs/${runInA.id}`,
        payload: {
          classroomId: roomInB.id,
        },
      });

      expect(resPatchRoom.statusCode).toBe(400);
      expect(resPatchRoom.json().message).toBe("Classroom branch does not match course run branch");
    });

    it("rejects POST /attendance/sessions when classroom branch differs from course run branch", async () => {
      const branchEast = { id: "b-east", companyId: "company-alpha", name: "East Branch" };
      const branchWest = { id: "b-west", companyId: "company-alpha", name: "West Branch" };
      store.branches.push(branchEast, branchWest);

      const roomInWest = {
        id: "room-west-1",
        companyId: "company-alpha",
        academyBranchId: branchWest.id,
      };
      store.classrooms.push(roomInWest);

      const runInEast = {
        id: "run-east-1",
        companyId: "company-alpha",
        runCode: "RUN-EAST-1",
        academyBranchId: branchEast.id,
      };
      store.courseRuns.push(runInEast);

      // Attempt to schedule attendance session combining run in East with room in West
      const res = await app.inject({
        method: "POST",
        url: "/attendance/sessions",
        payload: {
          courseRunId: runInEast.id,
          classroomId: roomInWest.id,
          sessionDate: "2026-11-02",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("Classroom branch does not match course run branch");
    });
  });
});
