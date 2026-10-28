export { createSql, type Sql } from "./client.js";
export { parseDatabaseUrl } from "./env.js";
export {
  assertForeignKeyIndexes,
  type ForeignKeyAllowlistEntry,
  type ForeignKeyViolation,
  findForeignKeysWithoutIndices,
  verifyAllMigrationsForeignKeys,
} from "./foreign-keys.js";
export { migrate } from "./migrate.js";
export {
  assertAllRegisteredQueryPlans,
  explainQuery,
  getTableEstimatedRowCounts,
  type PlanExplanation,
  type PlanNode,
  type PlanVerificationResult,
  type PlanViolation,
  verifyPlanNode,
} from "./query-plan.js";
export {
  type ExpectedPlanShape,
  getRegisteredHotPathQueries,
  type QueryCategory,
  type RegisteredHotPathQuery,
  registerHotPathQuery,
  type SampleQueryContext,
} from "./query-registry.js";
export {
  type FundRow,
  fundRowSchema,
  type IdempotencyKeyRow,
  idempotencyKeyRowSchema,
  type MembershipRow,
  membershipRowSchema,
  type OrgRow,
  orgRowSchema,
  type PseudonymRow,
  pseudonymRowSchema,
  type UserRow,
  userRowSchema,
} from "./rows.js";
export { type SeedStats, seedRealisticDataset } from "./seed.js";
export { uuidv7 } from "./uuidv7.js";
export {
  createWaitlistEntry,
  deleteWaitlistEntryByContact,
  normalizeWaitlistContact,
  type WaitlistEntry,
  type WaitlistRow,
  waitlistEntrySchema,
  waitlistRowSchema,
} from "./waitlist.js";
