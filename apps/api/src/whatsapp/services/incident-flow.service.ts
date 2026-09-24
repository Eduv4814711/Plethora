import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { upsertAlert } from "../../modules/alerts/alerts.service.js";
import { nextIncidentNumber, severityToAlertPriority } from "../../modules/incidents/incidents.service.js";
import { sessionManager, type ConversationSession } from "./session.service.js";
import type { IncidentSeverity, IncidentType } from "@prisma/client";

export interface IncidentFlowResult {
  reply: string;
  buttons?: { id: string; title: string }[];
  sendInteractiveList?: {
    body: string;
    buttonText: string;
    rows: { id: string; title: string; description?: string }[];
  };
}

type CategoryOption = {
  type: IncidentType;
  severity: IncidentSeverity;
  label: string;
  description: string;
};

export const INCIDENT_CATEGORIES: Record<string, CategoryOption> = {
  "1": {
    type: "SITE_EMERGENCY",
    severity: "CRITICAL",
    label: "Site Emergency / Safety Risk",
    description: "Immediate hazard, medical emergency, or fire",
  },
  "2": {
    type: "BREAK_IN",
    severity: "HIGH",
    label: "Break-in / Theft / Trespassing",
    description: "Unauthorized intrusion, burglary, or stolen goods",
  },
  "3": {
    type: "GUARD_MISCONDUCT",
    severity: "MEDIUM",
    label: "Guard Misconduct / Absenteeism",
    description: "Post abandonment, sleeping on duty, dispute",
  },
  "4": {
    type: "EQUIPMENT_DAMAGE",
    severity: "HIGH",
    label: "Equipment Damage / Infrastructure",
    description: "Gate failure, power outage, fence damage",
  },
  "5": {
    type: "CLIENT_COMPLAINT",
    severity: "MEDIUM",
    label: "Client Complaint / Other",
    description: "Client service query, noise, or general incident",
  },
};

export async function startIncidentFlow(
  from: string,
  employeeId: string,
  companyId: string
): Promise<IncidentFlowResult> {
  sessionManager.setSessionState(from, "INCIDENT_SELECT_TYPE", {
    employeeId,
    companyId,
    startedAt: new Date().toISOString(),
  });

  return {
    reply:
      `🚨 *Report an Incident* (Step 1/3)\n\n` +
      `Select the incident category by replying with a number:\n\n` +
      `1️⃣ *Site Emergency / Safety Risk*\n` +
      `2️⃣ *Break-in / Theft / Trespassing*\n` +
      `3️⃣ *Guard Misconduct / Absenteeism*\n` +
      `4️⃣ *Equipment Damage / Infrastructure*\n` +
      `5️⃣ *Client Complaint / Other*\n\n` +
      `Reply with *1–5* or type *cancel* to abort.`,
    buttons: [
      { id: "inc_cat_1", title: "1. Emergency" },
      { id: "inc_cat_2", title: "2. Break-in/Theft" },
      { id: "inc_cat_5", title: "5. Other" },
    ],
  };
}

export async function handleIncidentSelectType(
  from: string,
  text: string,
  session: ConversationSession
): Promise<IncidentFlowResult> {
  const clean = text.trim().toLowerCase().replace(/^inc_cat_/, "");
  const selected = INCIDENT_CATEGORIES[clean];

  if (!selected) {
    // Check keyword matching
    let matched: CategoryOption | undefined;
    if (clean.includes("emerg") || clean.includes("hazard") || clean.includes("safe")) {
      matched = INCIDENT_CATEGORIES["1"];
    } else if (clean.includes("break") || clean.includes("theft") || clean.includes("trespass")) {
      matched = INCIDENT_CATEGORIES["2"];
    } else if (clean.includes("guard") || clean.includes("misconduct") || clean.includes("absent")) {
      matched = INCIDENT_CATEGORIES["3"];
    } else if (clean.includes("equip") || clean.includes("damage") || clean.includes("gate")) {
      matched = INCIDENT_CATEGORIES["4"];
    } else if (clean.includes("complain") || clean.includes("other") || clean.includes("general")) {
      matched = INCIDENT_CATEGORIES["5"];
    }

    if (!matched) {
      return {
        reply:
          `⚠️ Invalid category selection. Please reply with a number from *1 to 5*:\n\n` +
          `1️⃣ Emergency / Safety\n` +
          `2️⃣ Break-in / Theft\n` +
          `3️⃣ Guard Misconduct\n` +
          `4️⃣ Equipment Damage\n` +
          `5️⃣ Client Complaint / Other\n\n` +
          `Or type *cancel* to exit.`,
      };
    }

    sessionManager.setSessionState(from, "INCIDENT_SELECT_SITE", {
      incidentType: matched.type,
      severity: matched.severity,
      categoryLabel: matched.label,
    });
  } else {
    sessionManager.setSessionState(from, "INCIDENT_SELECT_SITE", {
      incidentType: selected.type,
      severity: selected.severity,
      categoryLabel: selected.label,
    });
  }

  // Look up employee's current or assigned sites
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId: session.employeeId, companyId: session.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { include: { site: true } } },
  });

  if (activeAttendance?.shift.site) {
    const currentSite = activeAttendance.shift.site;
    sessionManager.updateSessionData(from, {
      suggestedSiteId: currentSite.id,
      suggestedSiteName: currentSite.name,
    });

    return {
      reply:
        `📍 *Site Confirmation* (Step 2/3)\n\n` +
        `You are currently clocked in at *${currentSite.name}*.\nIs the incident occurring at this site?\n\n` +
        `1️⃣ *Yes, at ${currentSite.name}*\n` +
        `2️⃣ *No, a different site*\n\n` +
        `Reply *1* to confirm, or type the name of the site.`,
      buttons: [
        { id: "inc_site_yes", title: "Yes, this site" },
        { id: "inc_site_other", title: "Different site" },
      ],
    };
  }

  // Find recent sites assigned to this employee
  const recentShifts = await prisma.shift.findMany({
    where: { employeeId: session.employeeId, companyId: session.companyId },
    include: { site: true },
    orderBy: { startTime: "desc" },
    take: 3,
  });

  const uniqueSites = Array.from(
    new Map(
      recentShifts
        .filter((s) => s.site != null)
        .map((s) => [s.site!.id, s.site!])
    ).values()
  );

  if (uniqueSites.length > 0) {
    sessionManager.updateSessionData(from, {
      siteOptions: uniqueSites.map((s) => ({ id: s.id, name: s.name })),
    });

    const optionsText = uniqueSites
      .map((s, idx) => `${idx + 1}️⃣ *${s.name}*`)
      .join("\n");

    return {
      reply:
        `📍 *Site Selection* (Step 2/3)\n\n` +
        `Which site did this occur at?\n\n` +
        `${optionsText}\n\n` +
        `Reply with the number (1–${uniqueSites.length}) or type the site name.`,
    };
  }

  return {
    reply:
      `📍 *Site Selection* (Step 2/3)\n\n` +
      `Please reply with the *Name* of the site or post where this incident occurred:`,
  };
}

export async function handleIncidentSelectSite(
  from: string,
  text: string,
  session: ConversationSession
): Promise<IncidentFlowResult> {
  const clean = text.trim();
  const lower = clean.toLowerCase();

  // If user confirmed suggested site (1, yes, inc_site_yes)
  if (
    (lower === "1" || lower === "yes" || lower === "inc_site_yes" || lower.includes("this site")) &&
    session.data.suggestedSiteId &&
    session.data.suggestedSiteName
  ) {
    sessionManager.setSessionState(from, "INCIDENT_ENTER_DETAILS", {
      siteId: session.data.suggestedSiteId,
      siteName: session.data.suggestedSiteName,
    });

    return {
      reply:
        `📝 *Incident Details* (Step 3/3)\n\n` +
        `Site: *${session.data.suggestedSiteName}*\n` +
        `Category: *${session.data.categoryLabel}*\n\n` +
        `Please type a short description of what happened in a single message.\n` +
        `(Include: what happened, persons involved, immediate actions taken).`,
    };
  }

  // Check if chosen from siteOptions
  const siteOptions = session.data.siteOptions as { id: string; name: string }[] | undefined;
  if (siteOptions && siteOptions.length > 0) {
    const num = parseInt(lower, 10);
    if (!isNaN(num) && num >= 1 && num <= siteOptions.length) {
      const chosen = siteOptions[num - 1]!;
      sessionManager.setSessionState(from, "INCIDENT_ENTER_DETAILS", {
        siteId: chosen.id,
        siteName: chosen.name,
      });

      return {
        reply:
          `📝 *Incident Details* (Step 3/3)\n\n` +
          `Site: *${chosen.name}*\n` +
          `Category: *${session.data.categoryLabel}*\n\n` +
          `Please type a short description of what happened in a single message.\n` +
          `(Include: what happened, persons involved, immediate actions taken).`,
      };
    }
  }

  // Search site by name within company
  const site = await prisma.site.findFirst({
    where: {
      companyId: session.companyId,
      name: { contains: clean, mode: "insensitive" },
    },
    select: { id: true, name: true },
  });

  if (!site) {
    return {
      reply:
        `⚠️ Site "${clean}" not recognized in company records.\n\n` +
        `Please enter the exact site name, or type *cancel* to exit.`,
    };
  }

  sessionManager.setSessionState(from, "INCIDENT_ENTER_DETAILS", {
    siteId: site.id,
    siteName: site.name,
  });

  return {
    reply:
      `📝 *Incident Details* (Step 3/3)\n\n` +
      `Site: *${site.name}*\n` +
      `Category: *${session.data.categoryLabel}*\n\n` +
      `Please type a short description of what happened in a single message.\n` +
      `(Include: what happened, persons involved, immediate actions taken).`,
  };
}

export async function handleIncidentEnterDetails(
  from: string,
  text: string,
  session: ConversationSession
): Promise<IncidentFlowResult> {
  const details = text.trim();
  if (details.length < 5) {
    return {
      reply:
        `⚠️ Please provide more detail about the incident (at least 5 characters).\n\n` +
        `Describe what happened, who was involved, or type *cancel* to abort.`,
    };
  }

  const { incidentType, severity, categoryLabel, siteId, siteName } = session.data;

  // Retrieve employee to include details
  const employee = await prisma.employee.findUnique({
    where: { id: session.employeeId },
    select: { id: true, firstName: true, lastName: true, phone: true, email: true },
  });

  // Determine a valid User.id for reportedById (must satisfy Foreign Key)
  let reporterUser = employee?.email
    ? await prisma.user.findFirst({
        where: { companyId: session.companyId, email: employee.email },
        select: { id: true },
      })
    : null;

  if (!reporterUser) {
    const site = await prisma.site.findUnique({
      where: { id: siteId },
      select: { supervisorId: true },
    });
    if (site?.supervisorId) {
      reporterUser = { id: site.supervisorId };
    }
  }

  if (!reporterUser) {
    reporterUser = await prisma.user.findFirst({
      where: { companyId: session.companyId, isActive: true },
      select: { id: true },
    });
  }

  if (!reporterUser) {
    sessionManager.clearSession(from);
    return {
      reply:
        `⚠️ System notice: Unable to locate active user profile for incident logging. Please contact control room directly.`,
    };
  }

  const incidentNumber = await nextIncidentNumber(session.companyId);
  const now = new Date();
  const employeeName = employee ? `${employee.firstName} ${employee.lastName}` : "Field Guard";
  const title = `${categoryLabel}: ${siteName}`;
  const fullDescription = `[WhatsApp Report by ${employeeName} (${from})]\n\n${details}`;

  const incident = await prisma.incident.create({
    data: {
      companyId: session.companyId,
      incidentNumber,
      siteId,
      reportedById: reporterUser.id,
      incidentDateTime: now,
      incidentType: incidentType as IncidentType,
      severity: severity as IncidentSeverity,
      title: title.slice(0, 200),
      description: fullDescription,
      peopleInvolved: `${employeeName} (Reporting Guard)`,
      clientVisible: false,
      status: "SUBMITTED",
      supervisorApprovalStatus: "PENDING",
    },
    select: { id: true, incidentNumber: true },
  });

  // Create Operational Alert for control room and supervisors
  await upsertAlert({
    companyId: session.companyId,
    title: `🚨 Incident Reported: ${incidentNumber}`,
    message: `${categoryLabel} reported at ${siteName} by ${employeeName}. Details: ${details.slice(0, 140)}`,
    priority: severityToAlertPriority(severity as IncidentSeverity),
    sourceModule: "INCIDENTS",
    dedupeKey: `whatsapp_incident_${incident.id}`,
    sourceId: incident.id,
    siteId,
    employeeId: session.employeeId,
  }).catch((err) => console.warn("[WhatsApp Incident Alert Error]", err));

  // Log audit trail
  await createAuditLog({
    companyId: session.companyId,
    action: "incident.whatsapp_reported",
    entityType: "Incident",
    entityId: incident.id,
    metadata: {
      incidentNumber,
      source: "whatsapp",
      reportedByPhone: from,
      employeeId: session.employeeId,
      siteId,
      severity,
    },
  });

  // Transition to AWAITING_PHOTO so user can attach photo immediately
  sessionManager.setSessionState(from, "INCIDENT_AWAITING_PHOTO", {
    incidentId: incident.id,
    incidentNumber: incident.incidentNumber,
  });

  return {
    reply:
      `✅ *Incident Logged Successfully*\n\n` +
      `• Reference: *${incident.incidentNumber}*\n` +
      `• Category: *${categoryLabel}*\n` +
      `• Site: *${siteName}*\n` +
      `• Status: *Dispatched to Control Room*\n\n` +
      `📸 *Attach Photo/Evidence*:\n` +
      `If you have photos of the incident, send them right now as an image or document.\n\n` +
      `Or reply *menu* to return to main commands.`,
  };
}
