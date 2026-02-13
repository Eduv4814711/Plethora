export const config = {
  jwt: {
    accessSecret: process.env.JWT_SECRET ?? "dev-secret-change-in-production",
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret",
    accessExpiry: "15m",
    refreshExpiry: "7d",
  },
  bcrypt: {
    rounds: 12,
  },
  overtime: {
    standardHoursPerDay: 8,
    multiplier: 1.5,
  },
  attendance: {
    clockInWindowMinutes: 30,
  },
} as const;
