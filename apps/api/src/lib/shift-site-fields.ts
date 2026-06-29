import { prisma } from "./prisma.js";
import { inferPostShiftType } from "./site-post-api.js";

export type ShiftSiteFields = {
  siteId: string;
  shiftType: string;
  legacyPostName: string | null;
};

/** Resolve post-based shift input to site-direct Shift columns. */
export async function resolveShiftSiteFieldsFromPost(
  postId: string,
  companyId: string
): Promise<ShiftSiteFields | null> {
  const post = await prisma.sitePost.findFirst({
    where: { id: postId, site: { companyId } },
    include: {
      coverageRequirements: { where: { isEnabled: true } },
    },
  });
  if (!post) return null;
  const shiftType = inferPostShiftType(post.coverageRequirements) ?? "day";
  return {
    siteId: post.siteId,
    shiftType: shiftType.toLowerCase() === "night" ? "night" : "day",
    legacyPostName: post.name,
  };
}

export function normalizeShiftType(raw: string | null | undefined): "day" | "night" {
  return (raw ?? "day").toLowerCase() === "night" ? "night" : "day";
}
