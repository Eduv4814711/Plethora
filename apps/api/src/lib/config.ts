export const config = {
  jwt: {
    accessSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret",
    accessExpiry: "15m",
    refreshExpiry: "7d",
  },
  bcrypt: {
    rounds: process.env.NODE_ENV === "production" ? 12 : 10,
  },
  overtime: {
    standardHoursPerDay: 8,
    multiplier: 1.5,
  },
  attendance: {
    clockInWindowMinutes: Number(process.env.CLOCK_IN_WINDOW_MINUTES) || 15,
    lateClockInGraceMinutes: 120, // Allow up to 2 hours late
  },
  whatsapp: {
    enabled: !!(
      process.env.WHATSAPP_PHONE_NUMBER_ID &&
      process.env.WHATSAPP_ACCESS_TOKEN &&
      process.env.WHATSAPP_VERIFY_TOKEN
    ),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN ?? "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? "",
    apiVersion: process.env.WHATSAPP_API_VERSION ?? "v21.0",
  },
} as const;
