import { describe, expect, it } from "vitest";
import { buildPayslipTemplateData } from "../payslip-data.service.js";

describe("payslip-data.service", () => {
  it("buildPayslipTemplateData correctly maps leaveBreakdown and hourly rates", () => {
    const periodStart = new Date("2026-06-01T00:00:00.000Z");
    const periodEnd = new Date("2026-06-30T00:00:00.000Z");

    const templateData = buildPayslipTemplateData({
      payrollItem: {
        id: "item-1",
        companyId: "comp-1",
        payrollRunId: "run-1",
        employeeId: "emp-1",
        hoursWorked: 160 as any,
        overtimeHours: 10 as any,
        basePay: 15000 as any,
        overtimePay: 1000 as any,
        grossPay: 16000 as any,
        deductions: 500 as any,
        netPay: 15500 as any,
        paymentStatus: "PENDING",
        leaveDays: 2 as any,
        createdAt: new Date(),
        updatedAt: new Date(),
        employee: {
          id: "emp-1",
          companyId: "comp-1",
          employeeNumber: "EMP001",
          firstName: "John",
          lastName: "Doe",
          status: "active",
          employeeType: "general",
          commencementDate: new Date("2023-01-01"),
          dateOfBirth: new Date("1990-05-15"),
          jobRole: "Security Guard",
          occupation: null,
          hourlyRate: 50 as any,
          monthlySalary: 15000 as any,
          psiraRegistrationNumber: "PS12345",
          idNumber: "9005155000080",
          maritalStatus: "Single",
          gender: "Male",
          bankName: "FNB",
          bankAccountNumber: "1234567890",
          bankBranchCode: "250655",
          createdAt: new Date(),
          updatedAt: new Date(),
          address: null,
          contactNumber: null,
          email: null,
          gradeId: null,
          leaveBalance: 15 as any,
          sickLeaveBalance: 30 as any,
          taxNumber: null,
          uifNumber: null,
        } as any,
        payslip: null,
      },
      company: {
        id: "comp-1",
        name: "Acme Security",
        legalName: "Acme Security Pty Ltd",
        address: "123 Main St, Cape Town",
        registrationNumber: "2020/123456/07",
        taxNumber: "9876543210",
        uifReference: "U123456",
        phone: "+27 21 000 0000",
        fax: null,
        email: "info@acme.co.za",
        psiraRegistration: "PSIRA999",
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any,
      periodStart,
      periodEnd,
      siteName: "Alpha Site",
      siteGradeName: "Grade B",
      siteHourlyRate: 65,
      timesheet: {
        basicHours: 160,
        overtimeHours: 10,
        sundayHours: 8,
        publicHolidayHours: 0,
        leaveDays: 2,
      },
      leaveBreakdown: {
        annualHours: 16,
        sickHours: 8,
      },
    });

    expect(templateData.employerName).toBe("Acme Security");
    expect(templateData.employeeName).toBe("John Doe");
    expect(templateData.payPeriod).toBe("1 Jun 2026 – 30 Jun 2026");
    expect(templateData.payDate).toBe("30 Jun 2026");
    expect(templateData.payslipDate).toBe("30 Jun 2026");
    expect(templateData.annualLeaveHours).toBe(16);
    expect(templateData.sickLeaveHours).toBe(8);
    expect(templateData.normalHoursWorked).toBe(160);
    expect(templateData.overtimeHours).toBe(10);
    expect(templateData.sundayHours).toBe(8);
    expect(templateData.totalHoursWorked).toBe(178);
    expect(templateData.jobGradeRate).toBe("R 65.00/hr");
    expect(templateData.netPay).toBe(15500);
  });
});
