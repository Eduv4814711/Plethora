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

export const haversineDistance = haversineMeters;

export function siteHasGeofence(site: {
  latitude: unknown;
  longitude: unknown;
  geofenceRadiusMeters?: number | null;
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
export function distanceFromSiteCenterMeters(
  site: { latitude: unknown; longitude: unknown },
  lat: number,
  lng: number
): number | null {
  const centerLat = toGeoNumber(site.latitude);
  const centerLng = toGeoNumber(site.longitude);
  if (centerLat == null || centerLng == null) return null;
  return haversineMeters(centerLat, centerLng, lat, lng);
}

export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;

export type GeofenceEvaluation = {
  configured: boolean;
  withinGeofence: boolean;
  distanceMeters: number;
  radiusMeters: number;
  siteName?: string;
};

/**
 * Evaluate if a given GPS coordinate falls within a site's geofence perimeter.
 * Returns null if the site does not have geofence coordinates configured.
 */
export function evaluateSiteGeofence(
  site: {
    name?: string;
    latitude: unknown;
    longitude: unknown;
    geofenceRadiusMeters?: number | null;
  },
  lat: number,
  lng: number
): GeofenceEvaluation | null {
  if (!siteHasGeofence(site)) return null;
  const rawDist = distanceFromSiteCenterMeters(site, lat, lng);
  if (rawDist == null) return null;

  const distanceMeters = Math.round(rawDist);
  const radiusMeters = site.geofenceRadiusMeters && site.geofenceRadiusMeters > 0
    ? site.geofenceRadiusMeters
    : DEFAULT_GEOFENCE_RADIUS_METERS;

  return {
    configured: true,
    withinGeofence: distanceMeters <= radiusMeters,
    distanceMeters,
    radiusMeters,
    siteName: site.name,
  };
}

/** Format distance in meters to a human-readable string. */
export function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(1)}km`;
  }
  return `${meters}m`;
}
