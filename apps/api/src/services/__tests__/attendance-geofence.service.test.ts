import { describe, it, expect } from "vitest";
import type { Site } from "@prisma/client";
import {
  assertWithinSiteGeofence,
  AttendanceValidationError,
} from "../attendance.service.js";

function mockSite(overrides: Partial<Site> = {}): Site {
  return {
    id: "s1",
    companyId: "c1",
    name: "Test site",
    location: null,
    physicalAddress: null,
    contactPersonName: null,
    contactPersonPhone: null,
    contractOrServiceAgreement: null,
    serviceType: null,
    monthlyRevenue: null,
    latitude: null,
    longitude: null,
    geofenceRadiusMeters: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Site;
}

describe("assertWithinSiteGeofence", () => {
  it("does not throw when geofence is not configured", () => {
    expect(() => assertWithinSiteGeofence(mockSite(), -26.1, 28.0)).not.toThrow();
  });

  it("allows coordinates inside the radius", () => {
    const site = mockSite({
      latitude: -26.1 as Site["latitude"],
      longitude: 28.0 as Site["longitude"],
      geofenceRadiusMeters: 5000,
    });
    expect(() => assertWithinSiteGeofence(site, -26.1001, 28.0001)).not.toThrow();
  });

  it("throws when outside the radius", () => {
    const site = mockSite({
      latitude: -26.1 as Site["latitude"],
      longitude: 28.0 as Site["longitude"],
      geofenceRadiusMeters: 50,
    });
    expect(() => assertWithinSiteGeofence(site, -26.2, 28.0)).toThrow(AttendanceValidationError);
  });
});
