/**
 * Format a stored phone for display (South Africa: national 0-prefix, not 27 country code).
 * Storage may use 27821234567; roster sheet and exports show 0821234567.
 */
export function formatPhoneForDisplay(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;

  if (digits.startsWith("27") && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }

  if (digits.startsWith("0")) {
    return digits;
  }

  return digits;
}
