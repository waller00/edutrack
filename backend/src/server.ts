import "./instrument.js";
import http from "node:http";
import app from "./app.js";
import { prisma } from "./db/prisma.js";
import { ensureDefaultSchoolYear } from "./services/school-year-service.js";
import { ensureDefaultProfilePermissionsIfNeeded } from "./identity/profile-permissions-repository.js";
import { scanAndCreateTeacherNoShowIncidents } from "./services/attendance-incidents.js";
import { getAttendanceOperationalSettings } from "./config/system-settings.js";

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
])
  .finally(() => {
    const host = "0.0.0.0";
    const server = http.createServer(app);
    server.listen(port, host, () => {
      console.log(`🚀 Auth-service corriendo en HTTP (puerto ${port})`);
      console.log(`   ZKTeco iClock ADMS: http://${host}:${port}/iclock/`);
    });
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
