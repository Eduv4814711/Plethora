import { prisma } from "../lib/prisma.js";
import { format } from "date-fns";
import { formatInTimeZone } from "date-fns-tz";
import { normalizeWhatsAppPhone } from "../lib/phone.js";
import { sendText } from "../whatsapp/services/send.service.js";
import { createAuditLog } from "../lib/audit.js";
import { operationalEventBus } from "../lib/events.js";

export interface GuardRollCallItem {
  employeeId: string;
  name: string;
  phone: string | null;
  shiftId: string;
  status: "VERIFIED" | "FLAGGED" | "REJECTED" | "ABSENT";
  clockInTime: string | null;
  clockOutTime: string | null;
  distanceMeters: number | null;
}

export interface SiteRollCallSummary {
  siteId: string;
  siteName: string;
  supervisorName: string | null;
  rosteredCount: number;
  verifiedCount: number;
  flaggedCount: number;
  absentCount: number;
  coveragePercentage: number;
  guards: GuardRollCallItem[];
}

export interface ShiftRollCallSummary {
  companyId: string;
  companyName: string;
  shiftType: "day" | "night" | "all";
  shiftLabel: string;
  dateStr: string;
  generatedAt: string;
  totalSites: number;
  totalRostered: number;
  totalVerified: number;
  totalFlagged: number;
  totalAbsent: number;
  coveragePercentage: number;
  sites: SiteRollCallSummary[];
}

export async function aggregateShiftRollCall(
  companyId: string,
  options?: { shiftType?: "day" | "night" | "all"; date?: Date; siteId?: string }
): Promise<ShiftRollCallSummary> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { name: true, settings: true },
  });

  const settings = (company?.settings as Record<string, unknown>) ?? {};
  const timeZone =
    (typeof settings.timezone === "string" && settings.timezone.trim()) || "Africa/Johannesburg";

  const targetDate = options?.date || new Date();
  const shiftType = options?.shiftType || (new Date().getHours() >= 18 || new Date().getHours() < 6 ? "night" : "day");

  // Determine window for shift in company timezone
  const dateStr = formatInTimeZone(targetDate, timeZone, "yyyy-MM-dd");
  let windowStart: Date;
  let windowEnd: Date;
  let shiftLabel: string;

  if (shiftType === "day") {
    shiftLabel = "Day Shift (06:00 – 18:00)";
    windowStart = new Date(`${dateStr}T05:00:00.000Z`);
    windowEnd = new Date(`${dateStr}T19:00:00.000Z`);
  } else if (shiftType === "night") {
    shiftLabel = "Night Shift (18:00 – 06:00)";
    windowStart = new Date(`${dateStr}T17:00:00.000Z`);
    const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    const nextDayStr = formatInTimeZone(nextDay, timeZone, "yyyy-MM-dd");
    windowEnd = new Date(`${nextDayStr}T07:00:00.000Z`);
  } else {
    shiftLabel = "All Shifts (24 Hours)";
    windowStart = new Date(`${dateStr}T00:00:00.000Z`);
    windowEnd = new Date(`${dateStr}T23:59:59.999Z`);
  }

  const shifts = await prisma.shift.findMany({
    where: {
      companyId,
      startTime: { gte: windowStart, lte: windowEnd },
      ...(options?.siteId ? { siteId: options.siteId } : {}),
    },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, phone: true },
      },
      site: {
        select: {
          id: true,
          name: true,
          supervisor: { select: { id: true, name: true } },
        },
      },
      attendances: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
    orderBy: [{ site: { name: "asc" } }, { startTime: "asc" }],
  });

  const sitesMap = new Map<string, SiteRollCallSummary>();

  for (const shift of shifts) {
    const sId = shift.siteId;
    const sName = shift.site?.name || "Unassigned Site";
    const supervisorName = shift.site?.supervisor?.name || null;

    if (!sitesMap.has(sId)) {
      sitesMap.set(sId, {
        siteId: sId,
        siteName: sName,
        supervisorName,
        rosteredCount: 0,
        verifiedCount: 0,
        flaggedCount: 0,
        absentCount: 0,
        coveragePercentage: 0,
        guards: [],
      });
    }

    const siteSummary = sitesMap.get(sId)!;
    siteSummary.rosteredCount += 1;

    const att = shift.attendances[0];
    let guardStatus: GuardRollCallItem["status"] = "ABSENT";
    let clockInFmt: string | null = null;
    let clockOutFmt: string | null = null;

    if (att && att.clockIn) {
      clockInFmt = formatInTimeZone(att.clockIn, timeZone, "HH:mm");
      if (att.clockOut) {
        clockOutFmt = formatInTimeZone(att.clockOut, timeZone, "HH:mm");
      }

      if (att.validationStatus === "VERIFIED" || att.withinGeofence) {
        guardStatus = "VERIFIED";
        siteSummary.verifiedCount += 1;
      } else if (att.validationStatus === "FLAGGED_NO_GEOFENCE") {
        guardStatus = "FLAGGED";
        siteSummary.flaggedCount += 1;
      } else if (att.validationStatus === "REJECTED_GEOFENCE") {
        guardStatus = "REJECTED";
        siteSummary.flaggedCount += 1;
      } else {
        guardStatus = "VERIFIED";
        siteSummary.verifiedCount += 1;
      }
    } else {
      guardStatus = "ABSENT";
      siteSummary.absentCount += 1;
    }

    const guardName = shift.employee
      ? `${shift.employee.firstName} ${shift.employee.lastName}`.trim()
      : "Unassigned Guard";

    siteSummary.guards.push({
      employeeId: shift.employeeId,
      name: guardName,
      phone: shift.employee?.phone || null,
      shiftId: shift.id,
      status: guardStatus,
      clockInTime: clockInFmt,
      clockOutTime: clockOutFmt,
      distanceMeters: att?.distanceMeters ?? null,
    });
  }

  // Calculate percentages per site
  const sitesList: SiteRollCallSummary[] = Array.from(sitesMap.values()).map((s) => ({
    ...s,
    coveragePercentage: s.rosteredCount > 0 ? Math.round((s.verifiedCount / s.rosteredCount) * 100) : 100,
  }));

  const totalRostered = sitesList.reduce((acc, s) => acc + s.rosteredCount, 0);
  const totalVerified = sitesList.reduce((acc, s) => acc + s.verifiedCount, 0);
  const totalFlagged = sitesList.reduce((acc, s) => acc + s.flaggedCount, 0);
  const totalAbsent = sitesList.reduce((acc, s) => acc + s.absentCount, 0);
  const coveragePercentage = totalRostered > 0 ? Math.round((totalVerified / totalRostered) * 100) : 100;

  return {
    companyId,
    companyName: company?.name || "Plethora Security",
    shiftType,
    shiftLabel,
    dateStr,
    generatedAt: format(new Date(), "yyyy-MM-dd HH:mm:ss"),
    totalSites: sitesList.length,
    totalRostered,
    totalVerified,
    totalFlagged,
    totalAbsent,
    coveragePercentage,
    sites: sitesList,
  };
}

export function formatRollCallWhatsAppMessage(summary: ShiftRollCallSummary): string {
  const coverageEmoji = summary.coveragePercentage >= 95 ? "🟢" : summary.coveragePercentage >= 80 ? "🟡" : "🔴";

  let msg =
    `🛡️ *PLETHORA — SHIFT ROLL-CALL SUMMARY*\n` +
    `🏢 *Company*: ${summary.companyName}\n` +
    `📅 *Date*: ${summary.dateStr} | ${summary.shiftLabel}\n` +
    `⏱️ *Time*: ${summary.generatedAt}\n\n` +
    `📊 *Parade State Summary* ${coverageEmoji}\n` +
    `• Overall Post Coverage: *${summary.coveragePercentage}%*\n` +
    `• Verified on Duty: *${summary.totalVerified}* guards ✅\n` +
    `• Exceptions / Flagged: *${summary.totalFlagged}* guards ⚠️\n` +
    `• Absent / Unaccounted: *${summary.totalAbsent}* guards ❌\n` +
    `• Total Scheduled Posts: *${summary.totalRostered}* across *${summary.totalSites}* sites\n\n` +
    `📍 *Site-by-Site Roll-Call*:\n`;

  if (summary.sites.length === 0) {
    msg += `_No scheduled shifts found for this shift window._\n`;
  } else {
    summary.sites.forEach((site, idx) => {
      const siteEmoji = site.verifiedCount === site.rosteredCount ? "✅" : site.absentCount > 0 ? "⚠️" : "🟡";
      msg += `\n${idx + 1}️⃣ *${site.siteName}* (${site.verifiedCount}/${site.rosteredCount}) ${siteEmoji}\n`;
      if (site.supervisorName) {
        msg += `   _Supervisor: ${site.supervisorName}_\n`;
      }

      site.guards.forEach((g) => {
        if (g.status === "VERIFIED") {
          msg += `   • ${g.name} (Verified ${g.clockInTime || "on post"})\n`;
        } else if (g.status === "FLAGGED") {
          msg += `   • ⚠️ ${g.name} (Flagged / No GPS ${g.clockInTime || ""})\n`;
        } else if (g.status === "REJECTED") {
          msg += `   • ⚠️ ${g.name} (Outside Geofence)\n`;
        } else {
          msg += `   • ❌ *ABSENT*: ${g.name} (No clock-in)\n`;
        }
      });
    });
  }

  msg += `\n_Generated automatically by Plethora Control Room._`;
  return msg;
}

export async function resolveDesignatedOfficePhones(companyId: string): Promise<string[]> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { phone: true, settings: true },
  });

  const settings = (company?.settings as Record<string, unknown>) ?? {};
  const candidates: string[] = [];

  // 1. Configured designatedOfficePhones array or comma-separated string
  if (Array.isArray(settings.designatedOfficePhones)) {
    candidates.push(...settings.designatedOfficePhones.map(String));
  } else if (typeof settings.designatedOfficePhones === "string" && settings.designatedOfficePhones.trim()) {
    candidates.push(...settings.designatedOfficePhones.split(",").map((s) => s.trim()));
  }

  // 2. rollCallPhones
  if (Array.isArray(settings.rollCallPhones)) {
    candidates.push(...settings.rollCallPhones.map(String));
  } else if (typeof settings.rollCallPhones === "string" && settings.rollCallPhones.trim()) {
    candidates.push(...settings.rollCallPhones.split(",").map((s) => s.trim()));
  }

  // 3. Fallback to company.phone
  if (candidates.length === 0 && company?.phone) {
    candidates.push(company.phone);
  }

  // Normalize and deduplicate
  const validPhones = Array.from(
    new Set(
      candidates
        .map((p) => normalizeWhatsAppPhone(p))
        .filter((p): p is string => Boolean(p))
    )
  );

  return validPhones;
}

export async function dispatchShiftRollCall(
  companyId: string,
  options?: { shiftType?: "day" | "night" | "all"; siteId?: string; overrideRecipients?: string[] }
): Promise<{ success: boolean; recipientCount: number; recipients: string[]; summary: ShiftRollCallSummary; message: string }> {
  const summary = await aggregateShiftRollCall(companyId, options);
  const message = formatRollCallWhatsAppMessage(summary);

  const recipients =
    options?.overrideRecipients && options.overrideRecipients.length > 0
      ? options.overrideRecipients.map((p) => normalizeWhatsAppPhone(p)).filter((p): p is string => Boolean(p))
      : await resolveDesignatedOfficePhones(companyId);

  if (recipients.length === 0) {
    console.warn(`[Shift Roll-Call] No designated office phones configured for company ${companyId}`);
    return {
      success: false,
      recipientCount: 0,
      recipients: [],
      summary,
      message,
    };
  }

  let sentCount = 0;
  for (const phone of recipients) {
    try {
      await sendText(phone, message);
      sentCount += 1;

      // Log outbound message in WhatsAppMessage if an employee record matches
      if (prisma.whatsAppMessage?.create) {
        const emp = prisma.employee?.findFirst
          ? await prisma.employee.findFirst({
              where: { companyId, phone: { contains: phone.slice(-9) } },
              select: { id: true },
            })
          : null;

        if (emp?.id) {
          await prisma.whatsAppMessage.create({
            data: {
              companyId,
              employeeId: emp.id,
              whatsappMessageId: `rollcall_${Date.now()}_${phone}`,
              direction: "outbound",
              type: "text",
              text: message,
            },
          }).catch(() => undefined);
        }
      }
    } catch (err) {
      console.error(`[Shift Roll-Call Send Error to ${phone}]`, err);
    }
  }

  // Broadcast real-time event to Control Room
  operationalEventBus.broadcast("ROLL_CALL_DISPATCHED", companyId, {
    summary,
    recipients,
    sentCount,
    timestamp: new Date().toISOString(),
  });

  // Audit log
  await createAuditLog({
    companyId,
    action: "whatsapp.roll_call_dispatched",
    entityType: "Company",
    entityId: companyId,
    metadata: {
      shiftType: summary.shiftType,
      date: summary.dateStr,
      totalVerified: summary.totalVerified,
      totalAbsent: summary.totalAbsent,
      coveragePercentage: summary.coveragePercentage,
      recipients,
      sentCount,
    },
  }).catch(() => undefined);

  return {
    success: sentCount > 0,
    recipientCount: sentCount,
    recipients,
    summary,
    message,
  };
}
