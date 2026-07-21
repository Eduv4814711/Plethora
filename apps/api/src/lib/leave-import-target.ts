export type DatabaseTarget = {
  host: string;
  port: string;
  database: string;
};

type ConfirmDatabaseTargetInput = {
  rawDatabaseUrl: string | undefined;
  apply: boolean;
  expectedHost?: string;
  expectedPort?: string;
  expectedDatabase?: string;
};

export function parseDatabaseTarget(rawDatabaseUrl: string | undefined): DatabaseTarget {
  const value = rawDatabaseUrl?.trim();
  if (!value) {
    throw new Error("DATABASE_URL is required. Refusing to use an implicit or fallback database target.");
  }

  let parsedDatabaseUrl: URL;
  try {
    parsedDatabaseUrl = new URL(value);
  } catch {
    throw new Error("DATABASE_URL is not a valid URL.");
  }

  if (!["postgres:", "postgresql:"].includes(parsedDatabaseUrl.protocol)) {
    throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
  }

  let database: string;
  try {
    database = decodeURIComponent(parsedDatabaseUrl.pathname.replace(/^\//, ""));
  } catch {
    throw new Error("DATABASE_URL contains an invalid encoded database name.");
  }

  const target = {
    host: parsedDatabaseUrl.hostname,
    port: parsedDatabaseUrl.port || "5432",
    database,
  };
  if (!target.host || !target.database) {
    throw new Error("DATABASE_URL must include an explicit host and database name.");
  }

  return target;
}

export function confirmDatabaseTarget({
  rawDatabaseUrl,
  apply,
  expectedHost,
  expectedPort,
  expectedDatabase,
}: ConfirmDatabaseTargetInput): DatabaseTarget {
  const target = parseDatabaseTarget(rawDatabaseUrl);
  if (!apply) return target;

  if (!expectedHost || !expectedPort || !expectedDatabase) {
    throw new Error(
      "Apply requires --expected-host, --expected-port, and --expected-database so the production target is confirmed explicitly."
    );
  }
  if (!/^\d+$/.test(expectedPort) || Number(expectedPort) < 1 || Number(expectedPort) > 65535) {
    throw new Error("--expected-port must be an integer from 1 to 65535.");
  }
  if (
    expectedHost.toLowerCase() !== target.host.toLowerCase() ||
    expectedPort !== target.port ||
    expectedDatabase !== target.database
  ) {
    throw new Error(
      `Database target mismatch. Connected target is ${target.host}:${target.port}/${target.database}; check the expected target flags.`
    );
  }

  return target;
}
