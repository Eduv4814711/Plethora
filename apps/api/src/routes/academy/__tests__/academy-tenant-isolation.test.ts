import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// Mock prisma and audit
vi.mock("../../../lib/prisma.js", () => ({
  prisma: {
    student: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    course: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    courseRun: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    academyBranch: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    academyClassroom: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    academyRenewalAlert: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    academyCertificate: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    academyInstructor: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    academyComplianceDocument: {
      findFirst: vi.fn(),
    },
    employee: {
      findFirst: vi.fn(),
    },
    enrolment: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    academyAttendanceSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    academyAttendanceRecord: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
    academyAssessment: {
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      return Promise.all(fn);
    }),
  },
}));

const mockAuditFromRequest = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../lib/audit.js", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
  auditFromRequest: (...args: any[]) => mockAuditFromRequest(...args),
}));

vi.mock("../../../services/academy-compliance.service.js", () => ({
  getAcademyComplianceGate: vi.fn().mockResolvedValue({ ok: true, blockers: [] }),
}));

let currentTestUser: any = {
  sub: "user-tenant-a",
  email: "admin@tenant-a.com",
  companyId: "comp-A",
  capabilities: {
    "/academy": ["view", "create", "edit", "delete", "approve"],
  },
};

vi.mock("../../../middleware/auth.js", () => ({
  authMiddleware: async (req: any) => {
    req.user = currentTestUser;
  },
}));

import { prisma } from "../../../lib/prisma.js";
import { __resetDenialDedupe } from "../../../middleware/authorization.js";
import { academyClassroomsRoutes } from "../classrooms.js";
import { academyRenewalsRoutes } from "../renewals.js";
import { academyCourseRunsRoutes } from "../course-runs.js";
import { academyInstructorsRoutes } from "../instructors.js";
import * as certificateService from "../../../services/academy-certificate.service.js";
import * as attendanceService from "../../../services/academy-attendance.service.js";

describe("Milestone 2 Multi-Tenant Isolation & Security Guardrails Tests", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    __resetDenialDedupe();
    currentTestUser = {
      sub: "user-tenant-a",
      email: "admin@tenant-a.com",
      companyId: "comp-A",
      capabilities: {
        "/academy": ["view", "create", "edit", "delete", "approve"],
      },
    };

    app = Fastify();
    await app.register(academyClassroomsRoutes, { prefix: "/classrooms" });
    await app.register(academyRenewalsRoutes, { prefix: "/renewals" });
    await app.register(academyCourseRunsRoutes, { prefix: "/course-runs" });
    await app.register(academyInstructorsRoutes, { prefix: "/instructors" });
    await app.ready();
  });

  // =========================================================================
  // 1. CLASSROOM FOREIGN KEY ISOLATION & QUERY SCOPING
  // =========================================================================
  describe("Classrooms Tenant Boundary Isolation", () => {
    it("POST /classrooms rejects cross-tenant academyBranchId with 400", async () => {
      // Branch belonging to Tenant B (comp-B) -> not found for comp-A
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/classrooms",
        payload: {
          academyBranchId: "branch-comp-B",
          classroomName: "Hijacked Room",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("academyBranchId not found in company");
      expect(prisma.academyClassroom.create).not.toHaveBeenCalled();
    });

    it("POST /classrooms allows creating classroom when academyBranchId belongs to company", async () => {
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue({ id: "branch-comp-A" } as any);
      vi.mocked(prisma.academyClassroom.create).mockResolvedValue({
        id: "room-1",
        companyId: "comp-A",
        academyBranchId: "branch-comp-A",
        classroomName: "Valid Room",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/classrooms",
        payload: {
          academyBranchId: "branch-comp-A",
          classroomName: "Valid Room",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().classroom.id).toBe("room-1");
    });

    it("PATCH /classrooms/:id rejects cross-tenant academyBranchId with 400", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-1",
        companyId: "comp-A",
      } as any);
      // Branch does not exist in comp-A
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-1",
        payload: {
          academyBranchId: "branch-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("academyBranchId not found in company");
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("PATCH /classrooms/:id returns 404 when classroom does not belong to company", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-comp-B",
        payload: { classroomName: "Renamed" },
      });

      expect(res.statusCode).toBe(404);
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("DELETE /classrooms/:id returns 404 when classroom does not belong to company", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/classrooms/room-comp-B",
      });

      expect(res.statusCode).toBe(404);
      expect(prisma.academyClassroom.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 2. RENEWALS POLYMORPHIC RELATEDID TENANT ISOLATION
  // =========================================================================
  describe("Renewals Tenant Boundary Isolation", () => {
    it("POST /renewals rejects cross-tenant relatedId with 400", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyInstructor.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyComplianceDocument.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/renewals",
        payload: {
          alertType: "certificate_renewal",
          title: "Certificate Expiry Alert",
          dueDate: "2026-10-01",
          relatedId: "cert-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("relatedId not found in company");
      expect(prisma.academyRenewalAlert.create).not.toHaveBeenCalled();
    });

    it("POST /renewals accepts valid relatedId belonging to company", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue({ id: "cert-comp-A" } as any);
      vi.mocked(prisma.academyRenewalAlert.create).mockResolvedValue({
        id: "alert-1",
        companyId: "comp-A",
        relatedId: "cert-comp-A",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/renewals",
        payload: {
          alertType: "certificate_renewal",
          title: "Certificate Expiry Alert",
          dueDate: "2026-10-01",
          relatedId: "cert-comp-A",
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().alert.id).toBe("alert-1");
    });

    it("PATCH /renewals/:id rejects cross-tenant relatedId with 400", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue({
        id: "alert-1",
        companyId: "comp-A",
        alertType: "instructor_accreditation",
      } as any);
      vi.mocked(prisma.academyInstructor.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyComplianceDocument.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/renewals/alert-1",
        payload: {
          relatedId: "instructor-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("relatedId not found in company");
      expect(prisma.academyRenewalAlert.update).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. COURSE-RUNS FOREIGN KEY ISOLATION & EMPTY STRING SANITIZATION
  // =========================================================================
  describe("Course Runs Foreign Key Validation & Sanitization", () => {
    it("POST /course-runs rejects empty string instructorEmployeeId with 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-001",
          academyBranchId: "branch-1",
          instructorEmployeeId: "",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs rejects cross-tenant instructorEmployeeId with 400", async () => {
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue({ id: "branch-1" } as any);
      // Employee not in comp-A
      vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-001",
          academyBranchId: "branch-1",
          instructorEmployeeId: "emp-comp-B",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("instructorEmployeeId not found");
      expect(prisma.courseRun.create).not.toHaveBeenCalled();
    });

    it("POST /course-runs rejects cross-tenant classroomId with 400 if supplied", async () => {
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue({ id: "branch-1" } as any);
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-001",
          academyBranchId: "branch-1",
          classroomId: "room-comp-B",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("classroomId not found");
    });

    it("PATCH /course-runs/:id rejects cross-tenant academyBranchId with 400", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({ id: "run-1", companyId: "comp-A" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-1",
        payload: { academyBranchId: "branch-comp-B" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("academyBranchId not found");
      expect(prisma.courseRun.update).not.toHaveBeenCalled();
    });

    it("PATCH /course-runs/:id rejects empty string instructorEmployeeId with 400", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-1",
        payload: { instructorEmployeeId: "" },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // 4. CERTIFICATE SERVICE: MULTI-TENANT ISOLATION & TRIANGULAR CONSISTENCY
  // =========================================================================
  describe("Certificate Service Multi-Tenant & Triangular Consistency", () => {
    it("rejects when learner does not belong to company", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);

      await expect(
        certificateService.verifyCertificateIssuancePrerequisites(
          prisma as any,
          "comp-A",
          "student-comp-B",
          "course-1",
          "enr-1"
        )
      ).rejects.toThrow("learnerId not found in company");
    });

    it("rejects when course does not belong to company", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-1" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue(null);

      await expect(
        certificateService.verifyCertificateIssuancePrerequisites(
          prisma as any,
          "comp-A",
          "student-1",
          "course-comp-B",
          "enr-1"
        )
      ).rejects.toThrow("courseId not found in company");
    });

    it("rejects when enrolment does not belong to company", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-1" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue(null);

      await expect(
        certificateService.verifyCertificateIssuancePrerequisites(
          prisma as any,
          "comp-A",
          "student-1",
          "course-1",
          "enr-comp-B"
        )
      ).rejects.toThrow("enrolmentId not found in company");
    });

    it("rejects triangular mismatch when enrolment belongs to another student", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-A1" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        companyId: "comp-A",
        studentId: "student-A2", // Different student!
        courseRun: { courseId: "course-1", course: { minimumAttendancePercent: 80 } },
      } as any);

      await expect(
        certificateService.verifyCertificateIssuancePrerequisites(
          prisma as any,
          "comp-A",
          "student-A1",
          "course-1",
          "enr-1"
        )
      ).rejects.toThrow("enrolmentId does not belong to the specified learner");
    });

    it("rejects triangular mismatch when enrolment is linked to a different course", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-1" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        companyId: "comp-A",
        studentId: "student-1",
        courseRun: { courseId: "course-2", course: { minimumAttendancePercent: 80 } }, // Different course!
      } as any);

      await expect(
        certificateService.verifyCertificateIssuancePrerequisites(
          prisma as any,
          "comp-A",
          "student-1",
          "course-1",
          "enr-1"
        )
      ).rejects.toThrow("enrolmentId is not linked to the specified course");
    });
  });

  // =========================================================================
  // 5. ATTENDANCE SERVICE: BRANCH CONSISTENCY ON PARTIAL UPDATES
  // =========================================================================
  describe("Attendance Session Classroom Branch Consistency", () => {
    it("rejects partial session update when new classroom branch does not match existing course run branch", async () => {
      // Existing session holds courseRun in Branch 1
      vi.mocked(prisma.academyAttendanceSession.findFirst).mockResolvedValue({
        id: "session-1",
        companyId: "comp-A",
        courseRunId: "run-branch-1",
        classroomId: "room-branch-1",
        sessionDate: new Date("2026-09-10"),
      } as any);

      // CourseRun belongs to Branch 1
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-branch-1",
        academyBranchId: "branch-1",
      } as any);

      // New classroom belongs to Branch 2 (same company, but different branch premises)
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-branch-2",
        academyBranchId: "branch-2",
      } as any);

      await expect(
        attendanceService.updateAttendanceSession("comp-A", "user-1", "session-1", {
          classroomId: "room-branch-2", // courseRunId not supplied in partial update!
        })
      ).rejects.toThrow("Classroom branch does not match course run branch");
    });
  });

  // =========================================================================
  // 6. INSTRUCTORS SECURITY & RBAC DENIAL AUDIT LOGGING
  // =========================================================================
  describe("Instructors RBAC Hooks & Audit Logging", () => {
    it("rejects POST /instructors/bulk for user lacking edit capability with 403 and records denial", async () => {
      // Set user to view-only (no edit or manage)
      currentTestUser = {
        sub: "viewer-user",
        email: "viewer@example.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view"],
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/bulk",
        payload: {
          action: "status_inactive",
          ids: ["inst-1", "inst-2"],
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Forbidden");
      // Confirm auditFromRequest denial logging was triggered
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          outcome: "denied",
        })
      );
    });

    it("rejects POST /instructors/:id/archive for user lacking delete capability with 403 and records denial", async () => {
      currentTestUser = {
        sub: "editor-user",
        email: "editor@example.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view", "edit"], // lacks delete
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/inst-1/archive",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Forbidden");
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          outcome: "denied",
        })
      );
    });

    it("rejects POST /instructors/:id/restore for user lacking delete capability with 403 and records denial", async () => {
      currentTestUser = {
        sub: "editor-user",
        email: "editor@example.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view", "edit"], // lacks delete
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/inst-1/restore",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe("Forbidden");
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          outcome: "denied",
        })
      );
    });
  });
});
