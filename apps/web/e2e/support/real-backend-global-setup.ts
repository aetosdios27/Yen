import { createSql, seedDevDatabase } from "@yen/db";

const SEED_FUND_ID = "01940000-0000-7000-8000-000000000002";

/** Seed a disposable real-backend database, trusting the seeded mock sessions. */
export default async function globalSetup(): Promise<void> {
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "E2E_BACKEND=real requires E2E_DATABASE_URL to point at a disposable Postgres database",
    );
  }
  const sql = createSql(databaseUrl);
  try {
    await sql.unsafe("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    const result = await seedDevDatabase(sql);
    await sql`
      INSERT INTO trusted_devices (session_id, user_id, trusted_at, last_active_at, idle_expires_at)
      SELECT id, user_id, NOW(), NOW(), NOW() + interval '30 days'
      FROM sessions
      WHERE revoked_at IS NULL AND expires_at > NOW()
    `;
    await sql`
      UPDATE funds
      SET payee_vpa = 'iitd.robotics@sbi', payee_name = 'IIT Delhi Robotics Club',
        policy_json = jsonb_set(
          COALESCE(policy_json::jsonb, '{}'::jsonb),
          '{objectionWindowHours}',
          '0'
        )
      WHERE id = ${SEED_FUND_ID}
    `;
    process.stdout.write(
      `e2e real backend seeded: fund ${result.fund.id}, ${result.users.length} sessions, ${result.eventCount} events\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
