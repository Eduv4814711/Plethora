"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { buildApiUrl } from "./api";

export interface OperationalEvent<T = any> {
  id: string;
  type:
    | "INCIDENT_CREATED"
    | "INCIDENT_UPDATED"
    | "INCIDENT_ATTACHMENT_ADDED"
    | "SUPERVISOR_ESCALATION"
    | "ATTENDANCE_VERIFIED"
    | "ROLL_CALL_DISPATCHED"
    | "ALERT_CREATED";
  companyId: string;
  timestamp: string;
  payload: T;
}

export interface UseOperationalEventsOptions {
  token?: string | null;
  enabled?: boolean;
  onIncidentCreated?: (event: OperationalEvent) => void;
  onIncidentUpdated?: (event: OperationalEvent) => void;
  onIncidentAttachmentAdded?: (event: OperationalEvent) => void;
  onSupervisorEscalation?: (event: OperationalEvent) => void;
  onAttendanceVerified?: (event: OperationalEvent) => void;
  onRollCallDispatched?: (event: OperationalEvent) => void;
  onAnyEvent?: (event: OperationalEvent) => void;
}

export function useOperationalEvents({
  token,
  enabled = true,
  onIncidentCreated,
  onIncidentUpdated,
  onIncidentAttachmentAdded,
  onSupervisorEscalation,
  onAttendanceVerified,
  onRollCallDispatched,
  onAnyEvent,
}: UseOperationalEventsOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [lastEvent, setLastEvent] = useState<OperationalEvent | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  // Keep latest callbacks in refs to avoid re-subscribing on each render
  const callbacksRef = useRef({
    onIncidentCreated,
    onIncidentUpdated,
    onIncidentAttachmentAdded,
    onSupervisorEscalation,
    onAttendanceVerified,
    onRollCallDispatched,
    onAnyEvent,
  });

  useEffect(() => {
    callbacksRef.current = {
      onIncidentCreated,
      onIncidentUpdated,
      onIncidentAttachmentAdded,
      onSupervisorEscalation,
      onAttendanceVerified,
      onRollCallDispatched,
      onAnyEvent,
    };
  });

  const connect = useCallback(() => {
    if (!token || !enabled || typeof window === "undefined") return;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const sseUrl = `${buildApiUrl("events/stream")}?token=${encodeURIComponent(token)}`;
    const es = new EventSource(sseUrl, { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    const handleEvent = (type: OperationalEvent["type"], e: MessageEvent) => {
      try {
        const parsed: OperationalEvent = JSON.parse(e.data);
        setLastEvent(parsed);

        const cb = callbacksRef.current;
        cb.onAnyEvent?.(parsed);

        switch (type) {
          case "INCIDENT_CREATED":
            cb.onIncidentCreated?.(parsed);
            break;
          case "INCIDENT_UPDATED":
            cb.onIncidentUpdated?.(parsed);
            break;
          case "INCIDENT_ATTACHMENT_ADDED":
            cb.onIncidentAttachmentAdded?.(parsed);
            break;
          case "SUPERVISOR_ESCALATION":
            cb.onSupervisorEscalation?.(parsed);
            break;
          case "ATTENDANCE_VERIFIED":
            cb.onAttendanceVerified?.(parsed);
            break;
          case "ROLL_CALL_DISPATCHED":
            cb.onRollCallDispatched?.(parsed);
            break;
        }
      } catch (err) {
        console.warn("[Operational Events] Failed to parse event", err);
      }
    };

    es.addEventListener("INCIDENT_CREATED", (e) => handleEvent("INCIDENT_CREATED", e));
    es.addEventListener("INCIDENT_UPDATED", (e) => handleEvent("INCIDENT_UPDATED", e));
    es.addEventListener("INCIDENT_ATTACHMENT_ADDED", (e) => handleEvent("INCIDENT_ATTACHMENT_ADDED", e));
    es.addEventListener("SUPERVISOR_ESCALATION", (e) => handleEvent("SUPERVISOR_ESCALATION", e));
    es.addEventListener("ATTENDANCE_VERIFIED", (e) => handleEvent("ATTENDANCE_VERIFIED", e));
    es.addEventListener("ROLL_CALL_DISPATCHED", (e) => handleEvent("ROLL_CALL_DISPATCHED", e));

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;

      // Reconnect with exponential backoff (min 2s, max 30s)
      const attempt = reconnectAttemptsRef.current;
      const delay = Math.min(1000 * Math.pow(1.5, attempt) + Math.random() * 1000, 30_000);
      reconnectAttemptsRef.current = attempt + 1;

      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, delay);
    };
  }, [token, enabled]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  return { isConnected, lastEvent };
}
