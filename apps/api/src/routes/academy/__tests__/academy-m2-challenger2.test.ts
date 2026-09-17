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
      findMany: vi.fn(),
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

describe("Milestone 2 Challenger 2 Empirical Stress Tests", () => {
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
  // 1. CAPABILITY DENIAL AUDIT LOGGING EMPIRICAL VERIFICATION
  // =========================================================================
  describe("1. Capability Denial Audit Logging Verification", () => {
    it("POST /instructors/bulk: invokes recordDenial() with { action: 'access.denied', outcome: 'denied' } when lacking edit capability", async () => {
      // User has only view capability
      currentTestUser = {
        sub: "viewer-usr-1",
        email: "viewer@comp-a.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view"],
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/bulk",
        payload: {
          action: "status",
          status: "inactive",
          ids: ["inst-1", "inst-2"],
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: "Forbidden",
        message: "You do not have permission to perform this action",
      });

      // Verify recordDenial -> auditFromRequest was called with exact forensic denial structure
      expect(mockAuditFromRequest).toHaveBeenCalledTimes(1);
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          entityType: "capability",
          entityId: "/academy",
          outcome: "denied",
          metadata: expect.objectContaining({
            modules: ["/academy"],
            capability: "edit",
            method: "POST",
          }),
        })
      );
    });

    it("POST /instructors/:id/archive: invokes recordDenial() with capability 'delete' when lacking delete capability", async () => {
      // User has view + edit, but lacks delete
      currentTestUser = {
        sub: "editor-usr-1",
        email: "editor@comp-a.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view", "edit"],
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/inst-99/archive",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: "Forbidden",
        message: "You do not have permission to perform this action",
      });

      expect(mockAuditFromRequest).toHaveBeenCalledTimes(1);
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          entityType: "capability",
          entityId: "/academy",
          outcome: "denied",
          metadata: expect.objectContaining({
            modules: ["/academy"],
            capability: "delete",
            method: "POST",
          }),
        })
      );
    });

    it("POST /instructors/:id/restore: invokes recordDenial() with capability 'delete' when lacking delete capability", async () => {
      // User has view + edit, but lacks delete
      currentTestUser = {
        sub: "editor-usr-2",
        email: "editor2@comp-a.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view", "edit"],
        },
      };

      const res = await app.inject({
        method: "POST",
        url: "/instructors/inst-99/restore",
      });

      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({
        error: "Forbidden",
        message: "You do not have permission to perform this action",
      });

      expect(mockAuditFromRequest).toHaveBeenCalledTimes(1);
      expect(mockAuditFromRequest).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: "access.denied",
          entityType: "capability",
          entityId: "/academy",
          outcome: "denied",
          metadata: expect.objectContaining({
            modules: ["/academy"],
            capability: "delete",
            method: "POST",
          }),
        })
      );
    });

    it("Audit deduplication: rapid repeated unauthorized requests record denial only once within dedupe window", async () => {
      currentTestUser = {
        sub: "spammer-usr",
        email: "spammer@comp-a.com",
        companyId: "comp-A",
        capabilities: {
          "/academy": ["view"],
        },
      };

      // Fire 5 unauthorized requests consecutively
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/instructors/bulk",
          payload: { action: "status", status: "inactive", ids: ["inst-1"] },
        });
        expect(res.statusCode).toBe(403);
      }

      // Despite 5 requests, auditFromRequest should be deduplicated to exactly 1 call
      expect(mockAuditFromRequest).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. QUERY SCOPING STRESS TESTS: CLASSROOMS.TS
  // =========================================================================
  describe("2. Query Scoping: classrooms.ts", () => {
    it("GET /classrooms/:id: Enforces { id, companyId } and returns 404 for cross-tenant ID", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/classrooms/room-tenant-b",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyClassroom.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "room-tenant-b", companyId: "comp-A" },
          include: { branch: true },
        })
      );
    });

    it("PATCH /classrooms/:id: Enforces { id, companyId } existence check; never updates if record belongs to another company", async () => {
      // Simulate classroom belonging to comp-B (not found for comp-A)
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-tenant-b",
        payload: { classroomName: "Malicious Rename" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyClassroom.findFirst).toHaveBeenCalledWith({
        where: { id: "room-tenant-b", companyId: "comp-A" },
      });
      // Verification: update must NEVER be triggered
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("PATCH /classrooms/:id: Rejects cross-tenant academyBranchId with 400 even if classroom belongs to company", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue({
        id: "room-tenant-a",
        companyId: "comp-A",
      } as any);
      // Branch check returns null for comp-A
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/classrooms/room-tenant-a",
        payload: { academyBranchId: "branch-tenant-b" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("academyBranchId not found in company");
      expect(prisma.academyBranch.findFirst).toHaveBeenCalledWith({
        where: { id: "branch-tenant-b", companyId: "comp-A" },
        select: { id: true },
      });
      expect(prisma.academyClassroom.update).not.toHaveBeenCalled();
    });

    it("DELETE /classrooms/:id: Enforces { id, companyId } existence check; never deletes if record belongs to another company", async () => {
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/classrooms/room-tenant-b",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyClassroom.findFirst).toHaveBeenCalledWith({
        where: { id: "room-tenant-b", companyId: "comp-A" },
      });
      // Verification: delete must NEVER be triggered
      expect(prisma.academyClassroom.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 3. QUERY SCOPING STRESS TESTS: RENEWALS.TS
  // =========================================================================
  describe("3. Query Scoping: renewals.ts", () => {
    it("GET /renewals/:id: Enforces { id, companyId } and returns 404 for cross-tenant alert", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/renewals/alert-tenant-b",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyRenewalAlert.findFirst).toHaveBeenCalledWith({
        where: { id: "alert-tenant-b", companyId: "comp-A" },
      });
    });

    it("PATCH /renewals/:id: Enforces { id, companyId } existence check; never updates if alert belongs to another company", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/renewals/alert-tenant-b",
        payload: { notes: "Cross-tenant tampering" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyRenewalAlert.findFirst).toHaveBeenCalledWith({
        where: { id: "alert-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.academyRenewalAlert.update).not.toHaveBeenCalled();
    });

    it("PATCH /renewals/:id: Rejects cross-tenant relatedId with 400 when updating existing alert", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue({
        id: "alert-tenant-a",
        companyId: "comp-A",
        alertType: "certificate_renewal",
      } as any);
      // Foreign entity not found in comp-A
      vi.mocked(prisma.academyCertificate.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyInstructor.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.academyComplianceDocument.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.student.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/renewals/alert-tenant-a",
        payload: { relatedId: "cert-tenant-b" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("relatedId not found in company");
      expect(prisma.academyRenewalAlert.update).not.toHaveBeenCalled();
    });

    it("DELETE /renewals/:id: Enforces { id, companyId } existence check; never deletes if alert belongs to another company", async () => {
      vi.mocked(prisma.academyRenewalAlert.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "DELETE",
        url: "/renewals/alert-tenant-b",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.academyRenewalAlert.findFirst).toHaveBeenCalledWith({
        where: { id: "alert-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.academyRenewalAlert.delete).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // 4. QUERY SCOPING STRESS TESTS: COURSE-RUNS.TS
  // =========================================================================
  describe("4. Query Scoping: course-runs.ts", () => {
    it("GET /course-runs/:id: Enforces { id, companyId } and returns 404 for cross-tenant course run", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/course-runs/run-tenant-b",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.courseRun.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "run-tenant-b", companyId: "comp-A" },
        })
      );
    });

    it("PATCH /course-runs/:id: Enforces { id, companyId } existence check; never updates if course run belongs to another company", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-tenant-b",
        payload: { runCode: "MUTATED-CODE" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe("Not found");
      expect(prisma.courseRun.findFirst).toHaveBeenCalledWith({
        where: { id: "run-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.courseRun.update).not.toHaveBeenCalled();
    });

    it("PATCH /course-runs/:id: Rejects cross-tenant classroomId with 400 when updating valid course run", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-tenant-a",
        companyId: "comp-A",
      } as any);
      // Classroom not in comp-A
      vi.mocked(prisma.academyClassroom.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-tenant-a",
        payload: { classroomId: "room-tenant-b" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("classroomId not found");
      expect(prisma.academyClassroom.findFirst).toHaveBeenCalledWith({
        where: { id: "room-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.courseRun.update).not.toHaveBeenCalled();
    });

    it("PATCH /course-runs/:id: Rejects cross-tenant instructorEmployeeId with 400 when updating valid course run", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-tenant-a",
        companyId: "comp-A",
      } as any);
      // Employee not in comp-A
      vi.mocked(prisma.employee.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-tenant-a",
        payload: { instructorEmployeeId: "emp-tenant-b" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("instructorEmployeeId not found");
      expect(prisma.employee.findFirst).toHaveBeenCalledWith({
        where: { id: "emp-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.courseRun.update).not.toHaveBeenCalled();
    });

    it("PATCH /course-runs/:id: Rejects cross-tenant academyBranchId with 400 when updating valid course run", async () => {
      vi.mocked(prisma.courseRun.findFirst).mockResolvedValue({
        id: "run-tenant-a",
        companyId: "comp-A",
      } as any);
      // Branch not in comp-A
      vi.mocked(prisma.academyBranch.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "PATCH",
        url: "/course-runs/run-tenant-a",
        payload: { academyBranchId: "branch-tenant-b" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().message).toBe("academyBranchId not found");
      expect(prisma.academyBranch.findFirst).toHaveBeenCalledWith({
        where: { id: "branch-tenant-b", companyId: "comp-A" },
      });
      expect(prisma.courseRun.update).not.toHaveBeenCalled();
    });
  });
});
