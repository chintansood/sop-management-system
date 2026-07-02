import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS LOOKS DIFFERENT FROM MOST PRISMA TUTORIALS
 * ─────────────────────────────────────────────────────────────────────────
 * Prisma 7 removed its built-in Rust connection engine. PrismaClient no
 * longer connects to the database on its own just by reading
 * DATABASE_URL — you must explicitly construct a "driver adapter" (here,
 * @prisma/adapter-pg, which wraps the standard `pg` Postgres driver) and
 * pass it into the PrismaClient constructor.
 *
 * This is NOT optional in Prisma 7 — `new PrismaClient()` with no
 * arguments will throw PrismaClientInitializationError.
 *
 * We also explicitly load .env here via `import "dotenv/config"` at the
 * top of this file. Prisma 7 does not auto-load .env files into
 * process.env the way older versions did — your prisma.config.ts loads
 * it for CLI commands (migrate, studio, generate), but this seed script
 * runs independently via ts-node, so it needs its own dotenv import.
 * ─────────────────────────────────────────────────────────────────────────
 */

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

/**
 * ─────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE SEED SCRIPT EXISTS
 * ─────────────────────────────────────────────────────────────────────────
 * You can't test login, role checks, or assignments against an empty
 * database. This script creates a small, realistic set of rows so you
 * (and later, your auth module) have real accounts to log in as.
 *
 * This is meant to be run repeatedly during development — every time you
 * reset your database, you re-run this to get back to a known starting
 * state. That's why it's written to be safe to run more than once
 * (see the "upsert" explanation below).
 * ─────────────────────────────────────────────────────────────────────────
 */

// All seed accounts share this password for convenience during development.
// NEVER do this in a real/production seed — this is strictly a local dev
// convenience so you don't need to remember 6 different passwords while
// testing your auth module by hand.
const DEV_PASSWORD = "Password123!";

async function main() {
  console.log("🌱 Starting seed...");

  // Hash the shared dev password once, up front. Hashing is intentionally
  // slow (that's the whole point of bcrypt — it resists brute-forcing),
  // so we don't want to repeat this work 6 times for 6 identical passwords.
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 10);

  // -------------------------------------------------------------------------
  // DEPARTMENTS
  // -------------------------------------------------------------------------
  // upsert = "update if it exists, insert if it doesn't." This is what
  // makes the script safe to re-run: running it twice won't create
  // duplicate "Science" departments, it'll just leave the existing one
  // as-is on the second run.
  const science = await prisma.department.upsert({
    where: { name: "Science" },
    update: {},
    create: { name: "Science" },
  });

  const admin_dept = await prisma.department.upsert({
    where: { name: "Administration" },
    update: {},
    create: { name: "Administration" },
  });

  const transport = await prisma.department.upsert({
    where: { name: "Transport" },
    update: {},
    create: { name: "Transport" },
  });

  console.log("✅ Departments created:", [science.name, admin_dept.name, transport.name]);

  // -------------------------------------------------------------------------
  // USERS
  // -------------------------------------------------------------------------
  // Note: User.email is @unique in the schema, so we upsert on email too —
  // same reasoning as departments above.

  const superAdmin = await prisma.user.upsert({
    where: { email: "superadmin@school.test" },
    update: {},
    create: {
      fullName: "Asha Mehta",
      email: "superadmin@school.test",
      passwordHash,
      role: "SUPER_ADMIN",
      staffType: null, // Super Admin isn't "teaching" or "non-teaching" staff
    },
  });

  const admin = await prisma.user.upsert({
    where: { email: "admin@school.test" },
    update: {},
    create: {
      fullName: "Rahul Verma",
      email: "admin@school.test",
      passwordHash,
      role: "ADMIN",
      staffType: "NON_TEACHING",
      departmentId: admin_dept.id,
    },
  });

  const deptHead = await prisma.user.upsert({
    where: { email: "depthead.science@school.test" },
    update: {},
    create: {
      fullName: "Dr. Priya Nair",
      email: "depthead.science@school.test",
      passwordHash,
      role: "DEPT_HEAD",
      staffType: "TEACHING",
      departmentId: science.id,
    },
  });

  // Now that deptHead exists, make her the actual head of Science.
  // This is a separate step because the User has to exist before we can
  // point Department.headUserId at them.
  await prisma.department.update({
    where: { id: science.id },
    data: { headUserId: deptHead.id },
  });

  const teacher1 = await prisma.user.upsert({
    where: { email: "teacher1@school.test" },
    update: {},
    create: {
      fullName: "Kavita Rao",
      email: "teacher1@school.test",
      passwordHash,
      role: "TEACHING_STAFF",
      staffType: "TEACHING",
      departmentId: science.id,
    },
  });

  const teacher2 = await prisma.user.upsert({
    where: { email: "teacher2@school.test" },
    update: {},
    create: {
      fullName: "Sanjay Iyer",
      email: "teacher2@school.test",
      passwordHash,
      role: "TEACHING_STAFF",
      staffType: "TEACHING",
      departmentId: science.id,
    },
  });

  const driver1 = await prisma.user.upsert({
    where: { email: "driver1@school.test" },
    update: {},
    create: {
      fullName: "Manoj Kumar",
      email: "driver1@school.test",
      passwordHash,
      role: "NON_TEACHING_STAFF",
      staffType: "NON_TEACHING",
      departmentId: transport.id,
    },
  });

  console.log("✅ Users created:", [
    superAdmin.email,
    admin.email,
    deptHead.email,
    teacher1.email,
    teacher2.email,
    driver1.email,
  ]);

  console.log("\n🌱 Seed complete.");
  console.log(`\nAll seeded accounts use the password: ${DEV_PASSWORD}`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    // Always disconnect, even if main() threw — otherwise the script
    // hangs instead of exiting cleanly.
    await prisma.$disconnect();
  });