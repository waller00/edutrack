/**
 * Plan de transición de los períodos EBI a la estructura de la planilla del liceo.
 *
 * Es lógica pura, sin base de datos: `prisma/remap-ebi-periods.ts` carga las filas, pide el plan y
 * lo ejecuta. Separarlo permite testear las decisiones (a dónde va cada evaluación, qué período se
 * puede dar de baja) sin levantar Postgres.
 */
import type { AcademicPeriodKind } from "@prisma/client";

export type PeriodShape = {
  kind: AcademicPeriodKind;
  requiresGeneralGrade: boolean;
  requiresConceptualJudgement: boolean;
  isMeeting: boolean;
  judgementLabel: string | null;
};

export type RemapPeriod = PeriodShape & { id: string; code: string; isActive: boolean };

export type RetiredAttachments = {
  /** `GradeBookPeriod` abiertos y sin notas: se crean al mirar la libreta y no guardan nada. */
  emptyOpenGradeBookPeriodIds: string[];
  /** `GradeBookPeriod` cerrados, reabiertos o con alguna `PeriodGrade`. */
  gradeBookPeriodsWithData: number;
  meetingRecords: number;
  conductRecords: number;
  messages: number;
};

export type RemapInput = {
  periods: RemapPeriod[];
  /** Forma esperada por código, tomada de la semilla. */
  shapesByCode: Record<string, PeriodShape>;
  retiredCodes: readonly string[];
  /** Evaluaciones vivas colgadas de períodos retirados. `date` es el día civil `YYYY-MM-DD`. */
  assessments: Array<{ id: string; periodId: string; date: string; activityTypeId: string | null }>;
  attachmentsByPeriodId: Record<string, RetiredAttachments>;
  /** Notas de períodos CLOSED con C y sin R: se cerraron cuando la oficial todavía era C. */
  closedGradesMissingR: Array<{ id: string; valueHundredths: number }>;
  pruebaActivityTypeId: string | null;
};

export type AssessmentMove = { assessmentId: string; toPeriodId: string; activityTypeId?: string };

export type RemapPlan = {
  shapeUpdates: Array<{ periodId: string; code: string; data: PeriodShape }>;
  assessmentMoves: AssessmentMove[];
  /** Evaluaciones de períodos bloqueados que además no tienen período destino. */
  unmovable: string[];
  emptyGradeBookPeriodDeletes: string[];
  deactivate: Array<{ periodId: string; code: string }>;
  /** Períodos retirados que conservan datos: se informan y se deciden a mano. */
  blocked: Array<{ code: string; reasons: string[] }>;
  backfillMeetingGrades: Array<{ id: string; valueHundredths: number }>;
};

const SHAPE_KEYS: ReadonlyArray<keyof PeriodShape> = [
  "kind",
  "requiresGeneralGrade",
  "requiresConceptualJudgement",
  "isMeeting",
  "judgementLabel",
];

function sameShape(period: PeriodShape, expected: PeriodShape): boolean {
  return SHAPE_KEYS.every((key) => period[key] === expected[key]);
}

function planShapeUpdates(input: RemapInput): RemapPlan["shapeUpdates"] {
  const updates: RemapPlan["shapeUpdates"] = [];
  for (const period of input.periods) {
    const expected = input.shapesByCode[period.code];
    if (expected && !sameShape(period, expected)) {
      updates.push({ periodId: period.id, code: period.code, data: expected });
    }
  }
  return updates;
}

/**
 * Período destino de una evaluación de un período retirado.
 *
 * Junio‑Julio se parte por la fecha: junio pertenece a Mayo‑Junio y julio al nuevo tramo Julio.
 */
export function targetCodeFor(retiredCode: string, dateYmd: string): string | null {
  if (retiredCode === "MAYO") return "MAYO_JUNIO";
  if (retiredCode === "JUNIO_JULIO") return dateYmd.slice(5, 7) <= "06" ? "MAYO_JUNIO" : "JULIO";
  if (retiredCode === "EVALUACION_SEMESTRAL") return "JULIO";
  return null;
}

function planMove(
  input: RemapInput,
  retiredCode: string,
  idByCode: Map<string, string>,
  assessment: RemapInput["assessments"][number],
) {
  const toPeriodId = idByCode.get(targetCodeFor(retiredCode, assessment.date) ?? "");
  if (!toPeriodId) return null;
  const move: AssessmentMove = { assessmentId: assessment.id, toPeriodId };
  // La evaluación semestral sin tipo era la prueba: así cae en la columna Prueba.
  if (retiredCode === "EVALUACION_SEMESTRAL" && !assessment.activityTypeId && input.pruebaActivityTypeId) {
    move.activityTypeId = input.pruebaActivityTypeId;
  }
  return move;
}

function blockingReasons(attachments: RetiredAttachments | undefined): string[] {
  if (!attachments) return [];
  const reasons: string[] = [];
  if (attachments.gradeBookPeriodsWithData > 0) {
    reasons.push(`${attachments.gradeBookPeriodsWithData} libreta(s) con notas o cierre en el período`);
  }
  if (attachments.meetingRecords > 0) reasons.push(`${attachments.meetingRecords} decisión(es) de reunión`);
  if (attachments.conductRecords > 0) reasons.push(`${attachments.conductRecords} conducta(s) de adscripción`);
  if (attachments.messages > 0) reasons.push(`${attachments.messages} mensaje(s)`);
  return reasons;
}

/**
 * Un período retirado se resuelve entero o no se toca: si conserva cierres, notas del período u
 * otros datos, sus evaluaciones se quedan con él. Moverlas sacaría notas congeladas de un período
 * cerrado y las dejaría editables en uno abierto.
 */
function planRetiredPeriod(
  input: RemapInput,
  period: RemapPeriod,
  idByCode: Map<string, string>,
  plan: RemapPlan,
) {
  const attachments = input.attachmentsByPeriodId[period.id];
  const reasons = blockingReasons(attachments);
  const moves: AssessmentMove[] = [];
  const stranded: string[] = [];
  for (const assessment of input.assessments.filter((a) => a.periodId === period.id)) {
    const move = planMove(input, period.code, idByCode, assessment);
    if (move) moves.push(move);
    else stranded.push(assessment.id);
  }
  if (stranded.length > 0) reasons.push(`${stranded.length} evaluación(es) sin período destino`);

  if (reasons.length > 0) {
    plan.blocked.push({ code: period.code, reasons });
    plan.unmovable.push(...stranded);
    return;
  }
  plan.assessmentMoves.push(...moves);
  plan.emptyGradeBookPeriodDeletes.push(...(attachments?.emptyOpenGradeBookPeriodIds ?? []));
  plan.deactivate.push({ periodId: period.id, code: period.code });
}

export function planEbiRemap(input: RemapInput): RemapPlan {
  const idByCode = new Map(input.periods.map((p) => [p.code, p.id]));
  const plan: RemapPlan = {
    shapeUpdates: planShapeUpdates(input),
    assessmentMoves: [],
    unmovable: [],
    emptyGradeBookPeriodDeletes: [],
    deactivate: [],
    blocked: [],
    backfillMeetingGrades: input.closedGradesMissingR,
  };
  for (const period of input.periods) {
    if (period.isActive && input.retiredCodes.includes(period.code)) planRetiredPeriod(input, period, idByCode, plan);
  }
  return plan;
}

/** ¿El plan no cambia nada? Sirve para que el script diga "ya estaba aplicado". */
export function isEmptyPlan(plan: RemapPlan): boolean {
  return (
    plan.shapeUpdates.length === 0 &&
    plan.assessmentMoves.length === 0 &&
    plan.deactivate.length === 0 &&
    plan.backfillMeetingGrades.length === 0 &&
    plan.blocked.length === 0 &&
    plan.unmovable.length === 0
  );
}
