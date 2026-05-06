import app from "./app.js";
import { scanAndCreateTeacherNoShowIncidents } from "./services/attendance-incidents.js";
import { getAttendanceOperationalSettings } from "./system-settings.js";

// Definimos el puerto (4000 por defecto para el backend)
const port = Number(process.env.PORT || 4000);

/**
 * En producción, el backend corre en HTTP. 
 * El certificado SSL (HTTPS) lo gestiona Cloudflare o un Proxy externo.
 * Esto evita conflictos de certificados y errores de CORS en el 'preflight'.
 */
app.listen(port, () => {
  console.log(`🚀 Auth-service corriendo en HTTP (puerto ${port})`);
});

let lastMonitorRunAt = 0;
const monitorTickMs = 30000;
setInterval(() => {
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