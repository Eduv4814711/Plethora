"use client";

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { SiteAttendanceGroup } from "@/lib/attendance-today-api";
import type { MapCircleSpec, MapLineSpec, MapMarkerSpec, MapPinTone } from "./LeafletMapShell";

const LeafletMapShell = dynamic(() => import("./LeafletMapShell"), {
  ssr: false,
  loading: () => (
    <div className="h-[440px] w-full animate-pulse rounded-security-lg border border-security-navy-100 bg-security-navy-50" />
  ),
});

function escapePopup(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

interface AttendanceClockInMapProps {
  sites: SiteAttendanceGroup[];
  focusPoint?: { lat: number; lng: number; zoom?: number; seq?: number } | null;
  heightClassName?: string;
}

export function AttendanceClockInMap({
  sites,
  focusPoint = null,
  heightClassName = "h-[460px]",
}: AttendanceClockInMapProps) {
  const { markers, circles, lines, stats } = useMemo(() => {
    const markerList: MapMarkerSpec[] = [];
    const circleList: MapCircleSpec[] = [];
    const lineList: MapLineSpec[] = [];

    let clockInPins = 0;
    let verifiedCount = 0;
    let outsideCount = 0;
    let missingGpsCount = 0;

    for (const site of sites) {
      const siteHasCoords = site.latitude != null && site.longitude != null;
      if (siteHasCoords) {
        markerList.push({
          id: `site-${site.siteId}`,
          lat: site.latitude!,
          lng: site.longitude!,
          tone: "site",
          label: site.siteName,
          popupHtml: `<div style="font-family:sans-serif;font-size:12px;line-height:1.45;">
            <strong style="color:#0f172a;">${escapePopup(site.siteName)}</strong><br/>
            <span>Scheduled: ${site.totalScheduled} · Clocked In: ${site.totalClockedIn}</span><br/>
            ${site.geofenceRadiusMeters ? `<span style="color:#b45309;">Geofence radius: ${site.geofenceRadiusMeters}m</span>` : "<span>No geofence configured</span>"}
          </div>`,
        });

        if (site.geofenceRadiusMeters && site.geofenceRadiusMeters > 0) {
          circleList.push({
            id: `circle-${site.siteId}`,
            lat: site.latitude!,
            lng: site.longitude!,
            radiusMeters: site.geofenceRadiusMeters,
          });
        }
      }

      for (const guard of site.guards) {
        if (guard.clockInLat != null && guard.clockInLng != null) {
          clockInPins += 1;
          const isRejected =
            guard.validationStatus === "REJECTED_GEOFENCE" ||
            (siteHasCoords && site.geofenceRadiusMeters != null && !guard.withinGeofence);

          let tone: MapPinTone = "warning";
          let statusLine = "No site geofence configured";

          if (guard.withinGeofence) {
            tone = "verified";
            verifiedCount += 1;
            statusLine =
              guard.distanceMeters != null
                ? `Verified inside geofence (${guard.distanceMeters}m)`
                : "Verified inside geofence";
          } else if (isRejected) {
            tone = "rejected";
            outsideCount += 1;
            statusLine =
              guard.distanceMeters != null
                ? `Outside geofence (${guard.distanceMeters}m from site)`
                : "Outside geofence";
          }

          if (isRejected && siteHasCoords) {
            lineList.push({
              id: `line-${guard.shiftId}`,
              from: [guard.clockInLat, guard.clockInLng],
              to: [site.latitude!, site.longitude!],
              color: "#dc2626",
              dashed: true,
            });
          }

          markerList.push({
            id: `in-${guard.shiftId}`,
            lat: guard.clockInLat,
            lng: guard.clockInLng,
            tone,
            label: guard.guardName.split(" ")[0],
            popupHtml: `<div style="font-family:sans-serif;font-size:12px;line-height:1.45;">
              <strong style="color:#0f172a;">${escapePopup(guard.guardName)}</strong><br/>
              <span style="color:#475569;">${escapePopup(site.siteName)} · In: ${escapePopup(guard.clockInTime ?? "—")}${guard.clockOutTime ? ` · Out: ${escapePopup(guard.clockOutTime)}` : ""}</span><br/>
              <span style="font-weight:600;color:${tone === "verified" ? "#059669" : tone === "rejected" ? "#dc2626" : "#b45309"};">${escapePopup(statusLine)}</span><br/>
              <span style="color:#64748b;font-size:11px;">GPS: ${guard.clockInLat.toFixed(5)}, ${guard.clockInLng.toFixed(5)} (${escapePopup(guard.captureMethod)})</span>
            </div>`,
          });

          if (guard.clockOutLat != null && guard.clockOutLng != null) {
            markerList.push({
              id: `out-${guard.shiftId}`,
              lat: guard.clockOutLat,
              lng: guard.clockOutLng,
              tone: "clockout",
              popupHtml: `<div style="font-family:sans-serif;font-size:12px;">
                <strong>${escapePopup(guard.guardName)} (Clock-Out)</strong><br/>
                Time: ${escapePopup(guard.clockOutTime ?? "—")}<br/>
                GPS: ${guard.clockOutLat.toFixed(5)}, ${guard.clockOutLng.toFixed(5)}
              </div>`,
            });
          }
        } else if (guard.clockInTime) {
          missingGpsCount += 1;
        }
      }
    }

    return {
      markers: markerList,
      circles: circleList,
      lines: lineList,
      stats: { clockInPins, verifiedCount, outsideCount, missingGpsCount },
    };
  }, [sites]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-security-lg border border-security-navy-100 bg-white px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 font-medium text-security-navy-800">
            <span className="h-2.5 w-2.5 rounded-full bg-security-navy-900 ring-2 ring-security-amber-400" />
            Site Geofence
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />
            Verified ({stats.verifiedCount})
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-red-700">
            <span className="h-2.5 w-2.5 rounded-full bg-red-600" />
            Outside Geofence ({stats.outsideCount})
          </span>
          <span className="inline-flex items-center gap-1.5 font-medium text-amber-700">
            <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
            Unconfigured Site
          </span>
        </div>
        <span className="text-security-navy-500">
          {stats.clockInPins} GPS clock-in pin{stats.clockInPins === 1 ? "" : "s"}
          {stats.missingGpsCount > 0 ? ` · ${stats.missingGpsCount} without GPS` : ""}
        </span>
      </div>

      <LeafletMapShell
        markers={markers}
        circles={circles}
        lines={lines}
        fitToContent={markers.length > 0 && !focusPoint}
        focusPoint={focusPoint}
        heightClassName={heightClassName}
        ariaLabel="Live guard clock-in locations map"
      />
    </div>
  );
}
