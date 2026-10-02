import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, userState } = vi.hoisted(() => ({
  prismaMock: {
    employee: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    client: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    incident: { findMany: vi.fn() },
    clientInvoice: { findMany: vi.fn() },
  },
  userState: {
    current: {
      sub: "u-1",
      companyId: "c-1",
      accountType: "staff",
      capabilities: {} as Record<string, string[]>,
    },
  },
}));

vi.mock("../../lib/prisma.js", () => ({
  prisma: prismaMock,
}));

vi.mock("../../middleware/auth.js", () => ({
  authMiddleware: async (request: { user?: unknown }) => {
    request.user = userState.current;
  },
}));

vi.mock("../../middleware/authorization.js", () => ({
  requireCrudCapability: () => async () => {
    // Pass-through for testing route handler capability filtering
  },
}));

import { searchRoutes } from "../search.js";

describe("GET /search", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    userState.current = {
      sub: "u-1",
      companyId: "c-1",
      accountType: "staff",
      capabilities: {},
    };

    app = Fastify();
    await app.register(searchRoutes);
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns empty arrays when query length is less than 2", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/?q=a",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      employees: [],
      sites: [],
      clients: [],
      tasks: [],
      incidents: [],
      invoices: [],
    });
    expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    expect(prismaMock.client.findMany).not.toHaveBeenCalled();
  });

  it("queries only modules the user has view capability for", async () => {
    userState.current.capabilities = {
      "/clients": ["view"],
      "/tasks": ["view"],
    };

    prismaMock.client.findMany.mockResolvedValueOnce([
      { id: "cl-1", name: "Acme Corp", contactPersonName: "John", phone: "0821234567" },
    ]);
    prismaMock.task.findMany.mockResolvedValueOnce([
      { id: "tk-1", title: "Review post check", status: "todo", priority: "high", dueDate: null },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/?q=acme",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.clients).toHaveLength(1);
    expect(body.clients[0]).toEqual({
      id: "cl-1",
      name: "Acme Corp",
      contactPerson: "John",
      phone: "0821234567",
    });
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].title).toBe("Review post check");
    expect(body.employees).toEqual([]);
    expect(body.sites).toEqual([]);
    expect(body.incidents).toEqual([]);
    expect(body.invoices).toEqual([]);

    expect(prismaMock.client.findMany).toHaveBeenCalled();
    expect(prismaMock.task.findMany).toHaveBeenCalled();
    expect(prismaMock.employee.findMany).not.toHaveBeenCalled();
    expect(prismaMock.site.findMany).not.toHaveBeenCalled();
    expect(prismaMock.incident.findMany).not.toHaveBeenCalled();
    expect(prismaMock.clientInvoice.findMany).not.toHaveBeenCalled();
  });

  it("includes idNumber search only when user has view_sensitive capability", async () => {
    userState.current.capabilities = {
      "/employees": ["view"],
    };
    prismaMock.employee.findMany.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/?q=12345" });
    let whereClause = prismaMock.employee.findMany.mock.calls[0][0].where;
    expect(whereClause.OR.some((c: { idNumber?: unknown }) => "idNumber" in c)).toBe(false);

    vi.clearAllMocks();
    userState.current.capabilities = {
      "/employees": ["view", "view_sensitive"],
    };
    prismaMock.employee.findMany.mockResolvedValue([]);

    await app.inject({ method: "GET", url: "/?q=12345" });
    whereClause = prismaMock.employee.findMany.mock.calls[0][0].where;
    expect(whereClause.OR.some((c: { idNumber?: unknown }) => "idNumber" in c)).toBe(true);
  });

  it("returns formatted invoices when user has billing capability", async () => {
    userState.current.capabilities = {
      "/payroll/billing": ["view"],
    };

    prismaMock.clientInvoice.findMany.mockResolvedValueOnce([
      {
        id: "inv-1",
        invoiceNumber: "INV-2026-001",
        totalAmount: 15000,
        status: "issued",
        dueDate: new Date("2026-09-30T00:00:00Z"),
        client: { id: "cl-1", name: "Apex Security Client" },
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/?q=INV",
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.invoices).toEqual([
      {
        id: "inv-1",
        invoiceNumber: "INV-2026-001",
        totalAmount: 15000,
        status: "issued",
        dueDate: "2026-09-30",
        client: { id: "cl-1", name: "Apex Security Client" },
      },
    ]);
  });
});
