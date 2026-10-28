export { createSql, type Sql } from "./client.js";
export { parseDatabaseUrl } from "./env.js";
export {
  type AppendEventInput,
  appendEvent,
  checkStoredChainStructure,
  type StoredFundEvent,
  streamFundEvents,
  verifyStoredChain,
} from "./events.js";
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
  type FundEventRow,
  type FundNotificationDailyUsageRow,
  type FundRow,
  fundEventRowSchema,
  fundNotificationDailyUsageRowSchema,
  fundRowSchema,
  type IdempotencyKeyRow,
  idempotencyKeyRowSchema,
  type MembershipRow,
  membershipRowSchema,
  type NotificationDeadLetterRow,
  type NotificationOutboxRow,
  notificationDeadLetterRowSchema,
  notificationOutboxRowSchema,
  type OrgRow,
  orgRowSchema,
  type PseudonymRow,
  pseudonymRowSchema,
  type UserNotificationPreferencesRow,
  type UserRow,
  userNotificationPreferencesRowSchema,
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
