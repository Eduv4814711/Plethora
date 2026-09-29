import { prisma } from "../../lib/prisma.js";
import { siteHasGeofence } from "../../lib/geo.js";
import type { Site } from "@prisma/client";

/**
 * Resolve the applicable office site and geofence for an office/admin staff member.
 *
 * Priority order:
 * 1. Employee Geofence Exemption: If employee.geofenceExempt === true, returns null (no perimeter check).
 * 2. Active SiteAssignment: SiteAssignment linking the employee to a Site with coordinates.
 * 3. Place of Work match: Site matching the employee's `placeOfWork` string.
 * 4. Company Head Office fallback: Site matching "Head Office", "HQ", or "Office".
 *
 * If no geofenced site is found, returns null (allowing normal clock-in).
 */
export async function findOfficeSiteForEmployee(
  employeeId: string,
  companyId: string
): Promise<Site | null> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      id: true,
      companyId: true,
      geofenceExempt: true,
      placeOfWork: true,
    },
  });

  if (!employee || employee.companyId !== companyId || employee.geofenceExempt) {
    return null;
  }

  // 1. Check active SiteAssignment to a geofenced site
  const assignment = await prisma.siteAssignment?.findFirst?.({
    where: {
      employeeId,
      isActive: true,
      site: {
        companyId,
        latitude: { not: null },
        longitude: { not: null },
      },
    },
    include: { site: true },
    orderBy: { assignedAt: "desc" },
  });

  if (assignment?.site && siteHasGeofence(assignment.site)) {
    return assignment.site;
  }

  // 2. Fallback: match Employee.placeOfWork against Site.name
  if (employee.placeOfWork && employee.placeOfWork.trim() && prisma.site?.findFirst) {
    const powSite = await prisma.site.findFirst({
      where: {
        companyId,
        name: { equals: employee.placeOfWork.trim(), mode: "insensitive" },
        latitude: { not: null },
        longitude: { not: null },
      },
    });
    if (powSite && siteHasGeofence(powSite)) {
      return powSite;
    }
  }

  // 3. Fallback: search for standard Head Office / Office site in the company
  const officeKeywords = ["Head Office", "HQ", "Main Office", "Corporate Office", "Office"];
  if (prisma.site?.findFirst) {
    for (const keyword of officeKeywords) {
      const officeSite = await prisma.site.findFirst({
        where: {
          companyId,
          name: { contains: keyword, mode: "insensitive" },
          latitude: { not: null },
          longitude: { not: null },
        },
      });
      if (officeSite && siteHasGeofence(officeSite)) {
        return officeSite;
      }
    }
  }

  return null;
}
