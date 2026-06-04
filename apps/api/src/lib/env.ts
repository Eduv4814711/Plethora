import { z } from "zod";

export const MIN_PROD_JWT_LEN = 32;

/** Values that must never ship in production (dev defaults + .env.example placeholders). */
export const FORBIDDEN_JWT_SECRETS = new Set([
  "",
  "dev-secret-change-in-production",
  "dev-refresh-secret",
  "change-this-in-production",
  "change-this-refresh-in-production",
]);

const DEV_JWT_ACCESS = "dev-secret-change-in-production";
const DEV_JWT_REFRESH = "dev-refresh-secret";

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

function parseCorsOrigins(value: unknown): string[] {
  if (typeof value !== "string" || value.trim() === "") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Coerce a "true"/"false" (case-insensitive) string env var into a boolean. */
function parseBooleanFlag(value: unknown): boolean | undefined {
  const trimmed = emptyToUndefined(value);
  if (trimmed === undefined) return undefined;
  if (typeof trimmed === "string") {
    const lower = trimmed.trim().toLowerCase();
    if (lower === "true") return true;
    if (lower === "false") return false;
  }
  return undefined;
}

const nodeEnvSchema = z.enum(["development", "production", "test"]).default("development");

const rawEnvSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  JWT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  JWT_REFRESH_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  CORS_ORIGIN: z.preprocess(emptyToUndefined, z.string().optional()),
  FRONTEND_URL: z.preprocess(emptyToUndefined, z.string().optional()),
  PORT: z.preprocess(
    (value) => {
      const trimmed = emptyToUndefined(value);
      if (trimmed === undefined) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : trimmed;
    },
    z.number().int().min(1).max(65535).optional()
  ),
  HOST: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  TRUST_PROXY: z.preprocess(parseBooleanFlag, z.boolean().optional()),
  WHATSAPP_PHONE_NUMBER_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_ACCESS_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_VERIFY_TOKEN: z.preprocess(emptyToUndefined, z.string().optional()),
  WHATSAPP_API_VERSION: z.preprocess(emptyToUndefined, z.string().optional()),
  CLOCK_IN_WINDOW_MINUTES: z.preprocess(
    (value) => {
      const trimmed = emptyToUndefined(value);
      if (trimmed === undefined) return undefined;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : trimmed;
    },
    z.number().int().min(1).max(24 * 60).optional()
  ),
  ENCRYPTION_KEY: z.preprocess(emptyToUndefined, z.string().min(16).optional()),
});

type RawEnv = z.infer<typeof rawEnvSchema>;

export type Env = {
  nodeEnv: "development" | "production" | "test";
  isProduction: boolean;
  databaseUrl: string | undefined;
  jwtSecret: string;
  jwtRefreshSecret: string;
  corsOrigins: string[];
  frontendUrl: string | undefined;
  port: number;
  host: string;
  trustProxy: boolean;
  whatsapp: {
    enabled: boolean;
    phoneNumberId: string;
    accessToken: string;
    verifyToken: string;
    apiVersion: string;
  };
  clockInWindowMinutes: number;
  encryptionKey: string | undefined;
};

export function formatEnvValidationError(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "environment";
    return `${path}: ${issue.message}`;
  });
  return `Invalid environment configuration:\n${lines.map((l) => `- ${l}`).join("\n")}`;
}

function pickRawEnv(source: NodeJS.ProcessEnv): Record<string, unknown> {
  return {
    NODE_ENV: source.NODE_ENV,
    DATABASE_URL: source.DATABASE_URL,
    JWT_SECRET: source.JWT_SECRET,
    JWT_REFRESH_SECRET: source.JWT_REFRESH_SECRET,
    CORS_ORIGIN: source.CORS_ORIGIN,
    FRONTEND_URL: source.FRONTEND_URL,
    PORT: source.PORT,
    HOST: source.HOST,
    TRUST_PROXY: source.TRUST_PROXY,
    WHATSAPP_PHONE_NUMBER_ID: source.WHATSAPP_PHONE_NUMBER_ID,
    WHATSAPP_ACCESS_TOKEN: source.WHATSAPP_ACCESS_TOKEN,
    WHATSAPP_VERIFY_TOKEN: source.WHATSAPP_VERIFY_TOKEN,
    WHATSAPP_API_VERSION: source.WHATSAPP_API_VERSION,
    CLOCK_IN_WINDOW_MINUTES: source.CLOCK_IN_WINDOW_MINUTES,
    ENCRYPTION_KEY: source.ENCRYPTION_KEY,
  };
}

function assertProductionEnv(raw: RawEnv): void {
  const errors: string[] = [];

  if (!raw.DATABASE_URL) {
    errors.push(
      "DATABASE_URL is required in production. Set it to your PostgreSQL connection string."
    );
  }

  const jwt = raw.JWT_SECRET?.trim() ?? "";
  const refresh = raw.JWT_REFRESH_SECRET?.trim() ?? "";

  if (!jwt) {
    errors.push(
      "JWT_SECRET is required in production. Use a random string of at least 32 characters."
    );
  } else if (FORBIDDEN_JWT_SECRETS.has(jwt) || jwt.length < MIN_PROD_JWT_LEN) {
    errors.push(
      `JWT_SECRET must be at least ${MIN_PROD_JWT_LEN} characters and must not use dev or example placeholder values.`
    );
  }

  if (!refresh) {
    errors.push(
      "JWT_REFRESH_SECRET is required in production. Use a different random string of at least 32 characters."
    );
  } else if (FORBIDDEN_JWT_SECRETS.has(refresh) || refresh.length < MIN_PROD_JWT_LEN) {
    errors.push(
      `JWT_REFRESH_SECRET must be at least ${MIN_PROD_JWT_LEN} characters and must not use dev or example placeholder values.`
    );
  }

  if (jwt && refresh && jwt === refresh) {
    errors.push("JWT_SECRET and JWT_REFRESH_SECRET must be different in production.");
  }

  const cors = parseCorsOrigins(raw.CORS_ORIGIN);
  if (cors.length === 0) {
    errors.push(
      'CORS_ORIGIN is required in production. Set it to your web app origin(s), comma-separated (e.g. https://app.example.com).'
    );
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid production environment configuration:\n${errors.map((e) => `- ${e}`).join("\n")}`
    );
  }
}

function resolveJwtSecrets(raw: RawEnv, isProduction: boolean): { jwtSecret: string; jwtRefreshSecret: string } {
  if (isProduction) {
    return {
      jwtSecret: raw.JWT_SECRET!.trim(),
      jwtRefreshSecret: raw.JWT_REFRESH_SECRET!.trim(),
    };
  }
  return {
    jwtSecret: raw.JWT_SECRET?.trim() || DEV_JWT_ACCESS,
    jwtRefreshSecret: raw.JWT_REFRESH_SECRET?.trim() || DEV_JWT_REFRESH,
  };
}

/** Parse and validate environment variables. Throws with a clear message on failure. */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = rawEnvSchema.safeParse(pickRawEnv(source));
  if (!parsed.success) {
    throw new Error(formatEnvValidationError(parsed.error));
  }

  const raw = parsed.data;
  const isProduction = raw.NODE_ENV === "production";

  if (isProduction) {
    assertProductionEnv(raw);
  }

  const { jwtSecret, jwtRefreshSecret } = resolveJwtSecrets(raw, isProduction);
  const corsOrigins = parseCorsOrigins(raw.CORS_ORIGIN);

  const phoneNumberId = raw.WHATSAPP_PHONE_NUMBER_ID ?? "";
  const accessToken = raw.WHATSAPP_ACCESS_TOKEN ?? "";
  const verifyToken = raw.WHATSAPP_VERIFY_TOKEN ?? "";

  return {
    nodeEnv: raw.NODE_ENV,
    isProduction,
    databaseUrl: raw.DATABASE_URL,
    jwtSecret,
    jwtRefreshSecret,
    corsOrigins,
    frontendUrl: raw.FRONTEND_URL,
    port: raw.PORT ?? 3001,
    host: raw.HOST ?? "0.0.0.0",
    trustProxy: raw.TRUST_PROXY ?? false,
    whatsapp: {
      enabled: !!(phoneNumberId && accessToken && verifyToken),
      phoneNumberId,
      accessToken,
      verifyToken,
      apiVersion: raw.WHATSAPP_API_VERSION ?? "v21.0",
    },
    clockInWindowMinutes: raw.CLOCK_IN_WINDOW_MINUTES ?? 15,
    encryptionKey: raw.ENCRYPTION_KEY,
  };
}

/** Validated environment (parsed once at module load). */
export const env = parseEnv();

/** Fastify CORS `origin` option derived from validated env. */
export function corsOriginFromEnv(validated: Env = env): boolean | string | string[] {
  if (!validated.isProduction) {
    if (validated.corsOrigins.length === 0) return true;
    if (validated.corsOrigins.length === 1) return validated.corsOrigins[0]!;
    return validated.corsOrigins;
  }

  if (validated.corsOrigins.length === 1) return validated.corsOrigins[0]!;
  return validated.corsOrigins;
}
