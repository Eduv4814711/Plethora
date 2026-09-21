import { describe, expect, it, vi } from "vitest";
import { findEmployeeByPhone } from "../services/handler.service.js";

vi.mock("../../lib/prisma.js", () => ({
  prisma: {
    employee: {
      findMany: vi.fn(),
    },
  },
}));

describe("WhatsApp Multi-Tenant Isolation & Phone Lookup", () => {
  it("resolves single active employee with matching phone", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      {
        id: "emp-1",
        companyId: "company-a",
        firstName: "Alice",
        lastName: "Smith",
        phone: "0821234567",
      },
    ] as any);

    const result = await findEmployeeByPhone("27821234567");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("emp-1");
    expect(result?.companyId).toBe("company-a");
  });

  it("never guesses when same normalized phone exists across multiple tenants or employees", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    // Phone exists in both company-a and company-b
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      {
        id: "emp-1",
        companyId: "company-a",
        firstName: "Alice",
        lastName: "Smith",
        phone: "0821234567",
      },
      {
        id: "emp-2",
        companyId: "company-b",
        firstName: "Bob",
        lastName: "Jones",
        phone: "+27 82 123 4567",
      },
    ] as any);

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await findEmployeeByPhone("27821234567");

    // Must safely refuse to guess tenant
    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Ambiguous phone number")
    );
    warnSpy.mockRestore();
  });

  it("returns null for unregistered phone number", async () => {
    const { prisma } = await import("../../lib/prisma.js");
    vi.mocked(prisma.employee.findMany).mockResolvedValueOnce([
      {
        id: "emp-1",
        companyId: "company-a",
        firstName: "Alice",
        lastName: "Smith",
        phone: "0829999999",
      },
    ] as any);

    const result = await findEmployeeByPhone("27821234567");
    expect(result).toBeNull();
  });

  it("returns null for empty phone number", async () => {
    const result = await findEmployeeByPhone("");
    expect(result).toBeNull();
  });
});
