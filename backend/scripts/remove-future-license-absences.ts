/**
 * Corrección única: borra las ausencias justificadas que la conciliación de licencias creó para
 * clases que todavía no pasaron (antes se creaban al cargar la licencia).
 *
 *   npm run fix:license-future-absences              # dry-run: cuenta y no borra
 *   npm run fix:license-future-absences -- --apply    # las borra
 *
 * No toca las que tienen una justificación a mano. Cuando cada clase termine, su ausencia
 * aparece en vivo (justificada si la licencia la cubre). Es idempotente.
 */
import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { removeFutureLicenseAbsences } from "../src/services/medicalLeaveReconciliation.js";

const apply = process.argv.includes("--apply");

removeFutureLicenseAbsences(apply)
  .then((count) => {
    console.log(
      apply
        ? `[license-future-absences] Se borraron ${count} ausencias de clases que todavía no pasaron.`
        : `[license-future-absences] Dry-run: hay ${count} ausencias de clases futuras. Repetir con --apply para borrarlas.`,
    );
  })
  .catch((error) => {
    console.error("[license-future-absences]", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
