import type { FastifyInstance } from "fastify";
import { prisma } from "../../lib/prisma.js";
import { academyProtect } from "./constants.js";

const ACADEMY_ENTITY_TYPES = [
  "Student",
  "StudentDocument",
  "Course",
  "CourseRun",
  "FeePlan",
  "Enrolment",
  "AcademyBranch",
  "AcademyInvoice",
  "AcademyPayment",
] as const;

type Meta = Record<string, unknown> | null;

function asString(m: Meta, k: string): string | undefined {
  const v = m?.[k];
  return typeof v === "string" ? v : undefined;
}

function asNumber(m: Meta, k: string): number | undefined {
  const v = m?.[k];
  if (typeof v === "number" && !Number.isNaN(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function actionLabel(
  action: string,
  entityType: string,
  metadata: unknown
): string {
  const m = (metadata && typeof metadata === "object" ? metadata : null) as Meta;
  if (action === "academy.enrolment.batch_create") {
    const c = asNumber(m, "count");
    return c && c > 1 ? `New enrolments (${c} course runs)` : "New enrolment";
  }
  if (action === "academy.invoice.issue") {
    const num = asString(m, "invoiceNumber");
    return num ? `Invoice ${num} issued` : "Invoice issued";
  }
  if (action === "academy.payment.verify") return "Payment verified";
  if (action === "academy.payment.create") return "Payment recorded";
  if (action === "academy.payment.reject") return "Payment rejected";
  if (action.startsWith("academy.")) {
    const tail = action.replace("academy.", "");
    if (tail.includes("create")) return `Created ${entityType.replace("Academy", "").toLowerCase() || "record"}`;
    if (tail.includes("update")) return `Updated ${entityType.replace("Academy", "").toLowerCase() || "record"}`;
    if (tail.includes("delete")) return `Deleted ${entityType.replace("Academy", "").toLowerCase() || "record"}`;
  }
  switch (entityType) {
    case "Enrolment":
      return "Enrolment change";
    case "AcademyInvoice":
      return "Invoice activity";
    case "AcademyPayment":
      return "Payment recorded";
    case "CourseRun":
      return "Course run activity";
    case "Student":
      return "Student profile updated";
    case "StudentDocument":
      return "Document uploaded";
    case "Course":
      return "Course activity";
    case "AcademyBranch":
      return "Branch activity";
    case "FeePlan":
      return "Fee plan activity";
    default:
      return action;
  }
}

function linkForEntry(entityType: string, entityId: string | null, metadata: unknown): string | null {
  if (!entityId) return null;
  const m = (metadata && typeof metadata === "object" ? metadata : null) as Meta;
  switch (entityType) {
    case "Student":
    case "StudentDocument": {
      const sid = asString(m, "studentId") ?? (entityType === "Student" ? entityId : null);
      return sid ? `/academy/students/${sid}` : null;
    }
    case "Enrolment":
      return `/academy/enrolments`;
    case "AcademyInvoice":
      return `/academy/invoices/${entityId}`;
    case "AcademyPayment": {
      const inv = asString(m, "invoiceId");
      return inv ? `/academy/invoices/${inv}` : "/academy/finance";
    }
    case "CourseRun":
      return `/academy/course-runs/${entityId}`;
    case "Course":
      return "/academy/courses";
    case "AcademyBranch":
      return "/academy/branches";
    case "FeePlan":
      return "/academy/finance";
    default:
      return "/academy";
  }
}

const DEFAULT_ACTIVITY_LIMIT = 12;
const MAX_ACTIVITY_LIMIT = 100;

export async function academyActivityRoutes(app: FastifyInstance) {
  app.get("/", { preHandler: academyProtect }, async (request) => {
    const companyId = request.user!.companyId;
    const q = request.query as Record<string, string | undefined>;
    const raw = q.limit != null ? Number(q.limit) : DEFAULT_ACTIVITY_LIMIT;
    const take = Math.min(
      Math.max(Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_ACTIVITY_LIMIT, 1),
      MAX_ACTIVITY_LIMIT
    );

    const rows = await prisma.auditLog.findMany({
      where: {
        companyId,
        entityType: { in: [...ACADEMY_ENTITY_TYPES] },
      },
      orderBy: { timestamp: "desc" },
      take,
      include: {
        user: { select: { name: true } },
      },
    });

    const items = rows.map((r) => {
      const label = actionLabel(r.action, r.entityType, r.metadata);
      const link = linkForEntry(r.entityType, r.entityId, r.metadata);
      return {
        id: r.id,
        at: r.timestamp.toISOString(),
        label,
        action: r.action,
        entityType: r.entityType,
        userName: r.user?.name ?? null,
        link: link ?? null,
      };
    });

    return { items };
  });
}
