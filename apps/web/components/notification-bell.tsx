"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type AppNotification,
} from "@/lib/msr-api";
import { useOperationalEvents } from "@/lib/use-operational-events";

function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffSec = Math.round((Date.now() - date.getTime()) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function NotificationBell() {
  const { token } = useAuth();
  const popoverId = useId();
  const popoverRef = useRef<HTMLDivElement>(null);

  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const refreshUnreadCount = useCallback(() => {
    if (!token) return;
    listNotifications(token, true)
      .then((r) => setUnreadCount(r.unreadCount))
      .catch(() => {
        /* keep previous badge count on transient polling failure */
      });
  }, [token]);

  const loadNotifications = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    try {
      const r = await listNotifications(token, false);
      setItems(r.items.slice(0, 8));
      setUnreadCount(r.unreadCount);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load notifications");
    } finally {
      setLoading(false);
    }
  }, [token]);

  useOperationalEvents({
    token,
    onAnyEvent: () => {
      refreshUnreadCount();
      if (open) {
        void loadNotifications();
      }
    },
  });

  useEffect(() => {
    if (!token) return;
    refreshUnreadCount();
    const interval = setInterval(refreshUnreadCount, 60_000);
    return () => clearInterval(interval);
  }, [token, refreshUnreadCount]);

  useEffect(() => {
    if (!token || !open) return;
    void loadNotifications();
  }, [token, open, loadNotifications]);

  const handleOpenNotification = async (notification: AppNotification) => {
    popoverRef.current?.hidePopover?.();

    if (token && !notification.readAt) {
      const nowIso = new Date().toISOString();
      setItems((prev) =>
        prev.map((item) =>
          item.id === notification.id ? { ...item, readAt: item.readAt ?? nowIso } : item
        )
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await markNotificationRead(token, notification.id);
      } catch {
        refreshUnreadCount();
      }
    }
  };

  const handleMarkAllRead = async () => {
    if (!token || markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    setLoadError(null);
    try {
      await markAllNotificationsRead(token);
      const nowIso = new Date().toISOString();
      setUnreadCount(0);
      setItems((prev) =>
        prev.map((item) => (item.readAt ? item : { ...item, readAt: nowIso }))
      );
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to mark all read");
    } finally {
      setMarkingAll(false);
    }
  };

  if (!token) return null;

  return (
    <div className="relative">
      <button
        type="button"
        popoverTarget={popoverId}
        className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-security text-security-navy-600 transition-colors hover:bg-security-navy-50 hover:text-security-navy-900 touch-manipulation"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
        aria-controls={popoverId}
      >
        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-security-amber-500 px-1 font-mono text-[10px] font-semibold leading-none text-security-navy-950 ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <div
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        onToggle={(e) => {
          const nextState = (e.nativeEvent as ToggleEvent).newState;
          setOpen(nextState === "open");
        }}
        className="header-popover w-80 max-w-[calc(100vw-2rem)] rounded-security-lg border border-security-navy-100 bg-white py-2 text-left text-security-navy-900 shadow-security-elevated"
      >
        <div className="flex items-center justify-between border-b border-security-navy-100 px-4 py-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-security-navy-900">Notifications</p>
            {unreadCount > 0 && (
              <span className="rounded-full bg-security-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-security-amber-900">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              disabled={markingAll}
              className="text-xs font-semibold text-security-navy-800 hover:underline disabled:opacity-50"
              onClick={() => void handleMarkAllRead()}
            >
              {markingAll ? "Marking…" : "Mark all read"}
            </button>
          )}
        </div>

        {loadError && (
          <div className="flex items-center justify-between gap-2 border-b border-red-100 bg-red-50 px-4 py-2 text-xs text-red-700" role="alert">
            <span className="truncate">{loadError}</span>
            <button
              type="button"
              onClick={() => void loadNotifications()}
              className="shrink-0 font-semibold underline"
            >
              Retry
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <div className="space-y-2 px-4 py-4">
            <div className="h-10 animate-pulse rounded-security bg-security-navy-50" />
            <div className="h-10 animate-pulse rounded-security bg-security-navy-50" />
          </div>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-security-navy-500">
            No notifications yet
          </p>
        ) : (
          <ul className="max-h-72 overflow-y-auto divide-y divide-security-navy-100">
            {items.map((n) => {
              const isUnread = !n.readAt;
              const content = (
                <div className="flex items-start gap-2.5">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      isUnread ? "bg-security-amber-500" : "bg-transparent"
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p
                        className={`truncate text-sm ${
                          isUnread
                            ? "font-semibold text-security-navy-950"
                            : "font-medium text-security-navy-700"
                        }`}
                      >
                        {n.title}
                      </p>
                      <span className="shrink-0 font-mono text-[10px] text-security-navy-400">
                        {formatRelativeTime(n.createdAt)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-security-navy-600">
                      {n.message}
                    </p>
                  </div>
                </div>
              );

              return (
                <li
                  key={n.id}
                  className={isUnread ? "bg-security-amber-50/35" : undefined}
                >
                  {n.linkUrl ? (
                    <Link
                      href={n.linkUrl}
                      onClick={() => void handleOpenNotification(n)}
                      className="block px-4 py-3 no-underline transition-colors hover:bg-security-navy-50"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleOpenNotification(n)}
                      className="block w-full px-4 py-3 text-left transition-colors hover:bg-security-navy-50"
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
