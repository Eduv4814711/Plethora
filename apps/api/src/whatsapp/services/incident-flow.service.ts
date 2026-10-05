import { prisma } from "../../lib/prisma.js";
import { createAuditLog } from "../../lib/audit.js";
import { upsertAlert } from "../../modules/alerts/alerts.service.js";
import { nextIncidentNumber, severityToAlertPriority } from "../../modules/incidents/incidents.service.js";
import { sessionManager, type ConversationSession } from "./session.service.js";
import { operationalEventBus } from "../../lib/events.js";
import { dispatchSupervisorEscalation } from "./supervisor-escalation.service.js";
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
  let categoryOption = selected;
  if (!categoryOption) {
    if (clean.includes("emerg") || clean.includes("hazard") || clean.includes("safe")) {
      categoryOption = INCIDENT_CATEGORIES["1"];
    } else if (clean.includes("break") || clean.includes("theft") || clean.includes("trespass")) {
      categoryOption = INCIDENT_CATEGORIES["2"];
    } else if (clean.includes("guard") || clean.includes("misconduct") || clean.includes("absent")) {
      categoryOption = INCIDENT_CATEGORIES["3"];
    } else if (clean.includes("equip") || clean.includes("damage") || clean.includes("gate")) {
      categoryOption = INCIDENT_CATEGORIES["4"];
    } else if (clean.includes("complain") || clean.includes("other") || clean.includes("general")) {
      categoryOption = INCIDENT_CATEGORIES["5"];
    }

    if (!categoryOption) {
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
  }

  const targetCategory = categoryOption;

  // 1. Look up employee's active attendance to identify current on-duty site
  const activeAttendance = await prisma.attendance.findFirst({
    where: {
      shift: { employeeId: session.employeeId, companyId: session.companyId },
      clockIn: { not: null },
      clockOut: null,
      status: "clocked_in",
    },
    include: { shift: { include: { site: true } } },
  });
  const currentSite = activeAttendance?.shift.site;

  // 2. Fetch active sites for the company
  const companySites = await prisma.site.findMany({
    where: { companyId: session.companyId, siteStatus: "ACTIVE" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 10,
  });

  // Fallback to any company sites if none marked ACTIVE
  let availableSites = companySites;
  if (availableSites.length === 0) {
    availableSites = await prisma.site.findMany({
      where: { companyId: session.companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 10,
    });
  }

  // Fallback if findMany returns empty but findFirst has site (e.g. unit mocks)
  if (availableSites.length === 0 && !currentSite) {
    const single = await prisma.site.findFirst({
      where: { companyId: session.companyId },
      select: { id: true, name: true },
    });
    if (single) {
      availableSites = [single];
    }
  }

  // 3. Assemble ordered list: prioritize current on-duty site first
  const orderedList: { id: string; name: string; isCurrent?: boolean }[] = [];
  if (currentSite) {
    orderedList.push({ id: currentSite.id, name: currentSite.name, isCurrent: true });
    for (const s of availableSites) {
      if (s.id !== currentSite.id) {
        orderedList.push({ id: s.id, name: s.name });
      }
    }
  } else {
    for (const s of availableSites) {
      orderedList.push({ id: s.id, name: s.name });
    }
  }

  const siteOptions = orderedList.slice(0, 10).map((s, idx) => ({
    number: idx + 1,
    id: s.id,
    name: s.name,
    isCurrent: Boolean(s.isCurrent),
    displayName: s.isCurrent ? `${s.name} (Current Site)` : s.name,
  }));

  sessionManager.setSessionState(from, "INCIDENT_SELECT_SITE", {
    incidentType: targetCategory.type,
    severity: targetCategory.severity,
    categoryLabel: targetCategory.label,
    siteOptions,
    suggestedSiteId: currentSite?.id,
    suggestedSiteName: currentSite?.name,
  });

  if (siteOptions.length > 0) {
    const optionsText = siteOptions
      .map((s) => `${s.number}️⃣ *${s.displayName}*`)
      .join("\n");

    const reply =
      `📍 *Site Selection* (Step 2/3)\n\n` +
      `Category: *${targetCategory.label}*\n\n` +
      `Please select the site where this incident occurred:\n\n` +
      `${optionsText}\n\n` +
      `Reply with the site number (*1–${siteOptions.length}*) or type the site name.\n` +
      `Type *cancel* to abort.`;

    if (siteOptions.length <= 3) {
      return {
        reply,
        buttons: siteOptions.map((s) => ({
          id: `inc_site_${s.number}`,
          title: `${s.number}. ${s.name}`.slice(0, 20),
        })),
      };
    }

    return {
      reply,
      sendInteractiveList: {
        body: reply,
        buttonText: "Choose Site",
        rows: siteOptions.map((s) => ({
          id: `inc_site_${s.number}`,
          title: `${s.number}. ${s.name}`.slice(0, 24),
          description: s.isCurrent ? "Currently on duty here" : undefined,
        })),
      },
    };
  }

  return {
    reply:
      `📍 *Site Selection* (Step 2/3)\n\n` +
      `Category: *${targetCategory.label}*\n\n` +
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

  const siteOptions = session.data.siteOptions as
    | { number: number; id: string; name: string; isCurrent?: boolean; displayName: string }[]
    | undefined;

  let selectedSite: { id: string; name: string } | undefined;

  // 1. Check if user typed a number (e.g. "1", "2") or clicked interactive button "inc_site_1"
  const cleanNumber = lower.replace(/^inc_site_/, "").trim();
  const num = parseInt(cleanNumber, 10);
  if (!isNaN(num) && siteOptions && siteOptions.length > 0) {
    const found = siteOptions.find((s) => s.number === num);
    if (found) {
      selectedSite = { id: found.id, name: found.name };
    }
  }

  // 2. Check "yes" or "inc_site_yes" if option 1 was Current Site
  if (
    !selectedSite &&
    (lower === "yes" || lower === "inc_site_yes" || lower.includes("this site") || lower === "current") &&
    siteOptions &&
    siteOptions.length > 0
  ) {
    const currentOpt = siteOptions.find((s) => s.isCurrent) ?? siteOptions[0];
    if (currentOpt) {
      selectedSite = { id: currentOpt.id, name: currentOpt.name };
    }
  }

  // 3. Match against siteOptions by name or partial name
  if (!selectedSite && siteOptions && siteOptions.length > 0) {
    const found = siteOptions.find(
      (s) =>
        s.name.toLowerCase() === lower ||
        s.name.toLowerCase().includes(lower) ||
        lower.includes(s.name.toLowerCase())
    );
    if (found) {
      selectedSite = { id: found.id, name: found.name };
    }
  }

  // 4. Search in DB for any company site matching clean
  if (!selectedSite) {
    const site = await prisma.site.findFirst({
      where: {
        companyId: session.companyId,
        name: { contains: clean, mode: "insensitive" },
      },
      select: { id: true, name: true },
    });
    if (site) {
      selectedSite = { id: site.id, name: site.name };
    }
  }

  // 5. If site successfully matched, proceed to Step 3
  if (selectedSite) {
    sessionManager.setSessionState(from, "INCIDENT_ENTER_DETAILS", {
      siteId: selectedSite.id,
      siteName: selectedSite.name,
    });

    return {
      reply:
        `📝 *Incident Details* (Step 3/3)\n\n` +
        `Site: *${selectedSite.name}*\n` +
        `Category: *${session.data.categoryLabel}*\n\n` +
        `Please type a short description of what happened in a single message.\n` +
        `(Include: what happened, persons involved, immediate actions taken).`,
    };
  }

  // 6. If not matched, re-display the site selection list with guidance
  if (siteOptions && siteOptions.length > 0) {
    const optionsText = siteOptions
      .map((s) => `${s.number}️⃣ *${s.displayName}*`)
      .join("\n");

    const reply =
      `⚠️ Site "${clean}" not recognized.\n\n` +
      `Please select a site by replying with its number:\n\n` +
      `${optionsText}\n\n` +
      `Reply with *1–${siteOptions.length}* or type the exact site name (or *cancel* to abort).`;

    if (siteOptions.length <= 3) {
      return {
        reply,
        buttons: siteOptions.map((s) => ({
          id: `inc_site_${s.number}`,
          title: `${s.number}. ${s.name}`.slice(0, 20),
        })),
      };
    }

    return {
      reply,
      sendInteractiveList: {
        body: reply,
        buttonText: "Choose Site",
        rows: siteOptions.map((s) => ({
          id: `inc_site_${s.number}`,
          title: `${s.number}. ${s.name}`.slice(0, 24),
          description: s.isCurrent ? "Currently on duty here" : undefined,
        })),
      },
    };
  }

  return {
    reply:
      `⚠️ Site "${clean}" not recognized in company records.\n\n` +
      `Please enter the exact site name, or type *cancel* to exit.`,
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

  const siteRecord = await prisma.site.findUnique({
    where: { id: siteId },
    select: { supervisorId: true, name: true },
  });
  const assignedSupervisorId = siteRecord?.supervisorId ?? null;

  const incident = await prisma.incident.create({
    data: {
      companyId: session.companyId,
      incidentNumber,
      siteId,
      reportedById: reporterUser.id,
      assignedSupervisorId,
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
    select: {
      id: true,
      incidentNumber: true,
      title: true,
      description: true,
      severity: true,
      status: true,
      incidentDateTime: true,
      siteId: true,
      assignedSupervisorId: true,
      createdAt: true,
    },
  });

  // Broadcast real-time incident event to Control Room Operator dashboard
  operationalEventBus.broadcast("INCIDENT_CREATED", session.companyId, {
    ...incident,
    siteName,
    site: { id: siteId, name: siteName },
    reportedBy: { name: employeeName, phone: from },
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

  // Automated supervisor WhatsApp dispatch for CRITICAL and HIGH severity incidents
  if (severity === "CRITICAL" || severity === "HIGH") {
    void dispatchSupervisorEscalation({
      companyId: session.companyId,
      siteId,
      guardName: employeeName,
      guardPhone: from,
      reason: `🚨 ${severity} INCIDENT: ${categoryLabel} at ${siteName} (${incidentNumber}) - ${details.slice(0, 100)}`,
      incidentId: incident.id,
      severity: severity as string,
    }).catch((err) => console.warn("[Supervisor Escalation Incident Error]", err));
  }

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
