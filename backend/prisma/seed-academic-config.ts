/**
 * Carga idempotente de la parametrización académica: períodos por ciclo y nivel, escalas de
 * evaluación con sus tramos, y tipos de actividad globales.
 *
 *   npx tsx prisma/seed-academic-config.ts
 *   npm run seed:academic-config
 *
 * Idempotente por `(schoolYearId, level, code)` en períodos y por `code` en escalas y tipos.
 * Reejecutar actualiza nombres y ventanas sin duplicar ni pisar lo que Dirección haya editado en
 * los campos que el seed no gobierna.
 *
 * Los períodos los planifica y escribe `src/services/academic-config/period-inheritance.ts`, que es
 * el mismo servicio que usa el alta de un ciclo: acá queda el bootstrap de una instalación nueva
 * (escalas y tipos de actividad, que son globales), no una segunda implementación de la misma cosa.
 */
import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma.js";
import {
  GLOBAL_ACTIVITY_TYPES,
  GRADING_SCALES,
} from "../src/services/academic-config/dges-defaults.js";
import { inheritAcademicPeriods } from "../src/services/academic-config/period-inheritance.js";

// `periodDate` y `periodShape` se mudaron al servicio; se re-exportan porque `remap-ebi-periods.ts`
// los importa desde acá para imponer la forma de los períodos que ya existían.
export { periodDate, periodShape } from "../src/services/academic-config/period-plan.js";

/** Cliente o transacción: `remap-ebi-periods.ts` siembra dentro de una transacción. */
type Db = Prisma.TransactionClient;

async function upsertScales(db: Db) {
  for (const scale of GRADING_SCALES) {
    const row = await db.gradingScale.upsert({
      where: { code: scale.code },
      create: {
        code: scale.code,
        name: scale.name,
        kind: scale.kind,
        minValueHundredths: scale.minValueHundredths,
        maxValueHundredths: scale.maxValueHundredths,
        decimals: scale.decimals,
        description: scale.description,
        sortOrder: scale.sortOrder,
      },
      update: { name: scale.name, description: scale.description, sortOrder: scale.sortOrder },
      select: { id: true },
    });

    for (const level of scale.levels) {
      await db.gradingScaleLevel.upsert({
        where: { scaleId_code: { scaleId: row.id, code: level.code } },
        create: { scaleId: row.id, ...level },
        update: {
          label: level.label,
          descriptor: level.descriptor,
          minValueHundredths: level.minValueHundredths,
          maxValueHundredths: level.maxValueHundredths,
          colorToken: level.colorToken,
          iconToken: level.iconToken,
          isPassing: level.isPassing,
          isAlert: level.isAlert,
          sortOrder: level.sortOrder,
        },
      });
    }
  }
  return GRADING_SCALES.length;
}

async function upsertActivityTypes(db: Db) {
  for (const type of GLOBAL_ACTIVITY_TYPES) {
    // Los globales tienen `ownerUserId = null`, y en Postgres los NULL no colisionan en una clave
    // única: `upsert` sobre `[ownerUserId, code]` insertaría duplicados. Por eso se busca primero.
    const existing = await db.activityType.findFirst({
      where: { scope: "GLOBAL", ownerUserId: null, code: type.code },
      select: { id: true },
    });
    if (existing) {
      await db.activityType.update({
        where: { id: existing.id },
        data: { name: type.name, sortOrder: type.sortOrder, category: type.category },
      });
    } else {
      await db.activityType.create({
        data: {
          code: type.code,
          name: type.name,
          sortOrder: type.sortOrder,
          category: type.category,
          scope: "GLOBAL",
        },
      });
    }
  }
  return GLOBAL_ACTIVITY_TYPES.length;
}

export async function seedAcademicConfig(db: Db = prisma) {
  const scales = await upsertScales(db);
  const activityTypes = await upsertActivityTypes(db);

  // Todos los ciclos, no sólo el activo: la libreta se consulta históricamente (RF-111) y un
  // ciclo sin períodos no podría mostrarse.
  const schoolYears = await db.schoolYear.findMany({ select: { id: true, code: true } });
  let periods = 0;
  for (const year of schoolYears) {
    // Sin ciclo origen: la plantilla reglamentaria. `REFRESH_LABELS` mantiene el contrato de arriba
    // (corrige nombre y orden de los que ya estaban, sin tocar fechas ni `isActive`).
    const summary = await inheritAcademicPeriods(
      { targetSchoolYearId: year.id, onExisting: "REFRESH_LABELS" },
      db,
    );
    periods += summary.created + summary.existing;
  }

  return { scales, activityTypes, periods, schoolYears: schoolYears.length };
}

const isDirectRun = process.argv[1]?.includes("seed-academic-config");
if (isDirectRun) {
  seedAcademicConfig()
    .then((summary) => {
      console.log(
        `[seed:academic-config] ${summary.scales} escalas, ${summary.activityTypes} tipos de actividad, ` +
          `${summary.periods} períodos en ${summary.schoolYears} ciclo(s).`,
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
