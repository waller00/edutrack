/**
 * Transición única de los períodos a la estructura de la planilla del liceo.
 *
 *   npm run seed:remap-ebi-periods              # dry-run: muestra el plan y no escribe nada
 *   npm run seed:remap-ebi-periods -- --apply   # lo aplica
 *
 * Qué hace, por ciclo lectivo:
 *  1. Siembra la parametrización nueva (períodos EBI de la planilla, escala 1–10 de seis tramos,
 *     tipos de actividad con su columna).
 *  2. Impone la forma de cada período sembrado (tipo, exigencias, reunión, nombre del texto). El
 *     seed normal no lo hace a propósito, para respetar lo que edite Dirección. En EMS sólo marca
 *     que el período lleva reunión.
 *  3. Mueve las evaluaciones de Mayo, Junio‑Julio y Evaluación Semestral a los tramos nuevos.
 *  4. Da de baja los períodos retirados que quedaron vacíos; los que conservan datos se informan.
 *  5. Copia C → R en los períodos ya cerrados: se cerraron cuando la nota oficial era C.
 *
 * Todo corre en una sola transacción. En dry-run se revierte al final, así que el plan que se
 * muestra es exactamente el que se aplicaría. Es idempotente: una segunda corrida no cambia nada.
 */
import "dotenv/config";
import type { AcademicLevel, Prisma } from "@prisma/client";
import { prisma } from "../src/db/prisma.js";
import { EBI_PERIODS, EMS_PERIODS, RETIRED_EBI_PERIOD_CODES } from "./data/academic-config-dges.js";
import {
  isEmptyPlan,
  planEbiRemap,
  type PeriodShape,
  type RemapInput,
  type RemapPlan,
  type RetiredAttachments,
} from "./data/remap-ebi-plan.js";
import { periodShape, seedAcademicConfig } from "./seed-academic-config.js";

type Tx = Prisma.TransactionClient;

const PERIOD_SELECT = {
  id: true,
  code: true,
  isActive: true,
  kind: true,
  requiresGeneralGrade: true,
  requiresConceptualJudgement: true,
  isMeeting: true,
  judgementLabel: true,
} as const;

class DryRunRollback extends Error {}

function expectedShapes(level: AcademicLevel, periods: Array<PeriodShape & { code: string }>) {
  const shapes: Record<string, PeriodShape> = {};
  if (level === "EBI") {
    for (const seed of EBI_PERIODS) shapes[seed.code] = periodShape(seed);
    return shapes;
  }
  // EMS conserva lo que haya configurado Dirección; sólo pasa a llevar reunión (tener R).
  const emsCodes = new Set(EMS_PERIODS.map((p) => p.code));
  for (const period of periods) {
    if (!emsCodes.has(period.code)) continue;
    shapes[period.code] = {
      kind: period.kind,
      requiresGeneralGrade: period.requiresGeneralGrade,
      requiresConceptualJudgement: period.requiresConceptualJudgement,
      isMeeting: true,
      judgementLabel: period.judgementLabel,
    };
  }
  return shapes;
}

async function loadAttachments(tx: Tx, periodId: string): Promise<RetiredAttachments> {
  const [gradeBookPeriods, meetingRecords, conductRecords, messages] = await Promise.all([
    tx.gradeBookPeriod.findMany({
      where: { periodId },
      select: { id: true, status: true, _count: { select: { grades: true, endorsements: true } } },
    }),
    tx.teacherMeetingRecord.count({ where: { periodId } }),
    tx.studentConductRecord.count({ where: { periodId } }),
    tx.gradeBookMessage.count({ where: { periodId } }),
  ]);
  const isEmpty = (row: (typeof gradeBookPeriods)[number]) =>
    row.status === "OPEN" && row._count.grades === 0 && row._count.endorsements === 0;
  return {
    emptyOpenGradeBookPeriodIds: gradeBookPeriods.filter(isEmpty).map((row) => row.id),
    gradeBookPeriodsWithData: gradeBookPeriods.filter((row) => !isEmpty(row)).length,
    meetingRecords,
    conductRecords,
    messages,
  };
}

async function loadInput(
  tx: Tx,
  schoolYearId: string,
  level: AcademicLevel,
  pruebaActivityTypeId: string | null,
): Promise<RemapInput> {
  const periods = await tx.academicPeriod.findMany({ where: { schoolYearId, level }, select: PERIOD_SELECT });
  const retiredCodes: readonly string[] = level === "EBI" ? RETIRED_EBI_PERIOD_CODES : [];
  const retired = periods.filter((p) => retiredCodes.includes(p.code));
  const retiredIds = retired.map((p) => p.id);

  const [assessments, closedGrades] = await Promise.all([
    tx.assessment.findMany({
      where: { periodId: { in: retiredIds }, deletedAt: null },
      select: { id: true, periodId: true, date: true, activityTypeId: true },
    }),
    tx.periodGrade.findMany({
      where: {
        meetingValueHundredths: null,
        valueHundredths: { not: null },
        gradeBookPeriod: { status: "CLOSED", period: { schoolYearId, level } },
      },
      select: { id: true, valueHundredths: true },
    }),
  ]);

  const attachmentsByPeriodId: Record<string, RetiredAttachments> = {};
  for (const period of retired) attachmentsByPeriodId[period.id] = await loadAttachments(tx, period.id);

  return {
    periods,
    shapesByCode: expectedShapes(level, periods),
    retiredCodes,
    assessments: assessments.map((a) => ({ ...a, date: a.date.toISOString().slice(0, 10) })),
    attachmentsByPeriodId,
    closedGradesMissingR: closedGrades.map((g) => ({ id: g.id, valueHundredths: g.valueHundredths! })),
    pruebaActivityTypeId,
  };
}

async function applyPlan(tx: Tx, plan: RemapPlan) {
  for (const update of plan.shapeUpdates) {
    await tx.academicPeriod.update({ where: { id: update.periodId }, data: update.data });
  }
  for (const move of plan.assessmentMoves) {
    await tx.assessment.update({
      where: { id: move.assessmentId },
      data: { periodId: move.toPeriodId, ...(move.activityTypeId ? { activityTypeId: move.activityTypeId } : {}) },
    });
  }
  if (plan.emptyGradeBookPeriodDeletes.length > 0) {
    await tx.gradeBookPeriod.deleteMany({ where: { id: { in: plan.emptyGradeBookPeriodDeletes } } });
  }
  for (const period of plan.deactivate) {
    await tx.academicPeriod.update({ where: { id: period.periodId }, data: { isActive: false } });
  }
  for (const grade of plan.backfillMeetingGrades) {
    await tx.periodGrade.update({ where: { id: grade.id }, data: { meetingValueHundredths: grade.valueHundredths } });
  }
}

function describePlan(label: string, plan: RemapPlan): string[] {
  if (isEmptyPlan(plan)) return [`${label}: sin cambios.`];
  const lines = [
    `${label}:`,
    `  forma de período actualizada: ${plan.shapeUpdates.map((u) => u.code).join(", ") || "—"}`,
    `  evaluaciones movidas: ${plan.assessmentMoves.length}`,
    `  períodos dados de baja: ${plan.deactivate.map((d) => d.code).join(", ") || "—"}`,
    `  notas de reunión (R) completadas desde C en períodos cerrados: ${plan.backfillMeetingGrades.length}`,
  ];
  for (const blocked of plan.blocked) {
    lines.push(`  ⚠ ${blocked.code} queda activo, decidir a mano: ${blocked.reasons.join("; ")}`);
  }
  return lines;
}

export async function remapEbiPeriods(apply: boolean): Promise<string[]> {
  const report: string[] = [];
  try {
    await prisma.$transaction(
      async (tx) => {
        await seedAcademicConfig(tx);
        const prueba = await tx.activityType.findFirst({
          where: { scope: "GLOBAL", ownerUserId: null, code: "PRUEBA" },
          select: { id: true },
        });
        const years = await tx.schoolYear.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
        for (const year of years) {
          for (const level of ["EBI", "EMS"] as const) {
            const plan = planEbiRemap(await loadInput(tx, year.id, level, prueba?.id ?? null));
            await applyPlan(tx, plan);
            report.push(...describePlan(`Ciclo ${year.code} · ${level}`, plan));
          }
        }
        if (!apply) throw new DryRunRollback();
      },
      { timeout: 300_000, maxWait: 10_000 },
    );
  } catch (error) {
    if (!(error instanceof DryRunRollback)) throw error;
  }
  return report;
}

const isDirectRun = process.argv[1]?.includes("remap-ebi-periods");
if (isDirectRun) {
  const apply = process.argv.includes("--apply");
  remapEbiPeriods(apply)
    .then((report) => {
      console.log(report.join("\n"));
      console.log(
        apply
          ? "[remap-ebi-periods] Aplicado."
          : "[remap-ebi-periods] Dry-run: no se escribió nada. Repetir con --apply para aplicarlo.",
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
