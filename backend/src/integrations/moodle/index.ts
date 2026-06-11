export { isMoodleIntegrationEnabled } from "./client.js";
export { getMoodleHealthStatus, probeMoodleConnection } from "./health.js";
export type { MoodleHealthStatus } from "./health.js";
export {
  enqueueUserUpsert,
  processOutboxOnce,
  releaseStaleLocks,
} from "./outbox.js";
export { reconcileMoodle } from "./reconcile.js";
export type { ReconcileSummary } from "./reconcile.js";
export {
  syncMoodleUser,
  syncMoodleUserById,
  type MoodleSyncUserInput,
} from "./users.js";
