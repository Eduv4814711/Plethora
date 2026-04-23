import type { FastifyInstance } from "fastify";
import { academyStudentDocumentsRoutes } from "./student-documents.js";
import { academyStudentsRoutes } from "./students.js";
import { academyBranchesRoutes } from "./branches.js";
import { academyCoursesRoutes } from "./courses.js";
import { academyCourseRunsRoutes } from "./course-runs.js";
import { academyFeePlansRoutes } from "./fee-plans.js";
import { academyEnrolmentsRoutes } from "./enrolments.js";
import { academyInvoicesRoutes } from "./invoices.js";
import { academyPaymentsRoutes } from "./payments.js";
import { academyReceiptsRoutes } from "./receipts.js";
import { academyFinanceDashboardRoutes } from "./finance-dashboard.js";
import { academyHubRoutes } from "./hub.js";
import { academyActivityRoutes } from "./activity.js";
import { academyProfileRoutes } from "./profile.js";
import { academyInstructorsRoutes } from "./instructors.js";
import { academyClassroomsRoutes } from "./classrooms.js";
import { academyAttendanceRoutes } from "./attendance.js";
import { academyAssessmentsRoutes } from "./assessments.js";
import { academyCertificatesRoutes } from "./certificates.js";
import { academyComplianceDocumentsRoutes } from "./compliance-documents.js";
import { academyPoliciesRoutes } from "./policies.js";
import { academyRenewalsRoutes } from "./renewals.js";
import { academyReportsRoutes } from "./reports.js";
import { academyAuditRoutes } from "./audit.js";

/**
 * Academy Management API — register with `{ prefix: "/academy" }`.
 * Register student document routes before generic `/:id` student routes.
 */
export async function academyRoutes(app: FastifyInstance) {
  await app.register(academyProfileRoutes, { prefix: "/profile" });
  await app.register(academyHubRoutes, { prefix: "/hub" });
  await app.register(academyActivityRoutes, { prefix: "/activity" });
  await app.register(academyInstructorsRoutes, { prefix: "/instructors" });
  await app.register(academyClassroomsRoutes, { prefix: "/classrooms" });
  await app.register(academyAttendanceRoutes, { prefix: "/attendance" });
  await app.register(academyAssessmentsRoutes, { prefix: "/assessments" });
  await app.register(academyCertificatesRoutes, { prefix: "/certificates" });
  await app.register(academyComplianceDocumentsRoutes, { prefix: "/compliance-documents" });
  await app.register(academyPoliciesRoutes, { prefix: "/policies" });
  await app.register(academyRenewalsRoutes, { prefix: "/renewals" });
  await app.register(academyReportsRoutes, { prefix: "/reports" });
  await app.register(academyAuditRoutes, { prefix: "/audit" });
  await app.register(academyBranchesRoutes, { prefix: "/branches" });
  await app.register(academyCoursesRoutes, { prefix: "/courses" });
  await app.register(academyCourseRunsRoutes, { prefix: "/course-runs" });
  await app.register(academyFeePlansRoutes, { prefix: "/fee-plans" });
  await app.register(academyInvoicesRoutes, { prefix: "/invoices" });
  await app.register(academyPaymentsRoutes, { prefix: "/payments" });
  await app.register(academyReceiptsRoutes, { prefix: "/receipts" });
  await app.register(academyFinanceDashboardRoutes, { prefix: "/finance" });
  await app.register(academyEnrolmentsRoutes, { prefix: "/enrolments" });
  await app.register(academyStudentDocumentsRoutes, { prefix: "/students" });
  await app.register(academyStudentsRoutes, { prefix: "/students" });
}
