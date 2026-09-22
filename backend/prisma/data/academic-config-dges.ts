/**
 * Parametrización académica inicial: períodos reglamentarios, escalas y tipos de actividad.
 *
 * Es **dato semilla, no reglamento congelado**: todo esto se edita desde `/admin/academic-config`
 * sin tocar el código. Se siembra para que el sistema arranque usable y para dejar documentada la
 * forma que espera el módulo de libreta.
 */
import type { AcademicLevel, AcademicPeriodKind, ActivityCategory } from "@prisma/client";

export type PeriodSeed = {
  code: string;
  name: string;
  sortOrder: number;
  /** Forma del bloque en la libreta. Default `TRAMO`. */
  kind?: AcademicPeriodKind;
  /** Mes y día de inicio/fin dentro del año civil del ciclo; null = sin ventana definida. */
  startsOn: string | null;
  endsOn: string | null;
  closesOn: string | null;
  requiresConceptualJudgement: boolean;
  /** Exige C (la calificación del docente) para cerrar. */
  requiresGeneralGrade: boolean;
  /** Lleva reunión: tiene R y aparece en reunión, boletín, visado y control. */
  isMeeting?: boolean;
  /** Nombre del texto del período ("Informe de actuación", "Diagnóstico"…). */
  judgementLabel?: string | null;
  /** Meses a sumar al año del ciclo (APE de febrero cierra en el año siguiente). */
  yearOffset?: number;
};

const INFORME_ACTUACION = "Informe de actuación";

/** Entrega de informe a las familias: informe de actuación, C y R, todo obligatorio. */
function entrega(n: number, sortOrder: number, startsOn: string, endsOn: string, closesOn: string): PeriodSeed {
  return {
    code: `ENTREGA_${n}`,
    name: `${n}.ª Entrega (${n}.ª Reunión)`,
    sortOrder,
    kind: "ENTREGA",
    startsOn,
    endsOn,
    closesOn,
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    isMeeting: true,
    judgementLabel: INFORME_ACTUACION,
  };
}

/**
 * Períodos de Educación Básica Integrada (7.º, 8.º y 9.º), con la estructura de la planilla que el
 * liceo usa hoy (`docs/Prototipo Libreta.xlsx`): tramos de trabajo con Or / Otras / Ev / C / R, y
 * después de cada tramo largo una entrega con su informe de actuación, C y R.
 *
 * Las notas de un tramo son de trabajo; lo que se informa y se lleva a la reunión es la entrega.
 * Las fechas son orientativas: Dirección las ajusta desde la configuración cada año.
 */
export const EBI_PERIODS: readonly PeriodSeed[] = [
  {
    code: "MODULO_INTRODUCTORIO",
    name: "Diagnóstico · Reunión de Trayectorias",
    sortOrder: 10,
    kind: "DIAGNOSTICO",
    startsOn: "03-01",
    endsOn: "03-31",
    closesOn: "04-10",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: false,
    judgementLabel: "Diagnóstico",
  },
  {
    code: "MARZO_ABRIL",
    name: "Marzo – Abril",
    sortOrder: 20,
    startsOn: "03-01",
    endsOn: "04-30",
    closesOn: "05-08",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
  },
  entrega(1, 30, "04-15", "05-15", "05-22"),
  {
    code: "MAYO_JUNIO",
    name: "Mayo – Junio",
    sortOrder: 40,
    startsOn: "05-01",
    endsOn: "06-30",
    closesOn: "07-08",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
  },
  {
    code: "JULIO",
    name: "Julio (Prueba semestral)",
    sortOrder: 50,
    startsOn: "07-01",
    endsOn: "07-31",
    closesOn: "08-08",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
  },
  entrega(2, 60, "07-15", "08-15", "08-22"),
  {
    code: "AGOSTO_SETIEMBRE",
    name: "Agosto – Setiembre",
    sortOrder: 70,
    startsOn: "08-01",
    endsOn: "09-30",
    closesOn: "10-08",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
  },
  entrega(3, 80, "09-15", "10-15", "10-22"),
  {
    code: "OCTUBRE_NOVIEMBRE",
    name: "Octubre – Noviembre (2.ª Prueba)",
    sortOrder: 90,
    startsOn: "10-01",
    endsOn: "11-30",
    closesOn: "12-05",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
    // Sólo para quien va a APE: por eso es opcional.
    judgementLabel: "Informe para envío APE",
  },
  entrega(4, 100, "11-15", "12-10", "12-15"),
  {
    // APE y reunión final. No exige C a todo el grupo: sólo rinden los que quedaron en APE.
    code: "APE_DICIEMBRE",
    name: "Diciembre · APE y Reunión final",
    sortOrder: 110,
    startsOn: "12-01",
    endsOn: "12-20",
    closesOn: "12-23",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
    isMeeting: true,
  },
  {
    code: "APE_FEBRERO",
    name: "APE Febrero · Reunión de febrero",
    sortOrder: 120,
    startsOn: "02-01",
    endsOn: "02-28",
    closesOn: "03-05",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
    isMeeting: true,
    judgementLabel: INFORME_ACTUACION,
    // Cae en el año calendario siguiente al del ciclo.
    yearOffset: 1,
  },
];

/**
 * Códigos EBI de la parametrización anterior, reemplazados por la estructura de la planilla.
 * `prisma/remap-ebi-periods.ts` mueve sus evaluaciones y los da de baja.
 */
export const RETIRED_EBI_PERIOD_CODES = ["MAYO", "JUNIO_JULIO", "EVALUACION_SEMESTRAL"] as const;

/**
 * Períodos de Educación Media Superior (1.º, 2.º y 3.º).
 *
 * El spec de DGES sólo describe EBI; EMS se organiza por semestres con sus períodos de exámenes.
 * Todos llevan reunión: la nota oficial es R, y un período sin R no podría informarse.
 * Se siembra la estructura habitual, pensada para que Dirección la ajuste desde la pantalla de
 * configuración cuando salga la resolución del año.
 */
export const EMS_PERIODS: readonly PeriodSeed[] = [
  {
    code: "PRIMER_SEMESTRE",
    name: "Primer semestre",
    sortOrder: 10,
    startsOn: "03-01",
    endsOn: "07-15",
    closesOn: "07-25",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    isMeeting: true,
  },
  {
    code: "SEGUNDO_SEMESTRE",
    name: "Segundo semestre",
    sortOrder: 20,
    startsOn: "07-16",
    endsOn: "11-30",
    closesOn: "12-05",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    isMeeting: true,
  },
  {
    code: "EXAMENES_DICIEMBRE",
    name: "Exámenes Diciembre",
    sortOrder: 30,
    startsOn: "12-01",
    endsOn: "12-20",
    closesOn: "12-23",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: true,
    isMeeting: true,
  },
  {
    code: "EXAMENES_FEBRERO",
    name: "Exámenes Febrero",
    sortOrder: 40,
    startsOn: "02-01",
    endsOn: "02-28",
    closesOn: "03-05",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: true,
    isMeeting: true,
    yearOffset: 1,
  },
];

export const PERIODS_BY_LEVEL: Record<AcademicLevel, readonly PeriodSeed[]> = {
  EBI: EBI_PERIODS,
  EMS: EMS_PERIODS,
};

export type ScaleLevelSeed = {
  code: string;
  label: string;
  descriptor: string | null;
  minValueHundredths: number;
  maxValueHundredths: number;
  colorToken: string;
  /** RNF 7.2: el semáforo nunca depende sólo del color. */
  iconToken: string;
  isPassing: boolean;
  isAlert: boolean;
  sortOrder: number;
};

export type ScaleSeed = {
  code: string;
  name: string;
  kind: "NUMERIC" | "ORDINAL";
  minValueHundredths: number | null;
  maxValueHundredths: number | null;
  decimals: number;
  description: string;
  sortOrder: number;
  levels: readonly ScaleLevelSeed[];
};

export const GRADING_SCALES: readonly ScaleSeed[] = [
  {
    code: "NUMERICA_1_12",
    name: "Numérica 1 a 12",
    kind: "NUMERIC",
    minValueHundredths: 100,
    maxValueHundredths: 1200,
    decimals: 0,
    description: "Escala de Educación Media Superior. Aprobación a partir de 6.",
    sortOrder: 20,
    levels: [
      {
        code: "INSUFICIENTE",
        label: "Insuficiente",
        descriptor: "No alcanza los aprendizajes esperados.",
        minValueHundredths: 100,
        maxValueHundredths: 299,
        colorToken: "red",
        iconToken: "alert-triangle",
        isPassing: false,
        isAlert: true,
        sortOrder: 10,
      },
      {
        code: "REGULAR",
        label: "Regular",
        descriptor: "Alcanza parcialmente los aprendizajes esperados.",
        minValueHundredths: 300,
        maxValueHundredths: 599,
        colorToken: "amber",
        iconToken: "alert-circle",
        isPassing: false,
        isAlert: true,
        sortOrder: 20,
      },
      {
        code: "ACEPTABLE",
        label: "Aceptable",
        descriptor: "Alcanza los aprendizajes esperados.",
        minValueHundredths: 600,
        maxValueHundredths: 899,
        colorToken: "green",
        iconToken: "check",
        isPassing: true,
        isAlert: false,
        sortOrder: 30,
      },
      {
        code: "DESTACADO",
        label: "Destacado",
        descriptor: "Supera los aprendizajes esperados.",
        minValueHundredths: 900,
        maxValueHundredths: 1200,
        colorToken: "emerald",
        iconToken: "star",
        isPassing: true,
        isAlert: false,
        sortOrder: 40,
      },
    ],
  },
  {
    code: "NUMERICA_1_10",
    name: "Numérica 1 a 10",
    kind: "NUMERIC",
    minValueHundredths: 100,
    maxValueHundredths: 1000,
    decimals: 0,
    description:
      "Escala de Educación Básica Integrada (RF-044). Aprobación a partir de 5. Seis tramos, con " +
      "los colores de la planilla del liceo; cada uno lleva además símbolo y texto (RNF 7.2).",
    sortOrder: 10,
    levels: [
      {
        code: "INSUFICIENTE",
        label: "Insuficiente",
        descriptor: "No alcanza los aprendizajes esperados para el tramo.",
        minValueHundredths: 100,
        maxValueHundredths: 299,
        colorToken: "red",
        iconToken: "alert-triangle",
        isPassing: false,
        isAlert: true,
        sortOrder: 10,
      },
      {
        code: "EN_PROCESO",
        label: "En proceso",
        descriptor: "Avanza hacia los aprendizajes esperados con apoyo sostenido.",
        minValueHundredths: 300,
        maxValueHundredths: 499,
        colorToken: "orange",
        iconToken: "alert-circle",
        isPassing: false,
        isAlert: true,
        sortOrder: 20,
      },
      {
        code: "SUFICIENTE",
        label: "Suficiente",
        descriptor: "Alcanza lo mínimo esperado para el tramo.",
        minValueHundredths: 500,
        maxValueHundredths: 599,
        colorToken: "yellow",
        iconToken: "half",
        isPassing: true,
        isAlert: false,
        sortOrder: 25,
      },
      {
        code: "LOGRADO",
        label: "Logrado",
        descriptor: "Alcanza los aprendizajes esperados para el tramo.",
        minValueHundredths: 600,
        maxValueHundredths: 799,
        colorToken: "lime",
        iconToken: "check",
        isPassing: true,
        isAlert: false,
        sortOrder: 30,
      },
      {
        code: "MUY_BUENO",
        label: "Muy bueno",
        descriptor: "Alcanza con solidez los aprendizajes esperados.",
        minValueHundredths: 800,
        maxValueHundredths: 999,
        colorToken: "blue",
        iconToken: "diamond",
        isPassing: true,
        isAlert: false,
        sortOrder: 35,
      },
      {
        code: "LOGRADO_PLENAMENTE",
        label: "Logrado plenamente",
        descriptor: "Alcanza con autonomía y supera los aprendizajes esperados.",
        minValueHundredths: 1000,
        maxValueHundredths: 1000,
        colorToken: "indigo",
        iconToken: "star",
        isPassing: true,
        isAlert: false,
        sortOrder: 40,
      },
    ],
  },
  {
    code: "SEMAFORO",
    name: "Semáforo",
    kind: "ORDINAL",
    minValueHundredths: 100,
    maxValueHundredths: 300,
    decimals: 0,
    description:
      "Escala visual de tres niveles (RF-044). Cada nivel lleva icono y texto además del color, " +
      "porque RNF 7.2 prohíbe que la información dependa exclusivamente del color.",
    sortOrder: 30,
    levels: [
      {
        code: "ROJO",
        label: "Rojo — requiere intervención",
        descriptor: "Situación que requiere intervención pedagógica inmediata.",
        minValueHundredths: 100,
        maxValueHundredths: 100,
        colorToken: "red",
        iconToken: "alert-triangle",
        isPassing: false,
        isAlert: true,
        sortOrder: 10,
      },
      {
        code: "AMARILLO",
        label: "Amarillo — en seguimiento",
        descriptor: "Avanza con dificultades; amerita seguimiento.",
        minValueHundredths: 200,
        maxValueHundredths: 200,
        colorToken: "amber",
        iconToken: "alert-circle",
        isPassing: false,
        isAlert: true,
        sortOrder: 20,
      },
      {
        code: "VERDE",
        label: "Verde — en curso favorable",
        descriptor: "Avanza según lo esperado.",
        minValueHundredths: 300,
        maxValueHundredths: 300,
        colorToken: "green",
        iconToken: "check",
        isPassing: true,
        isAlert: false,
        sortOrder: 30,
      },
    ],
  },
  {
    // Conducta. Va en su propia escala porque no se mide como el rendimiento: el liceo la lleva a
    // la reunión junto con el promedio académico, pero son dos cosas distintas.
    code: "CONDUCTA",
    name: "Conducta",
    kind: "ORDINAL",
    minValueHundredths: 100,
    maxValueHundredths: 400,
    decimals: 0,
    description:
      "Escala de conducta de cuatro niveles. La usan el docente en su asignatura y adscripción " +
      "para la nota institucional que se lleva a la reunión.",
    sortOrder: 40,
    levels: [
      {
        code: "MALA",
        label: "Mala",
        descriptor: "Requiere intervención de adscripción.",
        minValueHundredths: 100,
        maxValueHundredths: 100,
        colorToken: "red",
        iconToken: "alert",
        isPassing: false,
        isAlert: true,
        sortOrder: 10,
      },
      {
        code: "REGULAR",
        label: "Regular",
        descriptor: "Presenta dificultades de convivencia puntuales.",
        minValueHundredths: 200,
        maxValueHundredths: 200,
        colorToken: "amber",
        iconToken: "warning",
        isPassing: true,
        isAlert: false,
        sortOrder: 20,
      },
      {
        code: "BUENA",
        label: "Buena",
        descriptor: "Convivencia adecuada.",
        minValueHundredths: 300,
        maxValueHundredths: 300,
        colorToken: "green",
        iconToken: "check",
        isPassing: true,
        isAlert: false,
        sortOrder: 30,
      },
      {
        code: "MUY_BUENA",
        label: "Muy buena",
        descriptor: "Colabora y sostiene un buen clima de trabajo.",
        minValueHundredths: 400,
        maxValueHundredths: 400,
        colorToken: "emerald",
        iconToken: "star",
        isPassing: true,
        isAlert: false,
        sortOrder: 40,
      },
    ],
  },
];

/**
 * Tipos de actividad predefinidos del catálogo institucional (RF-041), con la columna de la
 * planilla en la que caen: Or (orales), Otras, Ev (escritos) y Prueba.
 */
export const GLOBAL_ACTIVITY_TYPES: ReadonlyArray<{
  code: string;
  name: string;
  sortOrder: number;
  category: ActivityCategory;
}> = [
  { code: "ESCRITO", name: "Escrito", sortOrder: 10, category: "ESCRITO" },
  { code: "PRUEBA", name: "Prueba semestral", sortOrder: 15, category: "PRUEBA" },
  { code: "ORAL", name: "Oral", sortOrder: 20, category: "ORAL" },
  { code: "TRABAJO_DOMICILIARIO", name: "Trabajo domiciliario", sortOrder: 30, category: "OTRAS" },
  { code: "TRABAJO_EN_CLASE", name: "Trabajo en clase", sortOrder: 40, category: "OTRAS" },
  { code: "PROYECTO", name: "Proyecto", sortOrder: 50, category: "OTRAS" },
  { code: "EXPOSICION", name: "Exposición", sortOrder: 60, category: "ORAL" },
  { code: "LABORATORIO", name: "Laboratorio", sortOrder: 70, category: "OTRAS" },
  { code: "PARTICIPACION", name: "Participación", sortOrder: 80, category: "ORAL" },
  { code: "TAREA_MOODLE", name: "Tarea de Moodle", sortOrder: 90, category: "OTRAS" },
];
