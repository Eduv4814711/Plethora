import { prisma } from "../../lib/prisma.js";
import { siteHasGeofence } from "../../lib/geo.js";
import type { Site } from "@prisma/client";

export type OfficeGeofenceTarget = {
  id?: string | null;
  name: string;
  companyId: string;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusMeters?: number | null;
  isCompanyAdminDefault?: boolean;
};

/**
 * Resolve the applicable office site and geofence for an office/admin staff member.
 *
 * Priority order:
 * 1. Employee Geofence Exemption: If employee.geofenceExempt === true, returns null (no perimeter check).
 * 2. Active SiteAssignment: SiteAssignment linking the employee to a Site with coordinates.
 * 3. Place of Work match: Site matching the employee's `placeOfWork` string.
 * 4. Company Business Settings Geofence: Admin coordinates configured in Business Settings.
 * 5. Company Head Office fallback: Site matching "Head Office", "HQ", or "Office".
 *
 * If no geofenced site is found, returns null (allowing normal clock-in).
 */
export async function findOfficeSiteForEmployee(
  employeeId: string,
  companyId: string
): Promise<Site | OfficeGeofenceTarget | null> {
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

  // 3. Fallback: Company Business Settings admin geofence coordinates
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, name: true, settings: true },
  });
  const rawSettings = (company?.settings as Record<string, unknown>) ?? {};
  const adminGeofenceEnabled = rawSettings.adminGeofenceEnabled !== false;
  if (
    adminGeofenceEnabled &&
    rawSettings.adminOfficeLatitude != null &&
    rawSettings.adminOfficeLongitude != null
  ) {
    const lat = Number(rawSettings.adminOfficeLatitude);
    const lng = Number(rawSettings.adminOfficeLongitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      const radius = Number(rawSettings.adminGeofenceRadiusMeters);
      const officeName =
        typeof rawSettings.adminOfficeName === "string" && rawSettings.adminOfficeName.trim()
          ? rawSettings.adminOfficeName.trim()
          : `${company?.name || "Company"} Head Office`;
      return {
        id: null,
        name: officeName,
        companyId,
        latitude: lat,
        longitude: lng,
        geofenceRadiusMeters: Number.isFinite(radius) && radius > 0 ? radius : 200,
        isCompanyAdminDefault: true,
      };
    }
  }

  // 4. Fallback: search for standard Head Office / Office site in the company
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

