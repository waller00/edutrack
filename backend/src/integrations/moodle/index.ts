export { isMoodleIntegrationEnabled } from "./client.js";
export { getMoodleHealthStatus, probeMoodleConnection } from "./health.js";
export type { MoodleHealthStatus } from "./health.js";
export {
  enqueueUserUpsert,
  enqueueStudentUserUpsert,
  processOutboxOnce,
  releaseStaleLocks,
} from "./outbox.js";
export {
  ensureStudentMoodleAccount,
  getStudentMoodleVerifications,
  resendStudentMoodleWelcome,
  syncMoodleStudentById,
  type MoodleStudentVerification,
  type MoodleStudentVerificationState,
  type StudentAccountInput,
} from "./student-users.js";
export { reconcileMoodle } from "./reconcile.js";
export type { ReconcileSummary } from "./reconcile.js";
export {
  syncMoodleUser,
  syncMoodleUserById,
  type MoodleSyncUserInput,
} from "./users.js";
