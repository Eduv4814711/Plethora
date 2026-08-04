import type { FastifyRequest } from "fastify";
import { auditFromRequest } from "./audit.js";

/**
 * Records that someone exercised a `view_sensitive` grant.
 *
 * `view_sensitive` is what unlocks ID numbers, banking details, tax numbers and
 * pay. Holding it is visible in the access matrix; using it was not visible
 * anywhere until this. Rows are written at list or record granularity — never
 * per field — so the trail stays readable and the table stays small.
 */
export async function recordSensitiveAccess(
  request: FastifyRequest,
  params: {
    module: string;
    entityType: string;
    /** Set for a single record; omit for a list. */
    entityId?: string;
    /** How many records were unmasked. */
    recordCount: number;
    /** The restricted field names that were revealed. */
    fields: readonly string[];
    context?: Record<string, unknown>;
  }
): Promise<void> {
  // Nothing was revealed, so there is nothing to record.
  if (params.recordCount <= 0) return;

  await auditFromRequest(request, {
    action: "data.sensitive.view",
    entityType: params.entityType,
    entityId: params.entityId,
    metadata: {
      module: params.module,
      recordCount: params.recordCount,
      fields: [...params.fields],
      route: request.routeOptions?.url ?? request.url,
      ...(params.context ?? {}),
    },
  });
}
