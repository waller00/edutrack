// Sentry se carga via `node --import ./dist/instrument.js` (ESM requiere esto antes que Express).
import http from "node:http";
import app from "./app.js";
import { prisma } from "./db/prisma.js";
import { ensureDefaultSchoolYear } from "./services/school-year-service.js";
import { ensureDefaultProfilePermissionsIfNeeded } from "./identity/profile-permissions-repository.js";
import { scanAndCreateTeacherNoShowIncidents } from "./services/attendance-incidents.js";
import {
  getAttendanceOperationalSettings,
  getMoodleOperationalSettings,
  parseEnvBool,
} from "./config/system-settings.js";
import { refreshInstitutionTimezoneCache } from "./config/institution-timezone.js";
import { backfillKeycloakLinks } from "./auth/keycloak-provisioning.js";
import {
  isMoodleIntegrationEnabled,
  processOutboxOnce,
  reconcileMoodle,
  releaseStaleLocks,
} from "./integrations/moodle/index.js";
import { startMetricsServer } from "./observability/metrics.js";
import { scanStudentAlerts } from "./services/student-reports/alerts-scan.js";
import {
  GRADEBOOK_PROVISION_INTERVAL_MS,
  provisionActiveSchoolYear,
  provisionLogLine,
} from "./services/gradebook/provision-scheduler.js";

// API principal (4000) y puerto ADMS ZKTeco (8081, mismo proceso HTTP)
const port = Number(process.env.PORT || 4000);
const iclockPort = Number(process.env.ZKTECO_ICLOCK_PORT || 8081);

/**
 * En producción, el backend corre en HTTP. 
 * El certificado SSL (HTTPS) lo gestiona Cloudflare o un Proxy externo.
 * Esto evita conflictos de certificados y errores de CORS en el 'preflight'.
 */
Promise.allSettled([
  ensureDefaultSchoolYear(prisma).catch((e) => console.error("[school-year] bootstrap:", e)),
  // Roles built-in + matriz canónica de permisos: se siembra una vez al arrancar
  // (antes se hacía en cada GET /auth/me, lo que escribía en BD por request).
  ensureDefaultProfilePermissionsIfNeeded().catch((e) => console.error("[permissions] bootstrap:", e)),
  refreshInstitutionTimezoneCache().catch((e) => console.error("[timezone] bootstrap:", e)),
])
  .finally(() => {
    const host = "0.0.0.0";
    const server = http.createServer(app);
    server.listen(port, host, () => {
      console.log(`🚀 Auth-service corriendo en HTTP (puerto ${port})`);
      console.log(`   ZKTeco iClock ADMS: http://${host}:${port}/iclock/`);
    });
    startMetricsServer();
    // Usuarios anteriores a `User.keycloakId`: se vinculan por email una sola vez. No bloquea el
    // arranque porque consulta la Admin API de Keycloak usuario por usuario.
    backfillKeycloakLinks()
      .then(({ linked, missing }) => {
        if (linked === 0 && missing.length === 0) return;
        console.log(`[keycloak] vínculos: ${linked} nuevos; ${missing.length} usuarios sin cuenta en Keycloak`);
        if (missing.length > 0) console.log(`[keycloak] sin cuenta: ${missing.slice(0, 20).join(", ")}`);
      })
      .catch((e) => console.error("[keycloak] relleno de vínculos:", e));
    if (iclockPort > 0 && iclockPort !== port) {
      http.createServer(app).listen(iclockPort, host, () => {
        console.log(`   ZKTeco iClock ADMS (dedicado): http://${host}:${iclockPort}/iclock/`);
        console.log(`   Alias ADMS: /cdata /getrequest → /iclock/*`);
      });
    }
  });

let lastMonitorRunAt = 0;
const monitorTickMs = 30000;
const attendanceMonitorInterval = setInterval(() => {
  void (async () => {
    const runtime = await getAttendanceOperationalSettings();
    if (!runtime.monitorEnabled) return;
    const now = Date.now();
    if (now - lastMonitorRunAt < runtime.monitorIntervalMs) return;
    lastMonitorRunAt = now;
    await scanAndCreateTeacherNoShowIncidents(new Date());
  })().catch((error) => {
    console.error("attendance monitor tick:", error);
  });
}, monitorTickMs);
attendanceMonitorInterval.unref?.();

// --- Alertas de estudiantes (bajó de boletín, faltas seguidas, 18/25 faltas) ---
// Cada hora, sobre el ciclo activo. El pase de lista además pide un escaneo al guardar
// (`scheduleStudentAlertScan`), así que el aviso de faltas no espera a la vuelta del reloj.
const studentAlertsIntervalMs = 60 * 60 * 1000;
const studentAlertsInterval = setInterval(() => {
  scanStudentAlerts().catch((error) => {
    console.error("student alerts tick:", error);
  });
}, studentAlertsIntervalMs);
studentAlertsInterval.unref?.();

// --- Libretas: se generan solas a partir del horario (RF-020) ---
// Cada hora sobre el ciclo activo, y una vez al minuto de arrancar para que un deploy no espere
// una hora. Es idempotente: sólo crea las que faltan y actualiza el titular si cambió.
function runGradeBookProvision() {
  provisionActiveSchoolYear()
    .then((summary) => {
      const line = provisionLogLine(summary);
      if (line) console.log(line);
    })
    .catch((error) => {
      console.error("gradebook provision tick:", error);
    });
}
const gradeBookProvisionInterval = setInterval(runGradeBookProvision, GRADEBOOK_PROVISION_INTERVAL_MS);
gradeBookProvisionInterval.unref?.();
const gradeBookProvisionWarmup = setTimeout(runGradeBookProvision, 60_000);
gradeBookProvisionWarmup.unref?.();

// --- Integración Moodle: outbox (reintentos) + reconciliación opcional ---
// Mismo patrón que el monitor de asistencia: un tick frecuente, gateado por SystemSettings.
let lastReconcileAt = 0;
const moodleTickMs = 30000;
const moodleAutoReconcileEnabled = parseEnvBool("MOODLE_AUTO_RECONCILE_ENABLED");
const moodleSyncInterval = setInterval(() => {
  void (async () => {
    if (!isMoodleIntegrationEnabled()) return;
    const settings = await getMoodleOperationalSettings();
    if (!settings.syncEnabled) return;

    // 1) Outbox: procesa upserts de usuario pendientes (baja latencia para el caso común).
    await releaseStaleLocks();
    await processOutboxOnce(20);

    // 2) Reconciliación completa según intervalo (cursos + inscripciones + reparación de drift).
    // Es pesada y puede depender de cursos todavía no preparados en Moodle; queda como opt-in.
    if (!moodleAutoReconcileEnabled) return;
    const now = Date.now();
    if (now - lastReconcileAt < settings.reconcileIntervalMs) return;
    lastReconcileAt = now;
    const summary = await reconcileMoodle({ syncStudents: settings.syncStudents });
    console.log(
      `[moodle] reconcile: cursos=${summary.courses} docentes=${summary.teacherEnrolments} ` +
        `docentes-revocados=${summary.teacherRevocations} ` +
        `suplentes=${summary.substituteEnrolments} revocados=${summary.substituteRevocations} ` +
        `estudiantes=${summary.studentEnrolments} sin-cuenta=${summary.studentsWithoutAccount} ` +
        `errores=${summary.errors}`,
    );
  })().catch((error) => {
    console.error("moodle sync tick:", error);
  });
}, moodleTickMs);
moodleSyncInterval.unref?.();
