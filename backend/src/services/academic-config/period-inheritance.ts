import type { AcademicLevel, Prisma } from "@prisma/client";
import { prisma as defaultPrisma } from "../../db/prisma.js";
import { AcademicConfigError } from "./validation.js";
import { ACADEMIC_LEVELS, planAcademicPeriods, type PeriodOrigin, type SourcePeriod } from "./period-plan.js";

/**
 * Un ciclo lectivo nuevo nace con la parametrización de su libreta.
 *
 * Antes no: el alta creaba la fila `SchoolYear` y nada más, así que Dirección abría el año, cargaba
 * el horario, y el docente entraba a la libreta y no veía nada — no había períodos que mostrar. La
 * única salida era correr `npm run seed:academic-config` por consola en el servidor.
 *
 * Es idempotente a propósito: el alta, el wizard de apertura y el botón de reparación llaman todos
 * a esta función, y correrla de nuevo sobre un ciclo ya parametrizado no escribe nada.
 */

/** Qué hacer con un período que el ciclo destino ya tiene. */
export type OnExistingPeriod = "SKIP" | "REFRESH_LABELS";

export type LevelInheritance = {
  origin: PeriodOrigin;
  created: number;
  existing: number;
};

export type PeriodInheritanceSummary = {
  schoolYearId: string;
  schoolYearCode: number;
  sourceSchoolYearId: string | null;
  sourceSchoolYearCode: number | null;
  created: number;
  /** Ya estaban en el destino. Con `SKIP` no se tocaron. */
  existing: number;
  /** Cuántos de los existentes se les corrigió nombre y orden (sólo con `REFRESH_LABELS`). */
  refreshed: number;
  byLevel: Record<AcademicLevel, LevelInheritance>;
};

/** Lo que define a un período dentro de su ciclo: la misma clave única que tiene la tabla. */
function periodKey(level: AcademicLevel, code: string): string {
  return `${level}|${code}`;
}

const SOURCE_PERIOD_SELECT = {
  level: true,
  code: true,
  name: true,
  sortOrder: true,
  kind: true,
  startsOn: true,
  endsOn: true,
  closesOn: true,
  requiresConceptualJudgement: true,
  requiresGeneralGrade: true,
  isMeeting: true,
  judgementLabel: true,
  isActive: true,
} as const;

async function loadSchoolYear(db: Prisma.TransactionClient, id: string, code: string, message: string) {
  const row = await db.schoolYear.findUnique({ where: { id }, select: { id: true, code: true } });
  if (!row) throw new AcademicConfigError(404, code, message);
  return row;
}

/**
 * Copia al ciclo destino los períodos del ciclo origen, corriendo las fechas al año nuevo. Sin
 * origen —o si el origen no tiene períodos de ese nivel— siembra la plantilla reglamentaria.
 *
 * Nunca abre transacción: recibe el cliente. Así el alta la mete en la suya, el wizard de apertura
 * la mete en la transacción que ya tiene y el endpoint de reparación abre una propia.
 */
export async function inheritAcademicPeriods(
  params: {
    targetSchoolYearId: string;
    sourceSchoolYearId?: string | null;
    /** Default `SKIP`: no deshace los ajustes de calendario que haya hecho Dirección. */
    onExisting?: OnExistingPeriod;
  },
  db: Prisma.TransactionClient = defaultPrisma,
): Promise<PeriodInheritanceSummary> {
  const { targetSchoolYearId, sourceSchoolYearId, onExisting = "SKIP" } = params;

  if (sourceSchoolYearId && sourceSchoolYearId === targetSchoolYearId) {
    throw new AcademicConfigError(
      400,
      "SAME_SCHOOL_YEAR",
      "El ciclo origen y el ciclo destino no pueden ser el mismo.",
    );
  }

  const target = await loadSchoolYear(
    db,
    targetSchoolYearId,
    "SCHOOL_YEAR_NOT_FOUND",
    "Ciclo lectivo no encontrado.",
  );

  const source = sourceSchoolYearId
    ? await loadSchoolYear(
        db,
        sourceSchoolYearId,
        "SOURCE_SCHOOL_YEAR_NOT_FOUND",
        "El ciclo lectivo de origen no existe.",
      )
    : null;

  // Sin filtro `isActive`: un período que Dirección apagó se hereda apagado, no desaparece.
  const sourcePeriods = source
    ? ((await db.academicPeriod.findMany({
        where: { schoolYearId: source.id },
        select: SOURCE_PERIOD_SELECT,
      })) as SourcePeriod[])
    : [];

  const plan = planAcademicPeriods({
    targetSchoolYearCode: target.code,
    source: source ? { code: source.code, periods: sourcePeriods } : null,
  });

  const present = await db.academicPeriod.findMany({
    where: { schoolYearId: target.id },
    select: { id: true, level: true, code: true },
  });
  const presentByKey = new Map(present.map((row) => [periodKey(row.level, row.code), row]));

  const summary: PeriodInheritanceSummary = {
    schoolYearId: target.id,
    schoolYearCode: target.code,
    sourceSchoolYearId: source?.id ?? null,
    sourceSchoolYearCode: source?.code ?? null,
    created: 0,
    existing: 0,
    refreshed: 0,
    byLevel: {} as Record<AcademicLevel, LevelInheritance>,
  };

  const toCreate: Prisma.AcademicPeriodCreateManyInput[] = [];
  const toRefresh: { id: string; name: string; sortOrder: number }[] = [];

  for (const level of ACADEMIC_LEVELS) {
    const levelPlan = plan.byLevel[level];
    const counters: LevelInheritance = { origin: levelPlan.origin, created: 0, existing: 0 };

    for (const period of levelPlan.periods) {
      const existing = presentByKey.get(periodKey(level, period.code));
      if (existing) {
        counters.existing++;
        if (onExisting === "REFRESH_LABELS") {
          toRefresh.push({ id: existing.id, name: period.name, sortOrder: period.sortOrder });
        }
        continue;
      }
      counters.created++;
      toCreate.push({ schoolYearId: target.id, ...period });
    }

    summary.byLevel[level] = counters;
    summary.created += counters.created;
    summary.existing += counters.existing;
  }

  if (toCreate.length > 0) {
    await db.academicPeriod.createMany({ data: toCreate });
  }

  // El seed conserva su contrato histórico: corrige nombre y orden, no pisa fechas ni `isActive`.
  for (const row of toRefresh) {
    await db.academicPeriod.update({
      where: { id: row.id },
      data: { name: row.name, sortOrder: row.sortOrder },
    });
  }
  summary.refreshed = toRefresh.length;

  return summary;
}
