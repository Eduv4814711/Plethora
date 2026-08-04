"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth-context";
import { listNotifications, markNotificationRead, markAllNotificationsRead } from "@/lib/msr-api";

export function NotificationBell() {
  const { token } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; title: string; message: string; linkUrl?: string | null; createdAt: string }[]>([]);

  useEffect(() => {
    if (!token) return;
    const load = () => {
      listNotifications(token, true)
        .then((r) => setUnreadCount(r.unreadCount))
        .catch(() => setUnreadCount(0));
    };
    load();
    const interval = setInterval(load, 60_000);
    return () => clearInterval(interval);
  }, [token]);

  useEffect(() => {
    if (!token || !open) return;
    listNotifications(token, false)
      .then((r) => setItems(r.items.slice(0, 8)))
      .catch(() => setItems([]));
  }, [token, open]);

  const handleOpenNotification = async (id: string, linkUrl?: string | null) => {
    if (token) {
      try {
        await markNotificationRead(token, id);
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {
        /* ignore */
      }
    }
    setOpen(false);
    if (linkUrl) return;
  };

  if (!token) return null;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-11 w-11 items-center justify-center text-white/85 hover:text-white hover:bg-white/10 rounded-security transition-colors touch-manipulation"
        aria-label={unreadCount > 0 ? `${unreadCount} unread notifications` : "Notifications"}
        aria-expanded={open}
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-security-amber-500 px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full mt-2 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-security-lg border border-neutral-200 bg-white shadow-security-elevated py-2">
            <div className="flex items-center justify-between px-4 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Notifications</p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="text-xs font-semibold text-security-navy-800 hover:underline"
                  onClick={() => token && markAllNotificationsRead(token).then(() => setUnreadCount(0))}
                >
                  Mark all read
                </button>
              )}
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-neutral-600 text-center">No notifications yet</p>
            ) : (
              <ul className="max-h-72 overflow-y-auto">
                {items.map((n) => (
                  <li key={n.id} className="border-t border-neutral-100 first:border-0">
                    {n.linkUrl ? (
                      <Link
                        href={n.linkUrl}
                        onClick={() => handleOpenNotification(n.id, n.linkUrl)}
                        className="block px-4 py-3 hover:bg-neutral-50"
                      >
                        <p className="text-sm font-medium text-neutral-900">{n.title}</p>
                        <p className="text-xs text-neutral-600 mt-0.5 line-clamp-2">{n.message}</p>
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleOpenNotification(n.id)}
                        className="block w-full px-4 py-3 text-left hover:bg-neutral-50"
                      >
                        <p className="text-sm font-medium text-neutral-900">{n.title}</p>
                        <p className="text-xs text-neutral-600 mt-0.5 line-clamp-2">{n.message}</p>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
