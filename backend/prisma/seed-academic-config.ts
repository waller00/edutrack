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
 */
import "dotenv/config";
import type { AcademicLevel, PrismaClient } from "@prisma/client";
import { prisma } from "../src/db/prisma.js";
import {
  GLOBAL_ACTIVITY_TYPES,
  GRADING_SCALES,
  PERIODS_BY_LEVEL,
  type PeriodSeed,
} from "./data/academic-config-dges.js";

const LEVELS: readonly AcademicLevel[] = ["EBI", "EMS"];

/**
 * `MM-DD` + año del ciclo → instante UTC al mediodía.
 *
 * Mediodía y no medianoche: la fecha se muestra como día civil uruguayo (UTC-3) y un
 * `T00:00:00Z` se lee como el día anterior. Mismo criterio que `seed-academic-catalog.ts`.
 */
function periodDate(schoolYearCode: number, monthDay: string | null, yearOffset = 0): Date | null {
  if (!monthDay) return null;
  return new Date(`${schoolYearCode + yearOffset}-${monthDay}T12:00:00.000Z`);
}

async function upsertPeriods(db: PrismaClient, schoolYearId: string, schoolYearCode: number) {
  let count = 0;
  for (const level of LEVELS) {
    for (const period of PERIODS_BY_LEVEL[level] as readonly PeriodSeed[]) {
      const offset = period.yearOffset ?? 0;
      await db.academicPeriod.upsert({
        where: {
          schoolYearId_level_code: { schoolYearId, level, code: period.code },
        },
        create: {
          schoolYearId,
          level,
          code: period.code,
          name: period.name,
          sortOrder: period.sortOrder,
          startsOn: periodDate(schoolYearCode, period.startsOn, offset),
          endsOn: periodDate(schoolYearCode, period.endsOn, offset),
          closesOn: periodDate(schoolYearCode, period.closesOn, offset),
          requiresConceptualJudgement: period.requiresConceptualJudgement,
          requiresGeneralGrade: period.requiresGeneralGrade,
        },
        // No se pisa `isActive` ni las fechas: si Dirección ajustó el calendario del año,
        // reejecutar el seed no debe deshacerlo. Sólo se corrigen nombre y orden.
        update: { name: period.name, sortOrder: period.sortOrder },
      });
      count++;
    }
  }
  return count;
}

async function upsertScales(db: PrismaClient) {
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

async function upsertActivityTypes(db: PrismaClient) {
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
        data: { name: type.name, sortOrder: type.sortOrder },
      });
    } else {
      await db.activityType.create({
        data: { code: type.code, name: type.name, sortOrder: type.sortOrder, scope: "GLOBAL" },
      });
    }
  }
  return GLOBAL_ACTIVITY_TYPES.length;
}

export async function seedAcademicConfig(db: PrismaClient = prisma) {
  const scales = await upsertScales(db);
  const activityTypes = await upsertActivityTypes(db);

  // Todos los ciclos, no sólo el activo: la libreta se consulta históricamente (RF-111) y un
  // ciclo sin períodos no podría mostrarse.
  const schoolYears = await db.schoolYear.findMany({ select: { id: true, code: true } });
  let periods = 0;
  for (const year of schoolYears) {
    periods += await upsertPeriods(db, year.id, year.code);
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
