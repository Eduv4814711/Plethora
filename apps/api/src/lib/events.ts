import { EventEmitter } from "node:events";

export type OperationalEventType =
  | "INCIDENT_CREATED"
  | "INCIDENT_UPDATED"
  | "INCIDENT_ATTACHMENT_ADDED"
  | "SUPERVISOR_ESCALATION"
  | "ATTENDANCE_VERIFIED"
  | "ROLL_CALL_DISPATCHED"
  | "ALERT_CREATED";

export interface OperationalEvent<T = unknown> {
  id: string;
  type: OperationalEventType;
  companyId: string;
  timestamp: string;
  payload: T;
}

class OperationalEventBus extends EventEmitter {
  constructor() {
    super();
    // Allow up to 500 concurrent SSE listeners per process without Node warning
    this.setMaxListeners(500);
  }

  broadcast<T>(type: OperationalEventType, companyId: string, payload: T): OperationalEvent<T> {
    const event: OperationalEvent<T> = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      type,
      companyId,
      timestamp: new Date().toISOString(),
      payload,
    };
    this.emit("operational_event", event);
    return event;
  }
}

export const operationalEventBus = new OperationalEventBus();
