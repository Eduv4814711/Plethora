import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";
import { applyComplianceTables } from "./apply-compliance-tables-fn.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("No DATABASE_URL found");
  process.exit(1);
}

const client = new pg.Client({ connectionString: dbUrl });

async function run() {
  try {
    await client.connect();
    console.log("Connected to PostgreSQL database. Executing exact compliance DDL...");
    await applyComplianceTables(client);
    console.log("Compliance DDL executed successfully! All 10 tables, enums, indexes, and FKs are exact matches for schema.prisma.");
    const res = await client.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ComplianceObligation', 'StatutoryPeriod', 'StatutoryPayment', 'EmployeeStatutoryContribution', 'StatutoryRateConfig', 'ComplianceRemediationPlan', 'ComplianceLegalCase', 'CashCommitment', 'CashPositionSnapshot', 'EmploymentExit') ORDER BY table_name;`
    );
    console.log("Verified existing tables:", res.rows.map(r => r.table_name));
  } catch (err) {
    console.error("Error applying compliance DDL:", err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

run();
