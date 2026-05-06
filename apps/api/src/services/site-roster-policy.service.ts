import { z } from "zod";
import type { Prisma } from "@prisma/client";

export const rosterShiftGenderPolicyZod = z
  .object({
    day: z.enum(["male", "female"]).optional(),
    night: z.enum(["male", "female"]).optional(),
  })
  .strict();

export type RosterShiftGenderPolicy = z.infer<typeof rosterShiftGenderPolicyZod>;

function normalizeGender(g: string | null | undefined): "male" | "female" | null {
  if (!g) return null;
  const u = g.trim().toUpperCase();
  if (u === "M" || u === "MALE") return "male";
  if (u === "F" || u === "FEMALE") return "female";
  return null;
}

function shiftBucket(shiftType: string | null | undefined): "day" | "night" {
  return shiftType === "night" ? "night" : "day";
}

/** Parse stored JSON; invalid shapes return null (no enforcement). */
export function parseRosterShiftGenderPolicy(raw: unknown): RosterShiftGenderPolicy | null {
  if (raw == null) return null;
  const parsed = rosterShiftGenderPolicyZod.safeParse(raw);
  if (!parsed.success) return null;
  const o = parsed.data;
  if (o.day === undefined && o.night === undefined) return null;
  return o;
}

function requiredGenderForBucket(
  policy: RosterShiftGenderPolicy | null,
  bucket: "day" | "night"
): "male" | "female" | undefined {
  if (!policy) return undefined;
  return policy[bucket];
}

/**
 * Human-readable lines for matrix footer (before optional notes).
 */
export function policyLinesForMatrix(policy: RosterShiftGenderPolicy | null): string[] {
  if (!policy) return [];
  const lines: string[] = [];
  const word = (g: "male" | "female") => (g === "male" ? "male" : "female");
  if (policy.day) lines.push(`Day shift: ${word(policy.day)} guards only.`);
  if (policy.night) lines.push(`Night shift: ${word(policy.night)} guards only.`);
  return lines;
}

export function formatSiteRulesForMatrix(policyRaw: unknown, notes: string | null | undefined): string | null {
  const policy = parseRosterShiftGenderPolicy(policyRaw);
  const auto = policyLinesForMatrix(policy);
  const noteLines = notes?.trim() ? notes.trim().split(/\n+/) : [];
  if (auto.length === 0 && noteLines.length === 0) return null;
  const parts: string[] = [];
  if (auto.length) parts.push(auto.join("\n"));
  if (noteLines.length) {
    if (parts.length) parts.push("");
    parts.push(noteLines.join("\n"));
  }
  return parts.join("\n");
}

function shiftKindLabel(bucket: "day" | "night"): string {
  return bucket === "night" ? "night" : "day";
}

function genderLabel(g: "male" | "female"): string {
  return g === "male" ? "male" : "female";
}

/**
 * Returns an error message if the assignment violates the site policy, otherwise null.
 */
export function getShiftGenderPolicyViolation(
  employeeGender: string | null | undefined,
  postShiftType: string | null | undefined,
  policyRaw: Prisma.JsonValue | null | undefined
): string | null {
  const policy = parseRosterShiftGenderPolicy(policyRaw ?? null);
  if (!policy) return null;
  const bucket = shiftBucket(postShiftType);
  const required = requiredGenderForBucket(policy, bucket);
  if (!required) return null;
  const actual = normalizeGender(employeeGender);
  if (actual === null) {
    return `This site requires ${genderLabel(required)} guards on ${shiftKindLabel(bucket)} shifts. This employee has no gender on record — update their profile or choose another guard.`;
  }
  if (actual !== required) {
    return `This site requires ${genderLabel(required)} guards on ${shiftKindLabel(bucket)} shifts.`;
  }
  return null;
}
