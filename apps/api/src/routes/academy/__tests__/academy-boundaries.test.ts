import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";

// Mock prisma and audit
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    student: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    courseRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    enrolment: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    feePlan: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    academyAttendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    academyAttendanceRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
      groupBy: vi.fn().mockResolvedValue([]),
    },
    academyAssessment: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    academyCertificate: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    academyRenewalAlert: {
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    academyInvoice: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    academyInvoiceLine: {
      findMany: vi.fn(),
      createMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    academyPayment: {
      findFirst: vi.fn(),
      findFirstOrThrow: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    academyReceipt: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    academyClassroom: {
      findFirst: vi.fn(),
    },
    academyInstructor: {
      findFirst: vi.fn(),
    },
    studentDocument: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    company: {
      findFirst: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn((fn: any) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      return Promise.all(fn);
    }),
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../services/academy-compliance.service.js", () => ({
  getAcademyComplianceGate: vi.fn().mockResolvedValue({ ok: true, blockers: [] }),
  ensureLearnerDocumentGate: vi.fn().mockResolvedValue({ ok: true, reason: null }),
}));

// Mock auth & authorization middleware to allow preHandlers to pass through with full capabilities
vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: async (req: any) => {
    req.user = {
      sub: "user-test-123",
      email: "tester@example.com",
      companyId: "company-test-456",
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

import { prisma } from "../../../lib/prisma.js";
import { academyStudentsRoutes } from "../students.js";
import { academyEnrolmentsRoutes } from "../enrolments.js";
import { academyAttendanceRoutes } from "../attendance.js";
import { academyAssessmentsRoutes } from "../assessments.js";
import { academyCertificatesRoutes } from "../certificates.js";
import { academyInvoicesRoutes } from "../invoices.js";
import { academyPaymentsRoutes } from "../payments.js";
import { academyReceiptsRoutes } from "../receipts.js";

import * as studentService from "../../../services/academy-student.service.js";
import * as enrolmentService from "../../../services/academy-enrolment.service.js";
import * as attendanceService from "../../../services/academy-attendance.service.js";
import * as assessmentService from "../../../services/academy-assessment.service.js";
import * as certificateService from "../../../services/academy-certificate.service.js";
import * as financeService from "../../../services/academy-finance.service.js";
import {
  AcademyServiceError,
  AcademyValidationError,
  AcademyNotFoundError,
  AcademyConflictError,
} from "../../../services/academy-student.service.js";

describe("Milestone 1 Empirical Stress Tests: Service Separation, Error Mapping, and Contracts", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();

    app = Fastify();
    await app.register(academyStudentsRoutes, { prefix: "/students" });
    await app.register(academyEnrolmentsRoutes, { prefix: "/enrolments" });
    await app.register(academyAttendanceRoutes, { prefix: "/attendance" });
    await app.register(academyAssessmentsRoutes, { prefix: "/assessments" });
    await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
    await app.register(academyInvoicesRoutes, { prefix: "/invoices" });
    await app.register(academyPaymentsRoutes, { prefix: "/payments" });
    await app.register(academyReceiptsRoutes, { prefix: "/receipts" });
    await app.ready();
  });

  // =========================================================================
  // 1. INPUT VALIDATION (400 BAD REQUEST)
  // =========================================================================
  describe("Input Validation (400 Bad Request)", () => {
    it("rejects POST /students when required names are missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/students",
        payload: { firstName: "" }, // missing lastName
      });
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe("Validation error");
      expect(json.statusCode).toBe(400);
      expect(json.details).toBeDefined();
    });

    it("rejects POST /students/:id/admin-fee when status is paid but amount is omitted", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/students/stu-1/admin-fee",
        payload: { status: "paid" }, // missing amount
      });
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe("Validation error");
      expect(json.message).toContain("amount is required when status is paid");
    });

    it("rejects POST /students/:id/admin-fee when status is waived but notes are omitted", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/students/stu-1/admin-fee",
        payload: { status: "waived" }, // missing notes
      });
      expect(res.statusCode).toBe(400);
      const json = res.json();
      expect(json.error).toBe("Validation error");
      expect(json.message).toContain("notes are required when status is waived");
    });

    it("rejects POST /enrolments when studentId or courseRunId is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/enrolments",
        payload: { studentId: "stu-1" }, // missing courseRunId
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /enrolments/batch when courseRunIds array is empty", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/enrolments/batch",
        payload: { studentId: "stu-1", courseRunIds: [] },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /attendance/sessions when sessionDate is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/attendance/sessions",
        payload: { courseRunId: "run-1" }, // missing sessionDate
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /attendance/mark with invalid attendanceStatus enum", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/attendance/mark",
        payload: {
          sessionId: "sess-1",
          enrolmentId: "enr-1",
          attendanceStatus: "not_a_valid_status",
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /assessments when learnerId or courseId is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assessments",
        payload: { learnerId: "stu-1" }, // missing courseId, assessmentType, assessmentDate
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /certificates when issueDate is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: { learnerId: "stu-1", courseId: "course-1" }, // missing issueDate
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /invoices when items list is empty", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          studentId: "stu-1",
          invoiceDate: "2026-09-01",
          dueDate: "2026-09-30",
          items: [], // empty items
        },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("rejects POST /payments when paymentDate or invoiceId is missing", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/payments",
        payload: { amount: 500 }, // missing invoiceId and paymentDate
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });
  });

  // =========================================================================
  // 2. NON-EXISTENT ENTITIES (404 NOT FOUND)
  // =========================================================================
  describe("Non-Existent Entities (404 Not Found)", () => {
    it("returns 404 for GET /students/:id when student does not exist", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/students/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Student not found",
        statusCode: 404,
      });
    });

    it("returns 404 for PATCH /students/:id when student does not exist", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
      const res = await app.inject({
        method: "PATCH",
        url: "/students/non-existent",
        payload: { firstName: "Jane" },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().statusCode).toBe(404);
    });

    it("returns 404 for DELETE /students/:id when student does not exist", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "DELETE", url: "/students/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json().statusCode).toBe(404);
    });

    it("returns 404 for GET /enrolments/:id when enrolment does not exist", async () => {
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/enrolments/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Enrolment not found",
        statusCode: 404,
      });
    });

    it("returns 404 for PATCH /enrolments/:id when enrolment does not exist", async () => {
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue(null);
      const res = await app.inject({
        method: "PATCH",
        url: "/enrolments/non-existent",
        payload: { financialStatus: "paid" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for DELETE /enrolments/:id when enrolment does not exist", async () => {
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "DELETE", url: "/enrolments/non-existent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /attendance/sessions/:id when session does not exist", async () => {
      vi.mocked(prisma.academyAttendanceSession.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/attendance/sessions/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Session not found",
        statusCode: 404,
      });
    });

    it("returns 404 for DELETE /attendance/sessions/:id when session does not exist", async () => {
      vi.mocked(prisma.academyAttendanceSession.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "DELETE", url: "/attendance/sessions/non-existent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /assessments/:id when assessment does not exist", async () => {
      vi.mocked(prisma.academyAssessment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/assessments/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Assessment not found",
        statusCode: 404,
      });
    });

    it("returns 404 for DELETE /assessments/:id when assessment does not exist", async () => {
      vi.mocked(prisma.academyAssessment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "DELETE", url: "/assessments/non-existent" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /certificates/:id when certificate does not exist", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/certificates/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Certificate not found",
        statusCode: 404,
      });
    });

    it("returns 404 for POST /certificates/:id/reprint when certificate does not exist", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/certificates/non-existent/reprint" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for POST /certificates/:id/revoke when certificate does not exist", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/certificates/non-existent/revoke" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /certificates/verify/:code when code does not exist", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/certificates/verify/INVALID-CODE" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Certificate verification failed",
        statusCode: 404,
      });
    });

    it("returns 404 for GET /invoices/:id when invoice does not exist", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/invoices/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Invoice not found",
        statusCode: 404,
      });
    });

    it("returns 404 for PATCH /invoices/:id when invoice does not exist", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue(null);
      const res = await app.inject({
        method: "PATCH",
        url: "/invoices/non-existent",
        payload: { dueDate: "2026-10-01" },
      });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for POST /invoices/:id/issue when invoice does not exist", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/invoices/non-existent/issue" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for POST /invoices/:id/cancel when invoice does not exist", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/invoices/non-existent/cancel" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /payments/:id when payment does not exist", async () => {
      vi.mocked(prisma.academyPayment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/payments/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Payment not found",
        statusCode: 404,
      });
    });

    it("returns 404 for POST /payments/:id/verify when payment does not exist", async () => {
      vi.mocked(prisma.academyPayment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/payments/non-existent/verify" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for POST /payments/:id/reject when payment does not exist", async () => {
      vi.mocked(prisma.academyPayment.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "POST", url: "/payments/non-existent/reject" });
      expect(res.statusCode).toBe(404);
    });

    it("returns 404 for GET /receipts/:id when receipt does not exist", async () => {
      vi.mocked(prisma.academyReceipt.findFirst).mockResolvedValue(null);
      const res = await app.inject({ method: "GET", url: "/receipts/non-existent" });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({
        error: "Not found",
        message: "Receipt not found",
        statusCode: 404,
      });
    });
  });

  // =========================================================================
  // 3. CONFLICTING STATES & PRECONDITIONS (409 CONFLICT OR 400 BAD REQUEST)
  // =========================================================================
  describe("Conflicting States & Preconditions (409 Conflict / 400 Bad Request)", () => {
    it("throws 409 Conflict when creating enrolment in a course run at full capacity", async () => {
      // Mock student with paid admin fee
      vi.mocked(prisma.student.findFirst).mockResolvedValue({
        id: "stu-1",
        adminFeeStatus: "paid",
        psiraPreRegistrationStatus: "not_required",
      } as any);

      // Mock course run at full capacity (enrolledCount: 20, capacity: 20)
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-full",
        status: "open",
        capacity: 20,
        enrolledCount: 20,
        course: { psiraCategory: null },
        branch: {},
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/enrolments",
        payload: {
          studentId: "stu-1",
          courseRunId: "run-full",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "Conflict",
        message: "Course run is at capacity",
        statusCode: 409,
      });
    });

    it("throws 409 Conflict when student is already enrolled in the course run", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({
        id: "stu-1",
        adminFeeStatus: "paid",
        psiraPreRegistrationStatus: "not_required",
      } as any);

      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-1",
        status: "open",
        capacity: 20,
        enrolledCount: 5,
        course: { psiraCategory: null },
      } as any);

      // Mock existing enrolment found
      vi.mocked(prisma.enrolment.findUnique).mockResolvedValue({
        id: "existing-enrolment",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/enrolments",
        payload: {
          studentId: "stu-1",
          courseRunId: "run-1",
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "Conflict",
        message: "Student is already enrolled in this course run",
        statusCode: 409,
      });
    });

    it("throws 400 Bad Request when student admin fee is unpaid for enrolment", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({
        id: "stu-unpaid",
        adminFeeStatus: "unpaid",
        psiraPreRegistrationStatus: "not_required",
      } as any);

      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-1",
        status: "open",
        capacity: 20,
        enrolledCount: 5,
        course: { psiraCategory: null },
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/enrolments",
        payload: {
          studentId: "stu-unpaid",
          courseRunId: "run-1",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Admin fee must be paid or waived");
    });

    it("throws 400 Bad Request when feePlanId does not exist in company during enrolment", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({
        id: "stu-1",
        adminFeeStatus: "paid",
        psiraPreRegistrationStatus: "not_required",
      } as any);

      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-1",
        status: "open",
        capacity: 20,
        enrolledCount: 5,
        course: { psiraCategory: null },
      } as any);

      vi.mocked(prisma.feePlan.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/enrolments",
        payload: {
          studentId: "stu-1",
          courseRunId: "run-1",
          feePlanId: "non-existent-plan",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("feePlanId not found in company");
    });

    it("throws 400 Bad Request on invalid student status transition", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({
        id: "stu-1",
        status: "prospect",
      } as any);

      // prospect cannot directly transition to completed
      const res = await app.inject({
        method: "PATCH",
        url: "/students/stu-1",
        payload: { status: "completed" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Cannot transition student status from 'prospect' to 'completed'");
    });

    it("throws 409 Conflict when editing a non-draft invoice", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue({
        id: "inv-issued",
        status: "issued",
      } as any);

      const res = await app.inject({
        method: "PATCH",
        url: "/invoices/inv-issued",
        payload: { dueDate: "2026-11-01" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "Conflict",
        message: "Only draft invoices can be edited",
        statusCode: 409,
      });
    });

    it("throws 409 Conflict when issuing an invoice that is not draft", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue({
        id: "inv-paid",
        status: "paid",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/invoices/inv-paid/issue",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Only draft invoices can be issued");
    });

    it("throws 409 Conflict when cancelling an invoice with verified payments", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue({
        id: "inv-verified",
        status: "partially_paid",
        payments: [{ id: "pay-1", verificationStatus: "verified" }],
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/invoices/inv-verified/cancel",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Cannot cancel an invoice with verified payments");
    });

    it("throws 409 Conflict when recording payment against draft or cancelled invoices", async () => {
      vi.mocked(prisma.academyInvoice.findFirst).mockResolvedValue({
        id: "inv-draft",
        status: "draft",
        studentId: "stu-1",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/payments",
        payload: {
          invoiceId: "inv-draft",
          paymentDate: "2026-09-05",
          amount: 500,
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toContain("Cannot record payments against draft or cancelled invoices");
    });

    it("throws 409 Conflict when verifying a payment that is not pending", async () => {
      vi.mocked(prisma.academyPayment.findFirst).mockResolvedValue({
        id: "pay-1",
        verificationStatus: "verified",
        receipt: { id: "rec-1" },
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/payments/pay-1/verify",
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().message).toBe("Payment is not pending verification");
    });

    it("throws 400 Bad Request when recording assessment with mark outside 0-100 range", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assessments",
        payload: {
          learnerId: "stu-1",
          courseId: "course-1",
          assessmentType: "exam",
          assessmentDate: "2026-09-05",
          mark: 150, // Invalid mark > 100
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Assessment mark must be a valid number between 0 and 100");
    });
  });

  // =========================================================================
  // 4. ATOMIC TRANSACTION & SERVICE ROBUSTNESS
  // =========================================================================
  describe("Atomic Transactions and Sequence Generation Fallback", () => {
    it("generates sequential student numbers STU-YYYY-XXXX", async () => {
      const year = new Date().getUTCFullYear();
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        { studentNumber: `STU-${year}-0001` },
        { studentNumber: `STU-${year}-0002` },
      ] as any);

      const num = await studentService.generateNextStudentNumber("test-company");
      expect(num).toBe(`STU-${year}-0003`);
    });

    it("generates sequential invoice numbers INV-XXXX", async () => {
      vi.mocked(prisma.academyInvoice.findMany).mockResolvedValue([
        { invoiceNumber: "INV-0010" },
        { invoiceNumber: "INV-0011" },
      ] as any);

      const num = await financeService.generateNextInvoiceNumber("test-company");
      expect(num).toBe("INV-0012");
    });

    it("generates sequential receipt numbers REC-XXXX", async () => {
      vi.mocked(prisma.academyReceipt.findMany).mockResolvedValue([
        { receiptNumber: "REC-0004" },
      ] as any);

      const num = await financeService.generateNextReceiptNumber("test-company");
      expect(num).toBe("REC-0005");
    });

    it("generates sequential certificate numbers CERT-XXXXX", async () => {
      vi.mocked(prisma.academyCertificate.findMany).mockResolvedValue([
        { certificateNumber: "CERT-00099" },
      ] as any);

      const num = await certificateService.generateNextCertificateNumber("test-company");
      expect(num).toBe("CERT-00100");
    });

    it("maps Prisma P2002 to 409 Conflict in POST /students", async () => {
      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
      });
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

      const res = await app.inject({
        method: "POST",
        url: "/students",
        payload: { firstName: "John", lastName: "Doe" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "Conflict",
        message: "Student number already exists",
        statusCode: 409,
      });
    });

    it("maps Prisma P2002 to 409 Conflict in POST /invoices", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "stu-1" } as any);
      const p2002 = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "7.8.0",
      });
      vi.mocked(prisma.$transaction).mockRejectedValueOnce(p2002);

      const res = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          studentId: "stu-1",
          invoiceDate: "2026-09-01",
          dueDate: "2026-09-30",
          items: [{ description: "Tuition", quantity: 1, unitAmount: 1000 }],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        error: "Conflict",
        message: "Invoice number already exists",
        statusCode: 409,
      });
    });

    it("rejects invoice when discount results in negative total", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "stu-1" } as any);

      const res = await app.inject({
        method: "POST",
        url: "/invoices",
        payload: {
          studentId: "stu-1",
          invoiceDate: "2026-09-01",
          dueDate: "2026-09-30",
          discountAmount: 2000,
          items: [{ description: "Tuition", quantity: 1, unitAmount: 1000 }],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Invoice total cannot be negative");
    });

    it("rejects payment with negative or zero amount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/payments",
        payload: {
          invoiceId: "inv-1",
          paymentDate: "2026-09-01",
          amount: -50,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Amount must be positive");
    });

    it("rejects attendance session when classroom branch does not match course run branch", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-1",
        academyBranchId: "branch-A",
      } as any);
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-1",
        academyBranchId: "branch-B", // mismatched branch!
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/attendance/sessions",
        payload: {
          sessionDate: "2026-09-10",
          courseRunId: "run-1",
          classroomId: "room-1",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Classroom branch does not match course run branch");
    });

    it("rejects marking attendance when enrolment is not linked to session course run", async () => {
      vi.mocked(prisma.academyAttendanceSession.findFirst).mockResolvedValue({
        id: "sess-1",
        courseRunId: "run-A",
      } as any);
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        courseRunId: "run-B", // mismatched course run!
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/attendance/mark",
        payload: {
          sessionId: "sess-1",
          enrolmentId: "enr-1",
          attendanceStatus: "present",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("enrolmentId is not linked to this session's course run");
    });

    it("rejects certificate issuance when attendance requirement is not met", async () => {
      // Mock enrolment with failing attendance
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        attendanceStatus: "non_compliant",
        completionStatus: "completed",
        courseRun: {
          course: { minimumAttendancePercent: 80 },
          academyAttendanceSessions: [{ id: "sess-1" }, { id: "sess-2" }],
        },
      } as any);

      vi.mocked(prisma.academyAttendanceRecord.findMany).mockResolvedValue([
        { attendanceStatus: "absent" } as any,
        { attendanceStatus: "absent" } as any,
      ]);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "stu-1",
          courseId: "course-1",
          enrolmentId: "enr-1",
          issueDate: "2026-09-01",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("Certificate issuance prerequisites not met");
      expect(res.json().blockers).toBeDefined();
    });
  });

  // =========================================================================
  // 5. INTERFACE CONTRACT COMPATIBILITY (8 FASTIFY ROUTES)
  // =========================================================================
  describe("Interface Compatibility & Schema Conformance", () => {
    it("1. students.ts: maintains response schema for list and get", async () => {
      vi.mocked(prisma.student.findMany).mockResolvedValue([
        {
          id: "stu-1",
          companyId: "company-test-456",
          studentNumber: "STU-2026-0001",
          firstName: "John",
          lastName: "Doe",
          adminFeeAmount: new Prisma.Decimal(250),
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any,
      ]);
      vi.mocked(prisma.student.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/students?limit=10&offset=0" });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.students).toBeInstanceOf(Array);
      expect(json.total).toBe(1);
      expect(json.students[0].adminFeeAmount).toBe("250");
    });

    it("2. enrolments.ts: maintains response schema for list and create", async () => {
      vi.mocked(prisma.enrolment.findMany).mockResolvedValue([
        {
          id: "enr-1",
          companyId: "company-test-456",
          studentId: "stu-1",
          courseRunId: "run-1",
          financialStatus: "unpaid",
          student: { id: "stu-1", studentNumber: "STU-2026-0001", firstName: "John", lastName: "Doe" },
          courseRun: { id: "run-1", runCode: "RUN-01", course: { code: "C1", title: "Intro" } },
        } as any,
      ]);
      vi.mocked(prisma.enrolment.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/enrolments" });
      expect(res.statusCode).toBe(200);
      expect(res.json().enrolments).toBeInstanceOf(Array);
      expect(res.json().total).toBe(1);
    });

    it("3. attendance.ts: maintains response schema for sessions and mark", async () => {
      vi.mocked(prisma.academyAttendanceSession.findMany).mockResolvedValue([
        {
          id: "sess-1",
          companyId: "company-test-456",
          sessionDate: new Date(),
          _count: { records: 0 },
          academyAttendanceRecords: [],
        } as any,
      ]);
      vi.mocked(prisma.academyAttendanceSession.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/attendance/sessions" });
      expect(res.statusCode).toBe(200);
      expect(res.json().sessions).toBeInstanceOf(Array);
      expect(res.json().total).toBe(1);
    });

    it("4. assessments.ts: maintains response schema for list and get", async () => {
      vi.mocked(prisma.academyAssessment.findMany).mockResolvedValue([
        {
          id: "ass-1",
          companyId: "company-test-456",
          learnerId: "stu-1",
          courseId: "course-1",
          assessmentType: "exam",
          mark: new Prisma.Decimal(85),
          result: "pass",
          learner: {},
          course: {},
        } as any,
      ]);
      vi.mocked(prisma.academyAssessment.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/assessments" });
      expect(res.statusCode).toBe(200);
      expect(res.json().assessments).toBeInstanceOf(Array);
      expect(res.json().total).toBe(1);
    });

    it("5. certificates.ts: maintains response schema for list and verify", async () => {
      vi.mocked(prisma.academyCertificate.findMany).mockResolvedValue([
        {
          id: "cert-1",
          certificateNumber: "CERT-00001",
          verificationCode: "abcdef123456",
          status: "active",
          learner: {},
          course: {},
        } as any,
      ]);
      vi.mocked(prisma.academyCertificate.count).mockResolvedValue(1);

      const listRes = await app.inject({ method: "GET", url: "/certificates" });
      expect(listRes.statusCode).toBe(200);
      expect(listRes.json().certificates).toBeInstanceOf(Array);

      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue({
        id: "cert-1",
        certificateNumber: "CERT-00001",
        verificationCode: "abcdef123456",
        status: "active",
        learner: { studentNumber: "STU-01", firstName: "John", lastName: "Doe" },
        course: { code: "C1", title: "Security Grade E" },
      } as any);

      const verifyRes = await app.inject({ method: "GET", url: "/certificates/verify/abcdef123456" });
      expect(verifyRes.statusCode).toBe(200);
      expect(verifyRes.json().valid).toBe(true);
      expect(verifyRes.json().certificate).toBeDefined();
    });

    it("6. invoices.ts: maintains response schema with serialized decimal lines", async () => {
      vi.mocked(prisma.academyInvoice.findMany).mockResolvedValue([
        {
          id: "inv-1",
          invoiceNumber: "INV-0001",
          subtotal: new Prisma.Decimal(1000),
          discountAmount: new Prisma.Decimal(100),
          totalAmount: new Prisma.Decimal(900),
          items: [
            {
              id: "item-1",
              description: "Course fee",
              quantity: 1,
              unitAmount: new Prisma.Decimal(1000),
              lineTotal: new Prisma.Decimal(1000),
            },
          ],
          student: { id: "stu-1", studentNumber: "STU-01", firstName: "John", lastName: "Doe" },
          _count: { payments: 0 },
        } as any,
      ]);
      vi.mocked(prisma.academyInvoice.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/invoices" });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.invoices).toBeInstanceOf(Array);
      expect(json.invoices[0].subtotal).toBe("1000");
      expect(json.invoices[0].totalAmount).toBe("900");
      expect(json.invoices[0].items[0].unitAmount).toBe("1000");
    });

    it("7. payments.ts: maintains response schema with serialized decimal amounts", async () => {
      vi.mocked(prisma.academyPayment.findMany).mockResolvedValue([
        {
          id: "pay-1",
          amount: new Prisma.Decimal(500),
          verificationStatus: "pending",
          invoice: {
            id: "inv-1",
            totalAmount: new Prisma.Decimal(900),
          },
          receipt: null,
        } as any,
      ]);
      vi.mocked(prisma.academyPayment.count).mockResolvedValue(1);

      const res = await app.inject({ method: "GET", url: "/payments" });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.payments).toBeInstanceOf(Array);
      expect(json.payments[0].amount).toBe("500");
    });

    it("8. receipts.ts: maintains response schema with serialized decimal amounts", async () => {
      vi.mocked(prisma.academyReceipt.findFirst).mockResolvedValue({
        id: "rec-1",
        receiptNumber: "REC-0001",
        amount: new Prisma.Decimal(500),
        payment: {
          id: "pay-1",
          amount: new Prisma.Decimal(500),
          invoice: {
            id: "inv-1",
            totalAmount: new Prisma.Decimal(900),
          },
        },
      } as any);

      const res = await app.inject({ method: "GET", url: "/receipts/rec-1" });
      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.receipt.receiptNumber).toBe("REC-0001");
      expect(json.receipt.amount).toBe("500");
      expect(json.receipt.payment.amount).toBe("500");
      expect(json.receipt.payment.invoice.totalAmount).toBe("900");
    });
  });
});
