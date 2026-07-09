import { detectAndPersistExceptions } from "./exceptions.service.js";

/** Best-effort exception detection after a clock event — does not block the request. */
export function triggerPostClockExceptionSync(companyId: string, siteId?: string | null) {
  void detectAndPersistExceptions({
    companyId,
    siteId: siteId ?? undefined,
    lookbackHours: 24,
  }).catch(() => undefined);
}
