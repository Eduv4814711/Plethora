import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const SECURITY_GUARDS = [
  { firstName: "Thabo", lastName: "Mbeki", idNumber: "9001015001087", phone: "+27821234567", email: "thabo.mbeki@example.com", status: "active" as const, hourlyRate: 38.02, securityServiceType: "guarding" },
  { firstName: "Sipho", lastName: "Nkosi", idNumber: "8803156002091", phone: "+27831234568", email: "sipho.nkosi@example.com", status: "active" as const, hourlyRate: 34.94, securityServiceType: "guarding" },
  { firstName: "Themba", lastName: "Dlamini", idNumber: "9205225003082", phone: "+27841234569", email: "themba.dlamini@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "patrols" },
  { firstName: "Bongani", lastName: "Khumalo", idNumber: "8506184004083", phone: "+27851234570", email: "bongani.khumalo@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "guarding" },
  { firstName: "Nomsa", lastName: "Sithole", idNumber: "9402031005084", phone: "+27861234571", email: "nomsa.sithole@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "access_control" },
  { firstName: "Jabu", lastName: "Ndlovu", idNumber: "9607156006085", phone: "+27871234572", email: "jabu.ndlovu@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "guarding" },
  { firstName: "Lerato", lastName: "Molefe", idNumber: "8912203007086", phone: "+27881234573", email: "lerato.molefe@example.com", status: "active" as const, hourlyRate: 38.02, securityServiceType: "close_protection" },
  { firstName: "Mandla", lastName: "Zulu", idNumber: "8704095008087", phone: "+27891234574", email: "mandla.zulu@example.com", status: "active" as const, hourlyRate: 34.94, securityServiceType: "reaction" },
  { firstName: "Zanele", lastName: "Naidoo", idNumber: "9107112009088", phone: "+27801234575", email: "zanele.naidoo@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "control_room" },
  { firstName: "Sello", lastName: "Modise", idNumber: "9308146000089", phone: "+27811234576", email: "sello.modise@example.com", status: "active" as const, hourlyRate: 34.94, securityServiceType: "guarding" },
  { firstName: "Precious", lastName: "Mahlangu", idNumber: "9503174001090", phone: "+27821234577", email: "precious.mahlangu@example.com", status: "active" as const, hourlyRate: 30.47, securityServiceType: "monitoring" },
  { firstName: "Kagiso", lastName: "Sekhoto", idNumber: "8809205002091", phone: "+27831234578", email: "kagiso.sekhoto@example.com", status: "active" as const, hourlyRate: 38.02, securityServiceType: "guarding" },
  { firstName: "Thandi", lastName: "Pillay", idNumber: "9001231003092", phone: "+27841234579", email: "thandi.pillay@example.com", status: "training" as const, hourlyRate: 30.47, securityServiceType: "guarding" },
  { firstName: "Mpho", lastName: "Radebe", idNumber: "9204266004093", phone: "+27851234580", email: "mpho.radebe@example.com", status: "training" as const, hourlyRate: 30.47, securityServiceType: "patrols" },
  { firstName: "Lucky", lastName: "Govender", idNumber: "9407293005094", phone: "+27861234581", email: "lucky.govender@example.com", status: "training" as const, hourlyRate: 30.47, securityServiceType: "guarding" },
  { firstName: "Ntombi", lastName: "Cele", idNumber: "8601025006095", phone: "+27871234582", email: "ntombi.cele@example.com", status: "hired" as const, hourlyRate: 34.94, securityServiceType: "close_protection" },
  { firstName: "Sello", lastName: "Mokoena", idNumber: "9805054007096", phone: "+27881234583", email: "sello.mokoena@example.com", status: "hired" as const, hourlyRate: 30.47, securityServiceType: "guarding" },
];

const OFFICE_STAFF = [
  { firstName: "Sarah", lastName: "van der Merwe", idNumber: "8503102008087", phone: "+27891234590", email: "sarah.vandermerwe@example.com", status: "active" as const, monthlySalary: 32000, occupation: "HR & Payroll Manager" },
  { firstName: "David", lastName: "Botha", idNumber: "8807156009098", phone: "+27801234591", email: "david.botha@example.com", status: "active" as const, monthlySalary: 28000, occupation: "Operations Administrator" },
  { firstName: "Naledi", lastName: "Molefi", idNumber: "9502183000099", phone: "+27811234592", email: "naledi.molefi@example.com", status: "active" as const, monthlySalary: 25000, occupation: "Receptionist" },
];

function baseLabourLawFields(idNumber: string, gender: string, dateOfBirth: Date, commencementDate: Date, occupation: string) {
  return {
    dateOfBirth,
    gender,
    physicalAddress: "123 Church Street, Johannesburg, 2000",
    postalAddress: "PO Box 456, Johannesburg, 2000",
    postalCode: "2000",
    taxNumber: idNumber,
    bankName: "FNB",
    bankAccountNumber: `62${idNumber.slice(-9)}`,
    bankBranchCode: "250655",
    commencementDate,
    occupation,
    placeOfWork: "Quick Bopha Security HQ",
    ordinaryHours: "45 hours/week",
    ordinaryDays: "Mon-Fri",
    payFrequency: "monthly",
    leaveEntitlement: "21 days per annum",
    noticePeriod: "1 month",
    previousService: "None",
  };
}

function basePsiraFields(psiraNum: string, securityServiceType: string, nextOfKin1: string, nextOfKin1Phone: string, nextOfKin2: string, nextOfKin2Phone: string) {
  return {
    psiraNumber: psiraNum,
    psiraExpiryDate: new Date("2026-12-31"),
    securityServiceType,
    nextOfKin1Name: nextOfKin1,
    nextOfKin1Phone,
    nextOfKin2Name: nextOfKin2,
    nextOfKin2Phone,
    nextOfKin3Name: null,
    nextOfKin3Phone: null,
    residedOutsideSA: false,
    militaryPoliceService: false,
    criminalInvestigation: false,
    mentallyUnstable: false,
    trainingCompleted: true,
  };
}

function parseIdToDob(idNumber: string): Date {
  const yy = parseInt(idNumber.slice(0, 2), 10);
  const mm = parseInt(idNumber.slice(2, 4), 10) - 1;
  const dd = parseInt(idNumber.slice(4, 6), 10);
  const year = yy < 30 ? 2000 + yy : 1900 + yy;
  return new Date(year, mm, dd);
}

function parseIdToGender(idNumber: string): string {
  const seq = parseInt(idNumber.slice(6, 10), 10);
  return seq < 5000 ? "F" : "M";
}

async function main() {
  let company = await prisma.company.findFirst({
    where: { name: "Quick Bopha Security" },
  });

  if (!company) {
    company = await prisma.company.create({
      data: { name: "Quick Bopha Security" },
    });
  }

  const existingUser = await prisma.user.findFirst({
    where: { email: "admin@quickbopha.com", companyId: company.id },
  });

  if (!existingUser) {
    const passwordHash = await bcrypt.hash("admin123", 12);
    await prisma.user.create({
      data: {
        companyId: company.id,
        name: "Admin User",
        email: "admin@quickbopha.com",
        passwordHash,
        role: "admin",
      },
    });
  }

  const commencementBase = new Date("2024-01-15");
  let created = 0;

  for (let i = 0; i < SECURITY_GUARDS.length; i++) {
    const g = SECURITY_GUARDS[i];
    const existing = await prisma.employee.findFirst({
      where: { companyId: company.id, idNumber: g.idNumber },
    });
    if (existing) continue;

    const dateOfBirth = parseIdToDob(g.idNumber);
    const gender = parseIdToGender(g.idNumber);
    const commencement = new Date(commencementBase);
    commencement.setMonth(commencement.getMonth() + i);

    const overtimeRate = g.hourlyRate * 1.5;

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'seed.ts:guardCreate',message:'Seed guard dates before create',data:{idNumber:g.idNumber,dateOfBirth:dateOfBirth?.toISOString?.(),commencement:commencement?.toISOString?.()},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    await prisma.employee.create({
      data: {
        companyId: company.id,
        firstName: g.firstName,
        lastName: g.lastName,
        idNumber: g.idNumber,
        phone: g.phone,
        email: g.email,
        status: g.status,
        employeeType: "security",
        hourlyRate: g.hourlyRate,
        overtimeRate,
        ...baseLabourLawFields(g.idNumber, gender, dateOfBirth, commencement, "Security Officer"),
        ...basePsiraFields(
          `1234${String(i + 1).padStart(3, "0")}`,
          g.securityServiceType,
          `${g.firstName} Family`,
          `+2783${String(1234567 + i).slice(-7)}`,
          `${g.lastName} Relative`,
          `+2784${String(3334444 + i).slice(-7)}`
        ),
      },
    });
    created++;
  }

  for (let i = 0; i < OFFICE_STAFF.length; i++) {
    const o = OFFICE_STAFF[i];
    const existing = await prisma.employee.findFirst({
      where: { companyId: company.id, idNumber: o.idNumber },
    });
    if (existing) continue;

    const dateOfBirth = parseIdToDob(o.idNumber);
    const gender = parseIdToGender(o.idNumber);
    const commencement = new Date(commencementBase);
    commencement.setMonth(commencement.getMonth() + SECURITY_GUARDS.length + i);

    // #region agent log
    fetch('http://127.0.0.1:7244/ingest/f56a901b-0402-4f99-950f-9d91bcf073da',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'seed.ts:officeCreate',message:'Seed office dates before create',data:{idNumber:o.idNumber,dateOfBirth:dateOfBirth?.toISOString?.(),commencement:commencement?.toISOString?.()},timestamp:Date.now(),hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    await prisma.employee.create({
      data: {
        companyId: company.id,
        firstName: o.firstName,
        lastName: o.lastName,
        idNumber: o.idNumber,
        phone: o.phone,
        email: o.email,
        status: o.status,
        employeeType: "office",
        monthlySalary: o.monthlySalary,
        ...baseLabourLawFields(o.idNumber, gender, dateOfBirth, commencement, o.occupation),
      },
    });
    created++;
  }

  console.log("Seed completed: company, admin user, and employees created");
  console.log(`Created ${created} new employees (${SECURITY_GUARDS.length} guards, ${OFFICE_STAFF.length} office staff)`);
  console.log("Login: admin@quickbopha.com / admin123");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
