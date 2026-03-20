import { describe, it, expect } from "vitest";
import { haversineMeters, siteHasGeofence } from "../geo.js";

describe("haversineMeters", () => {
  it("is ~0 for identical points", () => {
    expect(haversineMeters(-26.1, 28.0, -26.1, 28.0)).toBeLessThan(1);
  });

  it("approximates known short distance", () => {
    // ~1km north from a point near Johannesburg
    const a = -26.1;
    const b = 28.0;
    const a2 = -26.091;
    const b2 = 28.0;
    const d = haversineMeters(a, b, a2, b2);
    expect(d).toBeGreaterThan(900);
    expect(d).toBeLessThan(1100);
  });
});

describe("siteHasGeofence", () => {
  it("is false when radius missing", () => {
    expect(
      siteHasGeofence({
        latitude: -26.0,
        longitude: 28.0,
        geofenceRadiusMeters: null,
      })
    ).toBe(false);
  });

  it("is true when all set", () => {
    expect(
      siteHasGeofence({
        latitude: -26.0,
        longitude: 28.0,
        geofenceRadiusMeters: 150,
      })
    ).toBe(true);
  });
});
