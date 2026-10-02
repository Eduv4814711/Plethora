/**
 * WhatsApp In-Memory Conversation State Machine and Session Manager
 * Handles multi-step conversation flows, user state, step data, and timeouts.
 */

export type ConversationState =
  | "IDLE"
  // Shift Check-In / Clock In
  | "CLOCK_IN_SELECT_SHIFT"
  | "CLOCK_IN_AWAITING_LOCATION"
  | "CLOCK_OUT_AWAITING_LOCATION"
  // Incident Reporting Multi-Step Micro-Prompts
  | "INCIDENT_SELECT_TYPE"
  | "INCIDENT_SELECT_SITE"
  | "INCIDENT_ENTER_DETAILS"
  | "INCIDENT_AWAITING_PHOTO"
  // Leave Application Multi-Step Micro-Prompts
  | "LEAVE_SELECT_TYPE"
  | "LEAVE_ENTER_START_DATE"
  | "LEAVE_ENTER_END_DATE"
  | "LEAVE_ENTER_REASON"
  | "LEAVE_CONFIRM"
  // Supervisor Assistance / Human Handoff
  | "AWAITING_SUPERVISOR_CONFIRM";

export interface ConversationSession {
  waFrom: string;
  employeeId: string;
  companyId: string;
  state: ConversationState;
  data: Record<string, any>;
  unrecognizedCount: number;
  lastActivity: Date;
  expiresAt: Date;
}

export const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes of inactivity

class SessionStore {
  private sessions = new Map<string, ConversationSession>();

  private calculateExpiry(): Date {
    return new Date(Date.now() + SESSION_TTL_MS);
  }

  getSession(waFrom: string): ConversationSession | null {
    const session = this.sessions.get(waFrom);
    if (!session) return null;

    if (session.expiresAt.getTime() < Date.now()) {
      this.sessions.delete(waFrom);
      return null;
    }

    // Refresh activity & expiry on active access
    session.lastActivity = new Date();
    session.expiresAt = this.calculateExpiry();
    return session;
  }

  getOrCreateSession(waFrom: string, employeeId: string, companyId: string): ConversationSession {
    const existing = this.getSession(waFrom);
    if (existing) {
      if (existing.employeeId !== employeeId || existing.companyId !== companyId) {
        existing.employeeId = employeeId;
        existing.companyId = companyId;
        existing.state = "IDLE";
        existing.data = {};
        existing.unrecognizedCount = 0;
      }
      return existing;
    }

    const newSession: ConversationSession = {
      waFrom,
      employeeId,
      companyId,
      state: "IDLE",
      data: {},
      unrecognizedCount: 0,
      lastActivity: new Date(),
      expiresAt: this.calculateExpiry(),
    };
    this.sessions.set(waFrom, newSession);
    return newSession;
  }

  setSessionState(
    waFrom: string,
    state: ConversationState,
    dataUpdates?: Record<string, any>,
    employeeId?: string,
    companyId?: string
  ): ConversationSession {
    let session = this.sessions.get(waFrom);
    if (!session) {
      session = {
        waFrom,
        employeeId: employeeId ?? dataUpdates?.employeeId ?? "",
        companyId: companyId ?? dataUpdates?.companyId ?? "",
        state,
        data: dataUpdates ?? {},
        unrecognizedCount: 0,
        lastActivity: new Date(),
        expiresAt: this.calculateExpiry(),
      };
      this.sessions.set(waFrom, session);
      return session;
    }

    session.state = state;
    if (dataUpdates) {
      session.data = { ...session.data, ...dataUpdates };
    }
    if (employeeId) session.employeeId = employeeId;
    if (companyId) session.companyId = companyId;
    session.lastActivity = new Date();
    session.expiresAt = this.calculateExpiry();
    return session;
  }

  updateSessionData(waFrom: string, updates: Record<string, any>): ConversationSession {
    let session = this.sessions.get(waFrom);
    if (!session) {
      session = {
        waFrom,
        employeeId: updates.employeeId ?? "",
        companyId: updates.companyId ?? "",
        state: "IDLE",
        data: { ...updates },
        unrecognizedCount: 0,
        lastActivity: new Date(),
        expiresAt: this.calculateExpiry(),
      };
      this.sessions.set(waFrom, session);
      return session;
    }

    session.data = { ...session.data, ...updates };
    session.lastActivity = new Date();
    session.expiresAt = this.calculateExpiry();
    return session;
  }

  updateSession(waFrom: string, updates: Record<string, any>): ConversationSession {
    return this.updateSessionData(waFrom, updates);
  }

  clearSession(waFrom: string): void {
    const session = this.sessions.get(waFrom);
    if (session) {
      session.state = "IDLE";
      session.data = {};
      session.unrecognizedCount = 0;
      session.lastActivity = new Date();
      session.expiresAt = this.calculateExpiry();
    } else {
      this.sessions.set(waFrom, {
        waFrom,
        employeeId: "",
        companyId: "",
        state: "IDLE",
        data: {},
        unrecognizedCount: 0,
        lastActivity: new Date(),
        expiresAt: this.calculateExpiry(),
      });
    }
  }

  deleteSession(waFrom: string): void {
    this.sessions.delete(waFrom);
  }

  incrementUnrecognized(waFrom: string): number {
    let session = this.sessions.get(waFrom);
    if (!session) {
      session = {
        waFrom,
        employeeId: "",
        companyId: "",
        state: "IDLE",
        data: {},
        unrecognizedCount: 1,
        lastActivity: new Date(),
        expiresAt: this.calculateExpiry(),
      };
      this.sessions.set(waFrom, session);
      return 1;
    }
    session.unrecognizedCount = (session.unrecognizedCount || 0) + 1;
    return session.unrecognizedCount;
  }

  resetUnrecognized(waFrom: string): void {
    const session = this.sessions.get(waFrom);
    if (session) {
      session.unrecognizedCount = 0;
    }
  }

  cleanExpiredSessions(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() < now) {
        this.sessions.delete(key);
      }
    }
  }

  resetAllSessions(): void {
    this.sessions.clear();
  }
}

export const sessionManager = new SessionStore();
