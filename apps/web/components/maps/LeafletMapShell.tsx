"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPinTone = "site" | "verified" | "rejected" | "warning" | "clockout";

export interface MapMarkerSpec {
  id: string;
  lat: number;
  lng: number;
  tone: MapPinTone;
  label?: string;
  popupHtml?: string;
  draggable?: boolean;
}

export interface MapCircleSpec {
  id: string;
  lat: number;
  lng: number;
  radiusMeters: number;
  color?: string;
  fillColor?: string;
}

export interface MapLineSpec {
  id: string;
  from: [number, number];
  to: [number, number];
  color?: string;
  dashed?: boolean;
}

export interface LeafletMapShellProps {
  center?: [number, number];
  zoom?: number;
  markers?: MapMarkerSpec[];
  circles?: MapCircleSpec[];
  lines?: MapLineSpec[];
  fitToContent?: boolean;
  focusPoint?: { lat: number; lng: number; zoom?: number; seq?: number } | null;
  interactivePick?: boolean;
  onPickLocation?: (lat: number, lng: number) => void;
  heightClassName?: string;
  ariaLabel?: string;
}

const DEFAULT_SA_CENTER: [number, number] = [-26.2041, 28.0473]; // Johannesburg

function escapeHtml(raw: string): string {
  return raw
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function createPinIcon(tone: MapPinTone, label?: string): L.DivIcon {
  const palette: Record<MapPinTone, { fill: string; stroke: string }> = {
    site: { fill: "#0f172a", stroke: "#f59e0b" },
    verified: { fill: "#059669", stroke: "#ffffff" },
    rejected: { fill: "#dc2626", stroke: "#ffffff" },
    warning: { fill: "#d97706", stroke: "#ffffff" },
    clockout: { fill: "#2563eb", stroke: "#ffffff" },
  };
  const colors = palette[tone] ?? palette.site;
  const safeLabel = label ? escapeHtml(label) : "";
  const badgeHtml = safeLabel
    ? `<span style="margin-top:2px;white-space:nowrap;border-radius:999px;background:rgba(15,23,42,0.88);color:#fff;padding:1px 6px;font-size:10px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.25);">${safeLabel}</span>`
    : "";

  return L.divIcon({
    className: "plethora-map-pin",
    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);">
      <svg width="26" height="32" viewBox="0 0 26 32" fill="none" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));">
        <path d="M13 1C6.373 1 1 6.373 1 13c0 8.5 12 18 12 18s12-9.5 12-18C25 6.373 19.627 1 13 1z" fill="${colors.fill}" stroke="${colors.stroke}" stroke-width="2"/>
        <circle cx="13" cy="13" r="4.5" fill="${colors.stroke}"/>
      </svg>
      ${badgeHtml}
    </div>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -28],
  });
}

export default function LeafletMapShell({
  center = DEFAULT_SA_CENTER,
  zoom = 12,
  markers = [],
  circles = [],
  lines = [],
  fitToContent = false,
  focusPoint = null,
  interactivePick = false,
  onPickLocation,
  heightClassName = "h-[360px]",
  ariaLabel = "Interactive map",
}: LeafletMapShellProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const onPickRef = useRef(onPickLocation);
  const interactivePickRef = useRef(interactivePick);

  onPickRef.current = onPickLocation;
  interactivePickRef.current = interactivePick;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center,
      zoom,
      zoomControl: true,
      scrollWheelZoom: true,
    });

    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    map.on("click", (e: L.LeafletMouseEvent) => {
      if (interactivePickRef.current && onPickRef.current) {
        onPickRef.current(
          Number(e.latlng.lat.toFixed(7)),
          Number(e.latlng.lng.toFixed(7))
        );
      }
    });

    mapRef.current = map;
    layerGroupRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layerGroupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const group = layerGroupRef.current;
    if (!map || !group) return;

    group.clearLayers();

    const boundsPoints: L.LatLngExpression[] = [];

    for (const circle of circles) {
      L.circle([circle.lat, circle.lng], {
        radius: circle.radiusMeters,
        color: circle.color ?? "#d97706",
        fillColor: circle.fillColor ?? "#f59e0b",
        fillOpacity: 0.14,
        weight: 2,
      }).addTo(group);
      boundsPoints.push([circle.lat, circle.lng]);
    }

    for (const line of lines) {
      L.polyline([line.from, line.to], {
        color: line.color ?? "#dc2626",
        weight: 2,
        dashArray: line.dashed === false ? undefined : "6 6",
        opacity: 0.85,
      }).addTo(group);
    }

    for (const markerSpec of markers) {
      const marker = L.marker([markerSpec.lat, markerSpec.lng], {
        icon: createPinIcon(markerSpec.tone, markerSpec.label),
        draggable: Boolean(markerSpec.draggable),
      });
      if (markerSpec.popupHtml) {
        marker.bindPopup(markerSpec.popupHtml, { maxWidth: 280 });
      }
      if (markerSpec.draggable && onPickRef.current) {
        marker.on("dragend", () => {
          const pos = marker.getLatLng();
          onPickRef.current?.(Number(pos.lat.toFixed(7)), Number(pos.lng.toFixed(7)));
        });
      }
      marker.addTo(group);
      boundsPoints.push([markerSpec.lat, markerSpec.lng]);
    }

    if (fitToContent && boundsPoints.length > 0) {
      if (boundsPoints.length === 1) {
        map.setView(boundsPoints[0]!, Math.max(map.getZoom(), 15));
      } else {
        map.fitBounds(L.latLngBounds(boundsPoints), { padding: [40, 40], maxZoom: 16 });
      }
    }
  }, [markers, circles, lines, fitToContent]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusPoint) return;
    map.setView([focusPoint.lat, focusPoint.lng], focusPoint.zoom ?? 16, { animate: true });
  }, [focusPoint]);

  return (
    <div
      ref={containerRef}
      aria-label={ariaLabel}
      className={`w-full overflow-hidden rounded-security-lg border border-security-navy-200 bg-security-navy-50 ${heightClassName} ${
        interactivePick ? "cursor-crosshair" : ""
      }`}
    />
  );
}
