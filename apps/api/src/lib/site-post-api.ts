import type { Prisma } from "@prisma/client";

const employeeSelect = {
  id: true,
  firstName: true,
  lastName: true,
  status: true,
  phone: true,
  gender: true,
  employeeType: true,
} satisfies Prisma.EmployeeSelect;

export const siteDetailInclude = {
  posts: {
    orderBy: { sortOrder: "asc" as const },
    include: {
      guardEligibilities: {
        include: { employee: { select: employeeSelect } },
      },
      coverageRequirements: { where: { isEnabled: true } },
    },
  },
  assignedGuards: {
    where: { isActive: true },
    include: { employee: { select: employeeSelect } },
  },
  payProfiles: {
    orderBy: { effectiveFrom: "desc" as const },
    take: 1,
    include: {
      area: { select: { id: true, name: true, isActive: true } },
      grade: { select: { id: true, name: true, isActive: true } },
    },
  },
  supervisor: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true, email: true, phone: true } },
} satisfies Prisma.SiteInclude;

type SitePostRow = Prisma.SitePostGetPayload<{
  include: {
    guardEligibilities: { include: { employee: { select: typeof employeeSelect } } };
    coverageRequirements: true;
  };
}>;

type SiteDetailRow = Prisma.SiteGetPayload<{ include: typeof siteDetailInclude }>;

export function inferPostShiftType(
  coverages: { shiftTypeCode: string; isEnabled: boolean }[]
): string | null {
  const enabled = coverages.filter((c) => c.isEnabled);
  const hasDay = enabled.some((c) => c.shiftTypeCode === "day");
  const hasNight = enabled.some((c) => c.shiftTypeCode === "night");
  if (hasNight && !hasDay) return "night";
  if (hasDay) return "day";
  return null;
}

export function mapPostForApi(post: SitePostRow) {
  return {
    id: post.id,
    name: post.name,
    shiftType: inferPostShiftType(post.coverageRequirements),
    assignedGuards: post.guardEligibilities.map((g) => ({
      id: g.id,
      employee: g.employee,
    })),
  };
}

export function mapSiteForApi(site: SiteDetailRow) {
  const { posts, monthlyRevenue: _revenue, ...rest } = site;
  return {
    ...rest,
    posts: posts.map(mapPostForApi),
  };
}
