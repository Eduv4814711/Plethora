"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Which modules a user keeps on the launcher at `/`, and in what order.
 *
 * Two independent preferences live here:
 *
 * - "shown": the modules on the launcher, capped at DASHBOARD_TILE_LIMIT so the
 *   grid stays a tidy 4x4 block that fits one screen. Everything the user can
 *   reach stays available from the "Add module" picker and from search, so
 *   hiding a tile never removes access.
 * - "pinned": up to PINNED_LIMIT favourites, hoisted to the front of the grid
 *   and accented. Pinning is a priority marker, not a visibility one.
 *
 * Both are per-browser display preferences, so they live in localStorage keyed
 * by user id rather than on the company record.
 */

export const DASHBOARD_TILE_LIMIT = 16;
export const PINNED_LIMIT = 3;

function shownKey(userId: string) {
  return `plethora:dashboard-modules:${userId}`;
}

function pinnedKey(userId: string) {
  return `plethora:dashboard-pins:${userId}`;
}

function readList(key: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((href): href is string => typeof href === "string");
  } catch {
    // Private-mode or corrupt value: fall back to the default selection.
    return null;
  }
}

function writeList(key: string, hrefs: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(hrefs));
  } catch {
    // Preference is cosmetic; a failed write just means it does not persist.
  }
}

export interface DashboardModuleSelection {
  /** Modules on the launcher, pinned ones first, capped at DASHBOARD_TILE_LIMIT. */
  shown: string[];
  /** Accessible modules the user has taken off the launcher. */
  hidden: string[];
  /** Favourites, in pin order, capped at PINNED_LIMIT. */
  pinned: string[];
  /** True once stored preferences have been read (server render shows defaults). */
  ready: boolean;
  atLimit: boolean;
  pinsAtLimit: boolean;
  add: (href: string) => void;
  remove: (href: string) => void;
  togglePin: (href: string) => void;
}

/**
 * @param userId    the signed-in user; preferences are per user, per browser.
 * @param available every module href the user may open, in catalog order. The
 *                  first DASHBOARD_TILE_LIMIT of these are the default tiles.
 */
export function useDashboardModules(userId: string, available: string[]): DashboardModuleSelection {
  const availableKey = available.join(",");
  const [storedShown, setStoredShown] = useState<string[] | null>(null);
  const [storedPins, setStoredPins] = useState<string[] | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setStoredShown(readList(shownKey(userId)));
    setStoredPins(readList(pinnedKey(userId)));
    setReady(true);
  }, [userId]);

  // Order-independent membership: what is on the launcher at all.
  const members = useMemo(() => {
    const allowed = availableKey ? availableKey.split(",") : [];
    const allowedSet = new Set(allowed);
    const base = storedShown ?? allowed.slice(0, DASHBOARD_TILE_LIMIT);
    // Drop anything the user can no longer access, and de-duplicate, so a
    // revoked grant or a renamed route cannot strand a dead tile.
    const next: string[] = [];
    for (const href of base) {
      if (next.length >= DASHBOARD_TILE_LIMIT) break;
      if (allowedSet.has(href) && !next.includes(href)) next.push(href);
    }
    return next;
  }, [storedShown, availableKey]);

  // A pin only means something for a tile that is actually on the launcher.
  const pinned = useMemo(() => {
    const memberSet = new Set(members);
    const next: string[] = [];
    for (const href of storedPins ?? []) {
      if (next.length >= PINNED_LIMIT) break;
      if (memberSet.has(href) && !next.includes(href)) next.push(href);
    }
    return next;
  }, [storedPins, members]);

  const shown = useMemo(() => {
    const pinnedSet = new Set(pinned);
    return [...pinned, ...members.filter((href) => !pinnedSet.has(href))];
  }, [pinned, members]);

  const hidden = useMemo(() => {
    const memberSet = new Set(members);
    const allowed = availableKey ? availableKey.split(",") : [];
    return allowed.filter((href) => !memberSet.has(href));
  }, [members, availableKey]);

  const persistShown = useCallback(
    (next: string[]) => {
      setStoredShown(next);
      writeList(shownKey(userId), next);
    },
    [userId]
  );

  const persistPins = useCallback(
    (next: string[]) => {
      setStoredPins(next);
      writeList(pinnedKey(userId), next);
    },
    [userId]
  );

  const add = useCallback(
    (href: string) => {
      if (members.includes(href) || members.length >= DASHBOARD_TILE_LIMIT) return;
      persistShown([...members, href]);
    },
    [members, persistShown]
  );

  const remove = useCallback(
    (href: string) => {
      persistShown(members.filter((item) => item !== href));
      // A tile off the launcher cannot stay pinned, or re-adding it later would
      // silently restore a pin the user cannot see.
      if (pinned.includes(href)) persistPins(pinned.filter((item) => item !== href));
    },
    [members, pinned, persistShown, persistPins]
  );

  const togglePin = useCallback(
    (href: string) => {
      if (pinned.includes(href)) {
        persistPins(pinned.filter((item) => item !== href));
        return;
      }
      if (pinned.length >= PINNED_LIMIT || !members.includes(href)) return;
      persistPins([...pinned, href]);
    },
    [pinned, members, persistPins]
  );

  return {
    shown,
    hidden,
    pinned,
    ready,
    atLimit: members.length >= DASHBOARD_TILE_LIMIT,
    pinsAtLimit: pinned.length >= PINNED_LIMIT,
    add,
    remove,
    togglePin,
  };
}
