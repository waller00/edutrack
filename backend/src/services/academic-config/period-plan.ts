import type { AcademicLevel, AcademicPeriodKind } from "@prisma/client";
import { PERIODS_BY_LEVEL, RETIRED_EBI_PERIOD_CODES, type PeriodSeed } from "./dges-defaults.js";

/**
 * Qué períodos le corresponden a un ciclo lectivo nuevo.
 *
 * Son funciones puras: deciden el plan, no lo escriben. La escritura (idempotente) vive en
 * `period-inheritance.ts`, y así el cálculo de fechas —que es la parte delicada— se puede testear
 * sin base de datos.
 *
 * La regla del liceo es que el calendario del año que viene se parece al de este año, no a la
 * plantilla reglamentaria: Dirección corre las ventanas cada año según la resolución. Por eso, si
 * hay un ciclo origen, se copia **lo que Dirección dejó** y sólo se le corren los años; la
 * plantilla DGES queda como red para el primer ciclo o para un nivel que nunca se configuró.
 */

export const ACADEMIC_LEVELS: readonly AcademicLevel[] = ["EBI", "EMS"];

/** De dónde salió la parametrización de un nivel: del ciclo anterior o de la plantilla. */
export type PeriodOrigin = "SOURCE_YEAR" | "TEMPLATE";

export type PlannedPeriod = {
  level: AcademicLevel;
  code: string;
  name: string;
  sortOrder: number;
  kind: AcademicPeriodKind;
  startsOn: Date | null;
  endsOn: Date | null;
  closesOn: Date | null;
  requiresConceptualJudgement: boolean;
  requiresGeneralGrade: boolean;
  isMeeting: boolean;
  judgementLabel: string | null;
  isActive: boolean;
};

/** Lo que se lee del ciclo origen tiene la misma forma que lo que se planifica. */
export type SourcePeriod = PlannedPeriod;

export type LevelPlan = {
  origin: PeriodOrigin;
  periods: PlannedPeriod[];
};

export type PeriodPlan = {
  periods: PlannedPeriod[];
  byLevel: Record<AcademicLevel, LevelPlan>;
};

/**
 * `MM-DD` + año del ciclo → instante UTC al mediodía.
 *
 * Mediodía y no medianoche: la fecha se muestra como día civil uruguayo (UTC-3) y un
 * `T00:00:00Z` se lee como el día anterior. Mismo criterio que `seed-academic-catalog.ts`.
 */
export function periodDate(schoolYearCode: number, monthDay: string | null, yearOffset = 0): Date | null {
  if (!monthDay) return null;
  return new Date(`${schoolYearCode + yearOffset}-${monthDay}T12:00:00.000Z`);
}

/**
 * Lo que define la forma y las exigencias de un período en la libreta. El seed lo escribe al
 * crear; `remap-ebi-periods.ts` lo impone una vez sobre los períodos que ya existían.
 */
export function periodShape(period: PeriodSeed) {
  return {
    kind: period.kind ?? "TRAMO",
    requiresConceptualJudgement: period.requiresConceptualJudgement,
    requiresGeneralGrade: period.requiresGeneralGrade,
    isMeeting: period.isMeeting ?? false,
    judgementLabel: period.judgementLabel ?? null,
  } as const;
}

/**
 * La misma fecha, un ciclo más adelante.
 *
 * El desplazamiento de año **se deriva del dato**, no de la plantilla: si la fecha del origen caía
 * en el año civil siguiente al del ciclo (el APE de febrero), en el destino vuelve a caer en el
 * siguiente. Así sobrevive que Dirección haya movido un período de año.
 */
export function shiftPeriodDate(value: Date | null, sourceCode: number, targetCode: number): Date | null {
  if (!value) return null;
  const offset = value.getUTCFullYear() - sourceCode;
  const year = targetCode + offset;
  const month = value.getUTCMonth();
  // El 29 de febrero en un destino no bisiesto se recorta al 28. Dejar que `Date` lo normalice lo
  // movería al 1.º de marzo, o sea fuera de la ventana de febrero que el período describe.
  const lastDayOfMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(value.getUTCDate(), lastDayOfMonth);
  return new Date(Date.UTC(year, month, day, 12, 0, 0, 0));
}

/** Un período de la plantilla, ubicado en el año civil del ciclo destino. */
export function plannedPeriodFromSeed(
  level: AcademicLevel,
  seed: PeriodSeed,
  targetSchoolYearCode: number,
): PlannedPeriod {
  const offset = seed.yearOffset ?? 0;
  return {
    level,
    code: seed.code,
    name: seed.name,
    sortOrder: seed.sortOrder,
    startsOn: periodDate(targetSchoolYearCode, seed.startsOn, offset),
    endsOn: periodDate(targetSchoolYearCode, seed.endsOn, offset),
    closesOn: periodDate(targetSchoolYearCode, seed.closesOn, offset),
    isActive: true,
    ...periodShape(seed),
  };
}

/**
 * Un período del ciclo origen, con sus tres ventanas corridas al ciclo destino.
 *
 * Se copia **todo lo que Dirección pudo editar** —nombre, orden, forma, exigencias, el nombre del
 * texto y hasta `isActive`— y nada se normaliza contra la plantilla: si la plantilla gobernara la
 * forma, copiar del ciclo anterior no tendría sentido. Un período que Dirección apagó el año
 * pasado llega apagado y se puede reactivar desde la pantalla de configuración.
 */
function plannedPeriodFromSource(
  period: SourcePeriod,
  sourceSchoolYearCode: number,
  targetSchoolYearCode: number,
): PlannedPeriod {
  return {
    ...period,
    startsOn: shiftPeriodDate(period.startsOn, sourceSchoolYearCode, targetSchoolYearCode),
    endsOn: shiftPeriodDate(period.endsOn, sourceSchoolYearCode, targetSchoolYearCode),
    closesOn: shiftPeriodDate(period.closesOn, sourceSchoolYearCode, targetSchoolYearCode),
  };
}

/** Los códigos que `remap-ebi-periods.ts` dio de baja no se recrean en un ciclo nuevo. */
function isRetired(level: AcademicLevel, code: string): boolean {
  return level === "EBI" && (RETIRED_EBI_PERIOD_CODES as readonly string[]).includes(code);
}

function bySortOrderThenCode(a: PlannedPeriod, b: PlannedPeriod): number {
  return a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);
}

function templatePlanFor(level: AcademicLevel, targetSchoolYearCode: number): PlannedPeriod[] {
  return PERIODS_BY_LEVEL[level]
    .filter((seed) => !isRetired(level, seed.code))
    .map((seed) => plannedPeriodFromSeed(level, seed, targetSchoolYearCode))
    .sort(bySortOrderThenCode);
}

/**
 * El plan de períodos del ciclo destino, nivel por nivel.
 *
 * El respaldo a la plantilla es **por nivel y no global**: `GET /gradebook/:id/periods` filtra por
 * el nivel del curso, así que un origen con sólo EBI configurado dejaría a EMS sin períodos y sus
 * libretas no se podrían calificar. Tampoco se completan los códigos que falten dentro de un nivel
 * que sí vino del origen: eso resucitaría los períodos que la institución sacó de su plan.
 */
export function planAcademicPeriods(input: {
  targetSchoolYearCode: number;
  source?: { code: number; periods: readonly SourcePeriod[] } | null;
}): PeriodPlan {
  const { targetSchoolYearCode, source } = input;
  const byLevel = {} as Record<AcademicLevel, LevelPlan>;

  for (const level of ACADEMIC_LEVELS) {
    const fromSource = (source?.periods ?? [])
      .filter((period) => period.level === level && !isRetired(level, period.code))
      .map((period) => plannedPeriodFromSource(period, source!.code, targetSchoolYearCode))
      .sort(bySortOrderThenCode);

    byLevel[level] =
      fromSource.length > 0
        ? { origin: "SOURCE_YEAR", periods: fromSource }
        : { origin: "TEMPLATE", periods: templatePlanFor(level, targetSchoolYearCode) };
  }

  return {
    periods: ACADEMIC_LEVELS.flatMap((level) => byLevel[level].periods),
    byLevel,
  };
}
