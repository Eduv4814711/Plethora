import { describe, expect, it } from "vitest";
import {
  evaluateExpiryState,
  getDocumentDefinition,
  getRequiredRulesForEmployee,
  DOCUMENT_TAXONOMY,
  DOCUMENT_CATEGORIES,
} from "../compliance.service.js";

describe("Document Taxonomy & Compliance Rules", () => {
  it("provides complete taxonomy covering all mandatory categories", () => {
    expect(DOCUMENT_TAXONOMY.length).toBeGreaterThanOrEqual(30);
    expect(DOCUMENT_CATEGORIES.PERSONAL).toBeDefined();
    expect(DOCUMENT_CATEGORIES.EMPLOYMENT).toBeDefined();
    expect(DOCUMENT_CATEGORIES.PAYROLL_STATUTORY).toBeDefined();
    expect(DOCUMENT_CATEGORIES.LEAVE_MEDICAL).toBeDefined();
    expect(DOCUMENT_CATEGORIES.DISCIPLINARY).toBeDefined();
    expect(DOCUMENT_CATEGORIES.EXIT).toBeDefined();
    expect(DOCUMENT_CATEGORIES.PSIRA).toBeDefined();
    expect(DOCUMENT_CATEGORIES.SPECIALIST_SECURITY).toBeDefined();
    expect(DOCUMENT_CATEGORIES.FIREARM).toBeDefined();
    expect(DOCUMENT_CATEGORIES.QUALIFICATIONS).toBeDefined();
  });

  it("marks medical, disciplinary, and firearm categories as sensitive", () => {
    expect(DOCUMENT_CATEGORIES.LEAVE_MEDICAL.isSensitive).toBe(true);
    expect(DOCUMENT_CATEGORIES.DISCIPLINARY.isSensitive).toBe(true);
    expect(DOCUMENT_CATEGORIES.FIREARM.isSensitive).toBe(true);
    expect(DOCUMENT_CATEGORIES.PERSONAL.isSensitive).toBeFalsy();
    expect(DOCUMENT_CATEGORIES.EMPLOYMENT.isSensitive).toBeFalsy();
  });

  it("correctly identifies document definitions and defaults", () => {
    const psiraReg = getDocumentDefinition("psira_registration_certificate");
    expect(psiraReg.defaultAuthority).toBe("PSiRA");
    expect(psiraReg.category).toBe("PSIRA");

    const firearm = getDocumentDefinition("firearm_competency_certificate");
    expect(firearm.isSensitive).toBe(true);
    expect(firearm.requiresExpiry).toBe(true);

    const saId = getDocumentDefinition("sa_id");
    expect(saId.requiresExpiry).toBe(false);
  });

  describe("evaluateExpiryState", () => {
    it("evaluates non-expiring documents", () => {
      const result = evaluateExpiryState(null, true);
      expect(result.state).toBe("NO_EXPIRY");
      expect(result.hasExpired).toBe(false);
      expect(result.isExpiringSoon).toBe(false);
      expect(result.label).toBe("Does not expire");
    });

    it("evaluates expired documents", () => {
      const pastDate = new Date(Date.now() - 5 * 24 * 3600_000);
      const result = evaluateExpiryState(pastDate, false);
      expect(result.state).toBe("EXPIRED");
      expect(result.hasExpired).toBe(true);
      expect(result.isExpiringSoon).toBe(false);
      expect(result.label).toContain("Expired");
    });

    it("evaluates documents expiring in under 7 days", () => {
      const in5Days = new Date(Date.now() + 5 * 24 * 3600_000);
      const result = evaluateExpiryState(in5Days, false);
      expect(result.state).toBe("EXPIRING_SOON_7D");
      expect(result.hasExpired).toBe(false);
      expect(result.isExpiringSoon).toBe(true);
    });

    it("evaluates documents expiring in 25 days", () => {
      const in25Days = new Date(Date.now() + 25 * 24 * 3600_000);
      const result = evaluateExpiryState(in25Days, false);
      expect(result.state).toBe("EXPIRING_SOON_30D");
      expect(result.hasExpired).toBe(false);
      expect(result.isExpiringSoon).toBe(true);
    });

    it("evaluates documents expiring in 180 days as valid", () => {
      const in180Days = new Date(Date.now() + 180 * 24 * 3600_000);
      const result = evaluateExpiryState(in180Days, false);
      expect(result.state).toBe("VALID");
      expect(result.hasExpired).toBe(false);
      expect(result.isExpiringSoon).toBe(false);
      expect(result.label).toContain("Expires in");
    });
  });

  describe("getRequiredRulesForEmployee", () => {
    it("generates rules for general office employee", () => {
      const rules = getRequiredRulesForEmployee({
        employeeType: "general",
        jobRole: "HR Assistant",
      });

      const types = rules.map((r) => r.type);
      expect(types).toContain("sa_id");
      expect(types).toContain("employment_contract");
      expect(types).toContain("bank_details_proof");
      expect(types).not.toContain("psira_registration_certificate");
      expect(types).not.toContain("firearm_competency_certificate");
    });

    it("generates rules for standard security officer with grade C", () => {
      const rules = getRequiredRulesForEmployee({
        employeeType: "security_officer",
        jobRole: "Security Guard",
        psiraGrade: "C",
      });

      const types = rules.map((r) => r.type);
      expect(types).toContain("sa_id");
      expect(types).toContain("employment_contract");
      expect(types).toContain("bank_details_proof");
      expect(types).toContain("psira_registration_certificate");
      expect(types).toContain("psira_card");
      expect(types).toContain("psira_grade_c");
      expect(types).not.toContain("firearm_competency_certificate");
    });

    it("generates firearm requirement for armed response officer", () => {
      const rules = getRequiredRulesForEmployee({
        employeeType: "security_officer",
        jobRole: "Armed Reaction Officer",
        psiraGrade: "B",
      });

      const types = rules.map((r) => r.type);
      expect(types).toContain("firearm_competency_certificate");
      expect(types).toContain("psira_grade_b");
    });

    it("generates driver requirement for driver / reaction roles", () => {
      const rules = getRequiredRulesForEmployee({
        employeeType: "security_officer",
        jobRole: "Patrol Driver",
      });

      const types = rules.map((r) => r.type);
      expect(types).toContain("drivers_licence");
    });
  });
});

