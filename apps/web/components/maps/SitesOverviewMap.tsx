"use client";

import { useMemo } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { MapCircleSpec, MapMarkerSpec } from "./LeafletMapShell";

const LeafletMapShell = dynamic(() => import("./LeafletMapShell"), {
  ssr: false,
  loading: () => (
    <div className="h-[460px] w-full animate-pulse rounded-security-lg border border-security-navy-100 bg-security-navy-50" />
  ),
});

export interface OverviewSitePin {
  id: string;
  name: string;
  physicalAddress?: string | null;
  location?: string | null;
  siteStatus?: string | null;
  latitude?: number | string | null;
  longitude?: number | string | null;
  geofenceRadiusMeters?: number | null;
  assignedGuards?: unknown[];
}

function escapePopup(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function SitesOverviewMap({ sites }: { sites: OverviewSitePin[] }) {
  const { pinned, unpinned, markers, circles } = useMemo(() => {
    const withCoords: Array<OverviewSitePin & { lat: number; lng: number }> = [];
    const withoutCoords: OverviewSitePin[] = [];

    for (const site of sites) {
      const lat = site.latitude != null ? Number(site.latitude) : NaN;
      const lng = site.longitude != null ? Number(site.longitude) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        withCoords.push({ ...site, lat, lng });
      } else {
        withoutCoords.push(site);
      }
    }

    const markerList: MapMarkerSpec[] = withCoords.map((s) => {
      const addr = s.physicalAddress || s.location || "No address";
      const guardCount = s.assignedGuards?.length ?? 0;
      const radiusTxt = s.geofenceRadiusMeters ? `${s.geofenceRadiusMeters}m geofence` : "No radius";
      return {
        id: s.id,
        lat: s.lat,
        lng: s.lng,
        tone: "site",
        label: s.name,
        popupHtml: `<div style="font-family:sans-serif;font-size:12px;line-height:1.45;">
          <strong style="font-size:13px;color:#0f172a;">${escapePopup(s.name)}</strong><br/>
          <span style="color:#475569;">${escapePopup(addr)}</span><br/>
          <span style="color:#059669;font-weight:600;">${escapePopup(radiusTxt)}</span> · ${guardCount} guard(s)<br/>
          <a href="/sites/${encodeURIComponent(s.id)}" style="display:inline-block;margin-top:6px;color:#b45309;font-weight:600;text-decoration:underline;">Open Site &amp; Pin →</a>
        </div>`,
      };
    });

    const circleList: MapCircleSpec[] = withCoords
      .filter((s) => s.geofenceRadiusMeters && s.geofenceRadiusMeters > 0)
      .map((s) => ({
        id: `circle-${s.id}`,
        lat: s.lat,
        lng: s.lng,
        radiusMeters: s.geofenceRadiusMeters!,
      }));

    return { pinned: withCoords, unpinned: withoutCoords, markers: markerList, circles: circleList };
  }, [sites]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-security-lg border border-security-navy-100 bg-white px-4 py-3 text-xs text-security-navy-600 shadow-security-card">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-semibold text-security-navy-900">
            {pinned.length} pinned site{pinned.length === 1 ? "" : "s"}
          </span>
          {unpinned.length > 0 && (
            <span className="rounded-full bg-amber-50 px-2.5 py-0.5 font-medium text-amber-800 border border-amber-200">
              {unpinned.length} site{unpinned.length === 1 ? "" : "s"} missing GPS pin
            </span>
          )}
        </div>
        <span className="text-security-navy-500">Click any site pin to inspect geofence &amp; open details</span>
      </div>

      <LeafletMapShell
        markers={markers}
        circles={circles}
        fitToContent={pinned.length > 0}
        heightClassName="h-[460px]"
        ariaLabel="All sites overview map"
      />

      {unpinned.length > 0 && (
        <div className="rounded-security-lg border border-security-navy-100 bg-white p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-security-navy-500 mb-2">
            Sites without GPS coordinates
          </p>
          <div className="flex flex-wrap gap-2">
            {unpinned.map((site) => (
              <Link
                key={site.id}
                href={`/sites/${site.id}`}
                className="rounded-full border border-security-navy-200 bg-security-navy-50 px-3 py-1 text-xs font-medium text-security-navy-800 hover:border-security-amber-400 hover:bg-security-amber-50"
              >
                📍 Pin {site.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
