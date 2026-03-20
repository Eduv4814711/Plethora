import type { Site } from "@prisma/client";

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export function siteHasGeofence(site: {
  latitude: unknown;
  longitude: unknown;
  geofenceRadiusMeters: number | null;
}): boolean {
  return (
    site.latitude != null &&
    site.longitude != null &&
    site.geofenceRadiusMeters != null &&
    site.geofenceRadiusMeters > 0
  );
}

export function toGeoNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v !== null && "toString" in v) {
    const n = Number((v as { toString: () => string }).toString());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Distance from site center to point in meters; null if site has no geofence center. */
export function distanceFromSiteCenterMeters(site: Site, lat: number, lng: number): number | null {
  const centerLat = toGeoNumber(site.latitude);
  const centerLng = toGeoNumber(site.longitude);
  if (centerLat == null || centerLng == null) return null;
  return haversineMeters(centerLat, centerLng, lat, lng);
}
