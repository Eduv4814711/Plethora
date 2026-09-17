/**
 * Canonical domain types for Academy module (frontend).
 * Maps directly to backend schema and API response DTOs.
 */

export type AcademyCourseRunStatus =
  | "planned"
  | "open"
  | "in_progress"
  | "completed"
  | "reported"
  | "closed";

export type AcademyAdminFeeStatus = "unpaid" | "paid" | "waived";

export type AcademyEnrolmentFinancialStatus = "unpaid" | "partial" | "paid";

export type AcademyEnrolmentAttendanceStatus =
  | "pending"
  | "in_progress"
  | "compliant"
  | "non_compliant";

export type AcademyEnrolmentCompletionStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed";

export type AcademyReportingReadinessStatus =
  | "not_started"
  | "incomplete"
  | "ready"
  | "blocked";

export type AcademyPsiraSubmissionStatus =
  | "not_applicable"
  | "not_started"
  | "pending"
  | "submitted"
  | "approved"
  | "rejected";

export type AcademyAttendanceStatus = "present" | "absent" | "late" | "excused";

export type AcademyAssessmentResult =
  | "pass"
  | "fail"
  | "competent"
  | "not_yet_competent";

export type AcademyCertificateStatus = "active" | "revoked";

export type AcademyInvoiceStatus = "draft" | "issued" | "paid" | "cancelled";

export type AcademyPaymentVerificationStatus = "pending" | "verified" | "rejected";

export interface AcademyBranch {
  id: string;
  name: string;
  code?: string | null;
  active?: boolean;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyClassroom {
  id: string;
  academyBranchId: string;
  classroomName: string;
  capacity: number;
  approvedCapacity?: number | null;
  equipmentChecklist?: string | null;
  status: "available" | "in_use" | "maintenance" | "closed";
  branch?: { id: string; name: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyCourse {
  id: string;
  code: string;
  title: string;
  description?: string | null;
  active: boolean;
  minAttendancePercent?: number;
  feeAmount?: string | number | null;
  accreditationBody?: string | null;
  saqaId?: string | null;
  nqfLevel?: number | null;
  credits?: number | null;
  durationDays?: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyCourseRun {
  id: string;
  companyId?: string;
  courseId: string;
  runCode: string;
  intakeName?: string | null;
  academyBranchId: string;
  venueText?: string | null;
  classroomId?: string | null;
  instructorEmployeeId?: string | null;
  startDate: string;
  endDate: string;
  capacity: number;
  enrolledCount: number;
  status: AcademyCourseRunStatus;
  course?: { id?: string; code: string; title: string; feeAmount?: string | number | null };
  branch?: { id?: string; name: string };
  classroom?: { id: string; classroomName: string };
  instructorEmployee?: {
    id: string;
    employeeNumber: string;
    firstName: string;
    lastName: string;
  } | null;
  _count?: { enrolments?: number };
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyStudent {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  idNumber?: string | null;
  dateOfBirth?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  status?: string;
  adminFeeStatus: AcademyAdminFeeStatus;
  adminFeeAmount?: string | number | null;
  adminFeeMethod?: string | null;
  adminFeeReference?: string | null;
  adminFeeNotes?: string | null;
  adminFeePaidAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyStudentDocument {
  id: string;
  studentId: string;
  documentType: string;
  fileName: string;
  fileUrl?: string;
  fileSize?: number;
  mimeType?: string;
  uploadedAt?: string;
  createdAt?: string;
}

export interface AcademyFeePlan {
  id: string;
  name: string;
  notes?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyEnrolment {
  id: string;
  studentId: string;
  courseRunId: string;
  enrolmentDate: string;
  feePlanId?: string | null;
  financialStatus: AcademyEnrolmentFinancialStatus;
  attendanceStatus: AcademyEnrolmentAttendanceStatus;
  completionStatus: AcademyEnrolmentCompletionStatus;
  reportingReadinessStatus: AcademyReportingReadinessStatus;
  psiraSubmissionStatus: AcademyPsiraSubmissionStatus;
  remarks?: string | null;
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    status?: string;
    adminFeeStatus?: AcademyAdminFeeStatus;
  };
  courseRun?: {
    id: string;
    runCode: string;
    intakeName?: string | null;
    startDate: string;
    endDate: string;
    course?: { code: string; title: string };
  };
  feePlan?: { id: string; name: string } | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyAttendanceSession {
  id: string;
  courseRunId?: string | null;
  classroomId?: string | null;
  instructorId?: string | null;
  sessionDate: string;
  recordsCount?: number;
  recordStatusCounts?: Record<string, number>;
  courseRun?: { id: string; runCode: string; intakeName?: string | null; course?: { title: string } } | null;
  classroom?: { id: string; classroomName: string } | null;
  instructor?: { id: string; firstName: string; lastName: string; employeeNumber?: string } | null;
  records?: AcademyAttendanceRecord[];
  _count?: { records?: number };
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyAttendanceRecord {
  id: string;
  sessionId: string;
  enrolmentId: string;
  attendanceStatus: AcademyAttendanceStatus;
  method?: string;
  checkInTime?: string | null;
  checkOutTime?: string | null;
  enrolment?: {
    id?: string;
    student?: {
      id: string;
      studentNumber: string;
      firstName: string;
      lastName: string;
    };
    courseRun?: {
      runCode: string;
    };
  };
  createdAt?: string;
}

export interface AcademyAssessment {
  id: string;
  learnerId: string;
  courseId: string;
  instructorId?: string | null;
  assessmentType: string;
  assessmentDate: string;
  venue?: string | null;
  attemptNumber?: number;
  mark?: number | string | null;
  result?: AcademyAssessmentResult | null;
  moderationStatus?: string | null;
  reassessmentDate?: string | null;
  learner?: { id?: string; studentNumber?: string; firstName: string; lastName: string };
  course?: { id?: string; code: string; title: string };
  instructor?: { id?: string; firstName: string; lastName: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyCertificate {
  id: string;
  certificateNumber: string;
  verificationCode: string;
  learnerId: string;
  courseId: string;
  issueDate: string;
  expiryDate?: string | null;
  status: AcademyCertificateStatus;
  reprintCount: number;
  lastReprintAt?: string | null;
  learner?: { id?: string; studentNumber?: string; firstName: string; lastName: string };
  course?: { id?: string; code: string; title: string };
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyRenewalAlert {
  id: string;
  title: string;
  alertType: string;
  dueDate: string;
  severity: "green" | "amber" | "red";
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyComplianceDocument {
  id: string;
  documentName: string;
  documentType: string;
  status: string;
  expiryDate?: string | null;
  fileUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyPolicy {
  id: string;
  policyType: string;
  version: string;
  nextReviewDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyInvoiceLine {
  id?: string;
  invoiceId?: string;
  description: string;
  quantity: number;
  unitAmount: string | number;
  lineTotal: string | number;
}

export interface AcademyInvoice {
  id: string;
  studentId: string;
  enrolmentId?: string | null;
  invoiceNumber: string;
  status: AcademyInvoiceStatus;
  subtotal: string | number;
  discountAmount: string | number;
  totalAmount: string | number;
  balanceDue: string | number;
  dueDate: string;
  issuedAt?: string | null;
  cancelledAt?: string | null;
  items?: AcademyInvoiceLine[];
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  enrolment?: {
    id: string;
    courseRun?: {
      runCode: string;
      course?: { code: string; title: string };
    };
  };
  payments?: AcademyPayment[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AcademyPayment {
  id: string;
  invoiceId: string;
  studentId: string;
  amount: string | number;
  paymentMethod: string;
  paymentReference?: string | null;
  verificationStatus: AcademyPaymentVerificationStatus;
  receivedAt: string;
  verifiedAt?: string | null;
  rejectionReason?: string | null;
  receiptId?: string | null;
  invoice?: {
    id: string;
    invoiceNumber: string;
    totalAmount?: string | number;
    balanceDue?: string | number;
  };
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  createdAt?: string;
}

export interface AcademyReceipt {
  id: string;
  receiptNumber: string;
  invoiceId: string;
  paymentId: string;
  studentId: string;
  amount: string | number;
  issuedAt: string;
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  invoice?: {
    id: string;
    invoiceNumber: string;
  };
  createdAt?: string;
}

export interface AcademyInstructor {
  id: string;
  firstName: string;
  lastName: string;
  employeeNumber: string;
  email?: string | null;
  phone?: string | null;
  idNumber?: string | null;
  psiraNumber?: string | null;
  psiraGrade?: string | null;
  status: "active" | "inactive" | "suspended" | "contract_ended";
  branchId?: string | null;
  branch?: { id: string; name: string } | null;
  courses?: Array<{ id: string; code: string; title: string }>;
  contractExpiry?: string | null;
  createdAt?: string;
}
