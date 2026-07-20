import { describe, expect, it } from "vitest";
import { MIN_PROD_JWT_LEN, formatEnvValidationError, parseEnv } from "../env.js";
import { z } from "zod";

const VALID_JWT_A = "a".repeat(MIN_PROD_JWT_LEN);
const VALID_JWT_B = "b".repeat(MIN_PROD_JWT_LEN);

function prodBase(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/plethora",
    JWT_SECRET: VALID_JWT_A,
    JWT_REFRESH_SECRET: VALID_JWT_B,
    CORS_ORIGIN: "https://app.example.com",
    ...overrides,
  };
}

describe("parseEnv", () => {
  it("applies safe development defaults when NODE_ENV is unset", () => {
    const env = parseEnv({});
    expect(env.nodeEnv).toBe("development");
    expect(env.isProduction).toBe(false);
    expect(env.jwtSecret).toBe("dev-secret-change-in-production");
    expect(env.jwtRefreshSecret).toBe("dev-refresh-secret");
    expect(env.port).toBe(3001);
    expect(env.host).toBe("0.0.0.0");
    expect(env.clockInWindowMinutes).toBe(15);
    expect(env.whatsapp.apiVersion).toBe("v21.0");
    expect(env.whatsapp.enabled).toBe(false);
    expect(env.trustProxy).toBe(false);
  });

  it("parses optional development overrides", () => {
    const env = parseEnv({
      NODE_ENV: "development",
      PORT: "4000",
      HOST: "127.0.0.1",
      CORS_ORIGIN: "http://localhost:3000, http://localhost:3001",
      FRONTEND_URL: "http://localhost:3000",
      CLOCK_IN_WINDOW_MINUTES: "30",
      WHATSAPP_PHONE_NUMBER_ID: "123",
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_VERIFY_TOKEN: "verify",
      WHATSAPP_API_VERSION: "v22.0",
      ENCRYPTION_KEY: "sixteen-char-key!!",
    });
    expect(env.port).toBe(4000);
    expect(env.host).toBe("127.0.0.1");
    expect(env.corsOrigins).toEqual(["http://localhost:3000", "http://localhost:3001"]);
    expect(env.frontendUrl).toBe("http://localhost:3000");
    expect(env.clockInWindowMinutes).toBe(30);
    expect(env.whatsapp.enabled).toBe(true);
    expect(env.whatsapp.apiVersion).toBe("v22.0");
    expect(env.encryptionKey).toBe("sixteen-char-key!!");
  });

  it("treats test NODE_ENV like non-production for JWT defaults", () => {
    const env = parseEnv({ NODE_ENV: "test" });
    expect(env.nodeEnv).toBe("test");
    expect(env.jwtSecret).toBe("dev-secret-change-in-production");
  });

  it("rejects invalid PORT", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        PORT: "not-a-number",
      })
    ).toThrow(/Invalid environment configuration/);
  });

  it("rejects ENCRYPTION_KEY shorter than 16 characters when set", () => {
    expect(() =>
      parseEnv({
        NODE_ENV: "development",
        ENCRYPTION_KEY: "short",
      })
    ).toThrow(/Invalid environment configuration/);
  });

  describe("production", () => {
    it("enables trustProxy by default in production", () => {
      expect(parseEnv(prodBase()).trustProxy).toBe(true);
    });

    it("accepts a valid production configuration", () => {
      const env = parseEnv(prodBase());
      expect(env.isProduction).toBe(true);
      expect(env.databaseUrl).toContain("postgresql://");
      expect(env.jwtSecret).toBe(VALID_JWT_A);
      expect(env.corsOrigins).toEqual(["https://app.example.com"]);
    });

    it("fails when DATABASE_URL is missing", () => {
      expect(() =>
        parseEnv(
          prodBase({
            DATABASE_URL: "",
          })
        )
      ).toThrow(/DATABASE_URL is required in production/);
    });

    it("fails when JWT_SECRET is missing", () => {
      expect(() =>
        parseEnv(
          prodBase({
            JWT_SECRET: "",
          })
        )
      ).toThrow(/JWT_SECRET is required in production/);
    });

    it("fails when JWT_REFRESH_SECRET is missing", () => {
      expect(() =>
        parseEnv(
          prodBase({
            JWT_REFRESH_SECRET: "",
          })
        )
      ).toThrow(/JWT_REFRESH_SECRET is required in production/);
    });

    it("fails when JWT secrets are shorter than 32 characters", () => {
      expect(() =>
        parseEnv(
          prodBase({
            JWT_SECRET: "too-short",
            JWT_REFRESH_SECRET: VALID_JWT_B,
          })
        )
      ).toThrow(new RegExp(`at least ${MIN_PROD_JWT_LEN} characters`));
    });

    it("fails when JWT secrets match forbidden dev defaults", () => {
      expect(() =>
        parseEnv(
          prodBase({
            JWT_SECRET: "dev-secret-change-in-production",
            JWT_REFRESH_SECRET: VALID_JWT_B,
          })
        )
      ).toThrow(/must not use dev or example placeholder/);

      expect(() =>
        parseEnv(
          prodBase({
            JWT_SECRET: VALID_JWT_A,
            JWT_REFRESH_SECRET: "change-this-refresh-in-production",
          })
        )
      ).toThrow(/must not use dev or example placeholder/);
    });

    it("fails when JWT_SECRET and JWT_REFRESH_SECRET are identical", () => {
      const same = "c".repeat(MIN_PROD_JWT_LEN);
      expect(() =>
        parseEnv(
          prodBase({
            JWT_SECRET: same,
            JWT_REFRESH_SECRET: same,
          })
        )
      ).toThrow(/must be different/);
    });

    it("fails when CORS_ORIGIN is missing", () => {
      expect(() =>
        parseEnv(
          prodBase({
            CORS_ORIGIN: "",
          })
        )
      ).toThrow(/CORS_ORIGIN is required in production/);
    });

    it.each(["*", "http://app.example.com", "https://app.example.com/path", "https://app.example.com/"])(
      "rejects unsafe or non-origin CORS value %s",
      (origin) => {
        expect(() => parseEnv(prodBase({ CORS_ORIGIN: origin }))).toThrow(/CORS_ORIGIN/);
      }
    );

    it("rejects placeholder operational secrets", () => {
      expect(() =>
        parseEnv(
          prodBase({
            CRON_SECRET: "change_me_to_a_long_random_secret",
            ENCRYPTION_KEY: "change_me_to_required_format",
          })
        )
      ).toThrow(/placeholder/);
    });

    it("aggregates multiple production errors in one message", () => {
      try {
        parseEnv({ NODE_ENV: "production" });
        expect.fail("expected parseEnv to throw");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).toContain("DATABASE_URL");
        expect(message).toContain("JWT_SECRET");
        expect(message).toContain("CORS_ORIGIN");
      }
    });
  });
});

describe("formatEnvValidationError", () => {
  it("formats Zod issues as a bullet list", () => {
    const error = new z.ZodError([
      {
        code: "custom",
        path: ["PORT"],
        message: "Expected number",
      },
    ]);
    const formatted = formatEnvValidationError(error);
    expect(formatted).toContain("Invalid environment configuration:");
    expect(formatted).toContain("PORT: Expected number");
  });
});
