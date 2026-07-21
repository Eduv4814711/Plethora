import { env } from "./env.js";

export const config = {
  isProduction: env.isProduction,
  jwt: {
    accessSecret: env.jwtSecret,
    refreshSecret: env.jwtRefreshSecret,
    accessExpiry: "15m",
    refreshExpiry: "7d",
  },
  bcrypt: {
    rounds: env.isProduction ? 12 : 10,
  },
  overtime: {
    standardHoursPerDay: 8,
    multiplier: 1.5,
  },
  attendance: {
    clockInWindowMinutes: env.clockInWindowMinutes,
    lateClockInGraceMinutes: 120, // Allow up to 2 hours late
  },
  whatsapp: {
    enabled: env.whatsapp.enabled,
    phoneNumberId: env.whatsapp.phoneNumberId,
    accessToken: env.whatsapp.accessToken,
    verifyToken: env.whatsapp.verifyToken,
    appSecret: env.whatsapp.appSecret,
    apiVersion: env.whatsapp.apiVersion,
  },
} as const;
