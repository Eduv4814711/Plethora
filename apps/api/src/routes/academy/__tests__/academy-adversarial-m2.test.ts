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
      delete: vi.fn(),
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
import { academyCertificatesRoutes } from "../certificates.js";
import { academyRenewalsRoutes } from "../renewals.js";
import { academyCourseRunsRoutes } from "../course-runs.js";
import * as attendanceService from "../../../services/academy-attendance.service.js";

describe("Milestone 2 Empirical Challenger Penetration Harness", () => {
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
    await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
    await app.register(academyRenewalsRoutes, { prefix: "/renewals" });
    await app.register(academyCourseRunsRoutes, { prefix: "/course-runs" });
    await app.ready();
  });

  // =========================================================================
  // CHALLENGE 1: CLASSROOMS CROSS-TENANT BRANCH PENETRATION
  // =========================================================================
  describe("Challenge 1: Classroom referencing Tenant B's branch", () => {
    it("POST /classrooms: Tenant A cannot create classroom referencing Tenant B's branch (rejected with 400)", async () => {
      // Mock: Branch belongs to Tenant B, so findFirst with comp-A returns null
      vi.mocked(prisma.academyBranch.findFirst).mockImplementation(async (args: any) => {
        if (args?.where?.companyId === "comp-A" && args?.where?.id === "branch-comp-B") {
          return null;
        }
        return null;
      });

      const res = await app.inject({
        method: "POST",
        url: "/classrooms",
        payload: {
          academyBranchId: "branch-comp-B",
          classroomName: "Infiltrated Classroom",
          capacity: 30,
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("academyBranchId not found in company");
      expect(prisma.academyClassroom.create).not.toHaveBeenCalled();
    });

    it("PATCH /classrooms/:id: Tenant A cannot update classroom to reference Tenant B's branch (rejected with 400)", async () => {
      // Existing classroom belongs to Tenant A
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-comp-A",
        companyId: "comp-A",
        classroomName: "Tenant A Room",
        academyBranchId: "branch-comp-A",
      } as any);

      // Branch lookup for Tenant B's branch under comp-A returns null
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-comp-A",
        payload: {
          academyBranchId: "branch-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("academyBranchId not found in company");
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("PATCH /classrooms/:id: Tenant A cannot update Tenant B's classroom (returns 404 Not Found)", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-comp-B",
        payload: {
          classroomName: "Compromised Name",
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("DELETE /classrooms/:id: Tenant A cannot delete Tenant B's classroom (returns 404 Not Found)", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/classrooms/room-comp-B",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyClassroom.delete).not.toHaveBeenCalled();
    });

    it("POST /classrooms: Rejects empty string or whitespace academyBranchId with 400", async () => {
      const res1 = await app.inject({
        method: "POST",
        url: "/classrooms",
        payload: {
          academyBranchId: "",
          classroomName: "Room 101",
        },
      });
      expect(res1.statusCode).toBe(400);

      const res2 = await app.inject({
        method: "POST",
        url: "/classrooms",
        payload: {
          academyBranchId: "   ",
          classroomName: "Room 101",
        },
      });
      expect(res2.statusCode).toBe(400);
    });
  });

  // =========================================================================
  // CHALLENGE 2: CERTIFICATES CROSS-TENANT & TRIANGULAR CONSISTENCY (HTTP POST)
  // =========================================================================
  describe("Challenge 2: Certificate referencing Tenant B's learner/course or mismatched enrolment (HTTP POST /certificates)", () => {
    it("POST /certificates: Tenant A cannot issue certificate referencing Tenant B's learner (rejected with 400)", async () => {
      // Learner does not exist under comp-A
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-comp-A" } as any);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "student-comp-B",
          courseId: "course-comp-A",
          issueDate: "2026-09-07",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("learnerId not found in company");
      expect(prisma.academyCertificate.create).not.toHaveBeenCalled();
    });

    it("POST /certificates: Tenant A cannot issue certificate referencing Tenant B's course (rejected with 400)", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-comp-A" } as any);
      // Course does not exist under comp-A
      vi.mocked(prisma.course.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "student-comp-A",
          courseId: "course-comp-B",
          issueDate: "2026-09-07",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("courseId not found in company");
      expect(prisma.academyCertificate.create).not.toHaveBeenCalled();
    });

    it("POST /certificates: Tenant A cannot issue certificate referencing Tenant B's enrolment (rejected with 400)", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-comp-A" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-comp-A" } as any);
      // Enrolment does not exist under comp-A
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "student-comp-A",
          courseId: "course-comp-A",
          enrolmentId: "enr-comp-B",
          issueDate: "2026-09-07",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("enrolmentId not found in company");
      expect(prisma.academyCertificate.create).not.toHaveBeenCalled();
    });

    it("POST /certificates: Triangular mismatch - enrolment linked to a DIFFERENT course (rejected with 400)", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-comp-A" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-A1" } as any);
      // Enrolment belongs to student-comp-A, but courseRun is for course-A2
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        companyId: "comp-A",
        studentId: "student-comp-A",
        courseRun: {
          courseId: "course-A2", // MISMATCH with requested course-A1
          course: { minimumAttendancePercent: 80, requiresAssessment: false },
        },
        completionStatus: "completed",
        attendanceStatus: "compliant",
        reportingReadinessStatus: "ready",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "student-comp-A",
          courseId: "course-A1",
          enrolmentId: "enr-1",
          issueDate: "2026-09-07",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("enrolmentId is not linked to the specified course");
      expect(prisma.academyCertificate.create).not.toHaveBeenCalled();
    });

    it("POST /certificates: Triangular mismatch - enrolment linked to a DIFFERENT learner (rejected with 400)", async () => {
      vi.mocked(prisma.student.findFirst).mockResolvedValue({ id: "student-A1" } as any);
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-A1" } as any);
      // Enrolment belongs to student-A2, but request specifies student-A1
      vi.mocked(prisma.enrolment.findFirst).mockResolvedValue({
        id: "enr-1",
        companyId: "comp-A",
        studentId: "student-A2", // MISMATCH with requested student-A1
        courseRun: {
          courseId: "course-A1",
          course: { minimumAttendancePercent: 80, requiresAssessment: false },
        },
        completionStatus: "completed",
        attendanceStatus: "compliant",
        reportingReadinessStatus: "ready",
      } as any);

      const res = await app.inject({
        method: "POST",
        url: "/certificates",
        payload: {
          learnerId: "student-A1",
          courseId: "course-A1",
          enrolmentId: "enr-1",
          issueDate: "2026-09-07",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("enrolmentId does not belong to the specified learner");
      expect(prisma.academyCertificate.create).not.toHaveBeenCalled();
    });

    it("GET /certificates/:id: Tenant A cannot view Tenant B's certificate (returns 404)", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/certificates/cert-comp-B",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
    });
  });

  // =========================================================================
  // CHALLENGE 3: RENEWALS CROSS-TENANT PENETRATION
  // =========================================================================
  describe("Challenge 3: Renewal alert linking to Tenant B's certificate or instructor", () => {
    it("POST /renewals: Tenant A cannot link renewal alert to Tenant B's certificate (rejected with 400)", async () => {
      // Mock all findFirsts for comp-A to return null
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
          title: "Tenant B Certificate Renewal Alert",
          dueDate: "2026-10-15",
          relatedId: "cert-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("relatedId not found in company");
      expect(prisma.academyRenewalAlert.create).not.toHaveBeenCalled();
    });

    it("POST /renewals: Tenant A cannot link renewal alert to Tenant B's instructor (rejected with 400)", async () => {
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyInstructor.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyComplianceDocument.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/renewals",
        payload: {
          alertType: "instructor_accreditation",
          title: "Tenant B Instructor Accreditation Renewal",
          dueDate: "2026-11-01",
          relatedId: "instructor-comp-B",
        },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("relatedId not found in company");
      expect(prisma.academyRenewalAlert.create).not.toHaveBeenCalled();
    });

    it("PATCH /renewals/:id: Tenant A cannot update alert to reference Tenant B's instructor (rejected with 400)", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue({
        id: "alert-1",
        companyId: "comp-A",
        alertType: "instructor_accreditation",
        title: "Valid Alert",
        dueDate: new Date("2026-12-01"),
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
      const body = res.json();
      expect(body.error).toBe("Validation error");
      expect(body.message).toContain("relatedId not found in company");
      expect(prisma.academyRenewalAlert.update).not.toHaveBeenCalled();
    });

    it("POST /renewals: Empty string relatedId is rejected with 400 (not unhandled 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/renewals",
        payload: {
          alertType: "compliance_renewal",
          title: "Check empty string",
          dueDate: "2026-10-15",
          relatedId: "",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });
  });

  // =========================================================================
  // CHALLENGE 4: COURSE-RUNS EMPTY STRING FOREIGN KEYS & 500 CRASH PROBING
  // =========================================================================
  describe("Challenge 4: Empty string foreign keys and cross-tenant foreign keys on course-run endpoints", () => {
    it("POST /course-runs: Rejects empty string instructorEmployeeId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-EMPTY-INST",
          academyBranchId: "branch-1",
          instructorEmployeeId: "",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs: Rejects whitespace instructorEmployeeId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-WS-INST",
          academyBranchId: "branch-1",
          instructorEmployeeId: "   ",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs: Rejects empty string classroomId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-EMPTY-CLASS",
          academyBranchId: "branch-1",
          classroomId: "",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs: Rejects empty string courseId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "",
          runCode: "RUN-EMPTY-COURSE",
          academyBranchId: "branch-1",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs: Rejects empty string academyBranchId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-EMPTY-BRANCH",
          academyBranchId: "",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("PATCH /course-runs/:id: Rejects empty string instructorEmployeeId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-1",
        payload: {
          instructorEmployeeId: "",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("PATCH /course-runs/:id: Rejects empty string classroomId with 400 (never 500)", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-1",
        payload: {
          classroomId: "",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe("Validation error");
    });

    it("POST /course-runs: Tenant A cannot reference Tenant B's branch (rejected with 400)", async () => {
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-TENANT-B-BRANCH",
          academyBranchId: "branch-comp-B",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("academyBranchId not found");
      expect(prisma.courseRun.create).not.toHaveBeenCalled();
    });

    it("POST /course-runs: Tenant A cannot reference Tenant B's instructor (rejected with 400)", async () => {
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue({ id: "branch-1" } as any);
      vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-TENANT-B-INST",
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

    it("POST /course-runs: Tenant A cannot reference Tenant B's classroom (rejected with 400)", async () => {
      vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: "course-1" } as any);
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue({ id: "branch-1" } as any);
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: "/course-runs",
        payload: {
          courseId: "course-1",
          runCode: "RUN-TENANT-B-CLASS",
          academyBranchId: "branch-1",
          classroomId: "room-comp-B",
          startDate: "2026-09-10",
          endDate: "2026-09-20",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toContain("classroomId not found");
      expect(prisma.courseRun.create).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // CHALLENGE 5: ATTENDANCE SESSION CLASSROOM BRANCH CONSISTENCY
  // =========================================================================
  describe("Challenge 5: Attendance Session Classroom Branch Consistency", () => {
    it("Rejects update when classroom branch does not match course run branch", async () => {
      vi.mocked(prisma.academyAttendanceSession.findFirst).mockResolvedValue({
        id: "sess-1",
        companyId: "comp-A",
        courseRunId: "run-1",
      } as any);

      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-1",
        academyBranchId: "branch-A",
      } as any);

      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-B",
        academyBranchId: "branch-B", // MISMATCH
      } as any);

      await expect(
        attendanceService.updateAttendanceSession("comp-A", "user-1", "sess-1", {
          classroomId: "room-B",
        })
      ).rejects.toThrow("Classroom branch does not match course run branch");
    });
  });
});
