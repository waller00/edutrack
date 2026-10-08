/**
 * Corrección única de las evaluaciones cargadas antes de las notas sueltas y la escala por nivel.
 *
 *   npm run seed:fix-gradebook-assessments              # dry-run: muestra el plan y no escribe
 *   npm run seed:fix-gradebook-assessments -- --apply   # lo aplica
 *
 * 1. Las notas que la carta del alumno creó como evaluación del grupo pasan a `INDIVIDUAL`: si no,
 *    el control de libretas las cruza contra todo el grupo y marca atrasado al docente.
 * 2. Las evaluaciones manuales de bachillerato con la escala 1–10 pasan a la 1–12: la libreta no
 *    ofrecía otra. Las notas no cambian (1 a 10 es válido en 1–12).
 *
 * Idempotente: una segunda corrida no encuentra nada que corregir.
 */
import "dotenv/config";
import { prisma } from "../src/db/prisma.js";
import { EMS_SCALE_CODE, planAssessmentFixes, type AssessmentRow } from "./data/fix-assessments-plan.js";

async function loadRows(): Promise<AssessmentRow[]> {
  const rows = await prisma.assessment.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      title: true,
      date: true,
      source: true,
      scope: true,
      gradingScale: { select: { code: true } },
      activityType: { select: { name: true } },
      gradeBook: { select: { courseOffering: { select: { course: { select: { level: true } } } } } },
      grades: { select: { comment: true }, take: 2 },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    date: row.date.toISOString().slice(0, 10),
    source: row.source,
    scope: row.scope,
    level: row.gradeBook.courseOffering?.course?.level ?? null,
    scaleCode: row.gradingScale.code,
    activityTypeName: row.activityType?.name ?? null,
    grades: row.grades,
  }));
}

export async function fixGradebookAssessments(apply: boolean): Promise<string[]> {
  const plan = planAssessmentFixes(await loadRows());
  const lines = [
    `${plan.toIndividual.length} nota(s) suelta(s) de la carta pasan a INDIVIDUAL.`,
    `${plan.toEmsScale.length} evaluación(es) de bachillerato pasan a la escala ${EMS_SCALE_CODE}.`,
  ];
  if (!apply) return lines;

  const emsScale = await prisma.gradingScale.findUnique({ where: { code: EMS_SCALE_CODE }, select: { id: true } });
  if (plan.toEmsScale.length > 0 && !emsScale) {
    throw new Error(`No existe la escala ${EMS_SCALE_CODE}: correr antes npm run seed:academic-config.`);
  }
  await prisma.$transaction(async (tx) => {
    if (plan.toIndividual.length > 0) {
      await tx.assessment.updateMany({ where: { id: { in: plan.toIndividual } }, data: { scope: "INDIVIDUAL" } });
    }
    if (plan.toEmsScale.length > 0 && emsScale) {
      await tx.assessment.updateMany({ where: { id: { in: plan.toEmsScale } }, data: { gradingScaleId: emsScale.id } });
    }
  });
  return lines;
}

const isDirectRun = process.argv[1]?.includes("fix-gradebook-assessments");
if (isDirectRun) {
  const apply = process.argv.includes("--apply");
  fixGradebookAssessments(apply)
    .then((lines) => {
      for (const line of lines) console.log(`[fix-gradebook-assessments] ${line}`);
      console.log(
        apply
          ? "[fix-gradebook-assessments] Aplicado."
          : "[fix-gradebook-assessments] Dry-run: no se escribió nada. Repetir con --apply para aplicarlo.",
      );
    })
    .catch((error) => {
      console.error("[fix-gradebook-assessments]", error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
