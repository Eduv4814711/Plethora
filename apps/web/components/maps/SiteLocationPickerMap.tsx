"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { MapCircleSpec, MapMarkerSpec } from "./LeafletMapShell";

const LeafletMapShell = dynamic(() => import("./LeafletMapShell"), {
  ssr: false,
  loading: () => (
    <div className="h-[320px] w-full animate-pulse rounded-security-lg border border-security-navy-100 bg-security-navy-50" />
  ),
});

interface SiteLocationPickerMapProps {
  latitude: string;
  longitude: string;
  radiusMeters: string;
  siteName?: string;
  disabled?: boolean;
  onChangeLocation: (lat: string, lng: string) => void;
  heightClassName?: string;
}

export function SiteLocationPickerMap({
  latitude,
  longitude,
  radiusMeters,
  siteName,
  disabled = false,
  onChangeLocation,
  heightClassName = "h-[320px]",
}: SiteLocationPickerMapProps) {
  const [addressQuery, setAddressQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [focusSeq, setFocusSeq] = useState(0);

  const parsedLat = Number(latitude);
  const parsedLng = Number(longitude);
  const parsedRadius = Number(radiusMeters);
  const hasCoords =
    latitude.trim() !== "" &&
    longitude.trim() !== "" &&
    Number.isFinite(parsedLat) &&
    Number.isFinite(parsedLng) &&
    parsedLat >= -90 &&
    parsedLat <= 90 &&
    parsedLng >= -180 &&
    parsedLng <= 180;

  const markers: MapMarkerSpec[] = useMemo(() => {
    if (!hasCoords) return [];
    return [
      {
        id: "site-pin",
        lat: parsedLat,
        lng: parsedLng,
        tone: "site",
        label: siteName || "Site Center",
        draggable: !disabled,
      },
    ];
  }, [hasCoords, parsedLat, parsedLng, siteName, disabled]);

  const circles: MapCircleSpec[] = useMemo(() => {
    if (!hasCoords || !Number.isFinite(parsedRadius) || parsedRadius <= 0) return [];
    return [
      {
        id: "site-geofence",
        lat: parsedLat,
        lng: parsedLng,
        radiusMeters: Math.min(parsedRadius, 100_000),
      },
    ];
  }, [hasCoords, parsedLat, parsedLng, parsedRadius]);

  const focusPoint = useMemo(() => {
    if (!hasCoords) return null;
    return { lat: parsedLat, lng: parsedLng, zoom: 16, seq: focusSeq };
  }, [hasCoords, parsedLat, parsedLng, focusSeq]);

  const handleAddressSearch = async () => {
    const q = addressQuery.trim();
    if (!q || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=za&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error("Address lookup unavailable");
      const results = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (!results.length) {
        setSearchError("No South African location matched that search. Try a street or suburb name.");
        return;
      }
      const lat = Number(results[0]!.lat).toFixed(7);
      const lng = Number(results[0]!.lon).toFixed(7);
      onChangeLocation(lat, lng);
      setFocusSeq((s) => s + 1);
    } catch {
      setSearchError("Could not search OpenStreetMap right now. You can click directly on the map.");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2.5">
      {!disabled && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex flex-1 items-center gap-2">
            <input
              type="text"
              value={addressQuery}
              onChange={(e) => setAddressQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleAddressSearch();
                }
              }}
              placeholder="Search South African address or suburb (e.g. Sandton City)…"
              className="input-modern flex-1 text-xs"
            />
            <button
              type="button"
              onClick={() => void handleAddressSearch()}
              disabled={searching || !addressQuery.trim()}
              className="btn-secondary shrink-0 px-3 py-2 text-xs"
            >
              {searching ? "Finding…" : "Find"}
            </button>
          </div>
          <span className="text-[11px] text-security-navy-500">
            Click map or drag pin to set coordinates
          </span>
        </div>
      )}

      {searchError && (
        <p className="text-xs text-amber-700">{searchError}</p>
      )}

      <LeafletMapShell
        center={hasCoords ? [parsedLat, parsedLng] : [-26.2041, 28.0473]}
        zoom={hasCoords ? 16 : 11}
        markers={markers}
        circles={circles}
        focusPoint={focusPoint}
        interactivePick={!disabled}
        onPickLocation={(lat, lng) => {
          onChangeLocation(lat.toFixed(7), lng.toFixed(7));
        }}
        heightClassName={heightClassName}
        ariaLabel="Site geofence location picker map"
      />
    </div>
  );
}
