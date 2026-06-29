import type { Prisma, ShiftStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma.js";

const shiftListInclude = {
  employee: { select: { id: true, firstName: true, lastName: true, gender: true, phone: true } },
  site: true,
} satisfies Prisma.ShiftInclude;

const shiftDetailInclude = {
  employee: true,
  site: true,
  attendances: true,
} satisfies Prisma.ShiftInclude;

export const rosteringRepository = {
  findShifts(args: {
    where: Prisma.ShiftWhereInput;
    limit: number;
    offset: number;
  }) {
    return prisma.shift.findMany({
      where: args.where,
      include: shiftListInclude,
      take: args.limit,
      skip: args.offset,
      orderBy: { startTime: "asc" },
    });
  },

  countShifts(where: Prisma.ShiftWhereInput) {
    return prisma.shift.count({ where });
  },

  findShiftById(companyId: string, id: string, include: Prisma.ShiftInclude = shiftDetailInclude) {
    return prisma.shift.findFirst({
      where: { id, companyId },
      include,
    });
  },

  findShiftScalars(companyId: string, id: string) {
    return prisma.shift.findFirst({
      where: { id, companyId },
    });
  },

  createShift(
    data: Prisma.ShiftUncheckedCreateInput,
    include: Prisma.ShiftInclude = shiftListInclude
  ) {
    return prisma.shift.create({ data, include });
  },

  async updateShift(
    companyId: string,
    id: string,
    data: Prisma.ShiftUncheckedUpdateInput,
    include: Prisma.ShiftInclude = shiftListInclude
  ) {
    const result = await prisma.shift.updateMany({
      where: { id, companyId },
      data,
    });
    if (result.count === 0) return null;
    return prisma.shift.findFirst({ where: { id, companyId }, include });
  },

  async updateShiftStatus(
    companyId: string,
    id: string,
    status: ShiftStatus,
    include: Prisma.ShiftInclude = shiftListInclude
  ) {
    const result = await prisma.shift.updateMany({
      where: { id, companyId },
      data: { status },
    });
    if (result.count === 0) return null;
    return prisma.shift.findFirst({ where: { id, companyId }, include });
  },

  async deleteShift(companyId: string, id: string) {
    const result = await prisma.shift.deleteMany({ where: { id, companyId } });
    return result.count > 0;
  },

  deleteShifts(where: Prisma.ShiftWhereInput) {
    return prisma.shift.deleteMany({ where });
  },

  findPostWithSite(postId: string) {
    return prisma.sitePost.findFirst({
      where: { id: postId },
      include: { site: true, coverageRequirements: { where: { isEnabled: true } } },
    });
  },

  findSiteWithPostsForBulk(siteId: string, companyId: string) {
    return prisma.site.findFirst({
      where: { id: siteId, companyId },
      include: {
        posts: {
          include: {
            guardEligibilities: { select: { employeeId: true } },
            coverageRequirements: { where: { isEnabled: true } },
          },
        },
      },
    });
  },

  findSiteWithAssignedGuards(siteId: string, companyId: string) {
    return prisma.site.findFirst({
      where: { id: siteId, companyId },
      include: {
        assignedGuards: {
          include: {
            employee: {
              select: { id: true, status: true, employeeType: true },
            },
          },
        },
      },
    });
  },

  findShiftWithSite(companyId: string, id: string) {
    return prisma.shift.findFirst({
      where: { id, companyId },
      include: { site: true },
    });
  },

  findOverlappingShiftEmployeeIds(
    companyId: string,
    excludeShiftId: string,
    startTime: Date,
    endTime: Date
  ) {
    return prisma.shift.findMany({
      where: {
        companyId,
        id: { not: excludeShiftId },
        startTime: { lt: endTime },
        endTime: { gt: startTime },
      },
      select: { employeeId: true },
      distinct: ["employeeId"],
    });
  },

  findRelieverCandidates(companyId: string, excludeEmployeeIds: string[]) {
    return prisma.employee.findMany({
      where: {
        companyId,
        id: { notIn: excludeEmployeeIds },
        employeeType: "security",
        status: { in: ["active", "training", "hired", "reliever"] },
      },
      select: { id: true, firstName: true, lastName: true, gender: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    });
  },
};
