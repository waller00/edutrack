/**
 * Parametrización académica inicial: períodos reglamentarios, escalas y tipos de actividad.
 *
 * Es **dato semilla, no reglamento congelado**: todo esto se edita desde `/admin/academic-config`
 * sin tocar el código. Se siembra para que el sistema arranque usable y para dejar documentada la
 * forma que espera el módulo de libreta.
 */
import type { AcademicLevel } from "@prisma/client";

export type PeriodSeed = {
  code: string;
  name: string;
  sortOrder: number;
  /** Mes y día de inicio/fin dentro del año civil del ciclo; null = sin ventana definida. */
  startsOn: string | null;
  endsOn: string | null;
  closesOn: string | null;
  requiresConceptualJudgement: boolean;
  requiresGeneralGrade: boolean;
  /** Meses a sumar al año del ciclo (APE de febrero cierra en el año siguiente). */
  yearOffset?: number;
};

/**
 * Períodos de Educación Básica Integrada (7.º, 8.º y 9.º), según la operativa documentada del
 * Portafolio Docente para el Plan 2023.
 *
 * El juicio conceptual se exige en los cierres de tramo largo y en las reuniones finales; en los
 * cortes mensuales queda opcional. Es lo que el spec pide dejar configurable (RF-052).
 */
export const EBI_PERIODS: readonly PeriodSeed[] = [
  {
    code: "MODULO_INTRODUCTORIO",
    name: "Módulo Introductorio",
    sortOrder: 10,
    startsOn: "03-01",
    endsOn: "03-15",
    closesOn: "03-22",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
  },
  {
    code: "MARZO_ABRIL",
    name: "Marzo – Abril",
    sortOrder: 20,
    startsOn: "03-16",
    endsOn: "04-30",
    closesOn: "05-08",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "MAYO",
    name: "Mayo",
    sortOrder: 30,
    startsOn: "05-01",
    endsOn: "05-31",
    closesOn: "06-08",
    requiresConceptualJudgement: false,
    requiresGeneralGrade: true,
  },
  {
    code: "JUNIO_JULIO",
    name: "Junio – Julio",
    sortOrder: 40,
    startsOn: "06-01",
    endsOn: "07-31",
    closesOn: "08-08",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "EVALUACION_SEMESTRAL",
    name: "Evaluación Semestral",
    sortOrder: 50,
    startsOn: "07-01",
    endsOn: "07-31",
    closesOn: "08-15",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "AGOSTO_SETIEMBRE",
    name: "Agosto – Setiembre",
    sortOrder: 60,
    startsOn: "08-01",
    endsOn: "09-30",
    closesOn: "10-08",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "OCTUBRE_NOVIEMBRE",
    name: "Octubre – Noviembre",
    sortOrder: 70,
    startsOn: "10-01",
    endsOn: "11-30",
    closesOn: "12-05",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "APE_DICIEMBRE",
    name: "APE Diciembre / Reunión Final",
    sortOrder: 80,
    startsOn: "12-01",
    endsOn: "12-20",
    closesOn: "12-23",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
  },
  {
    code: "APE_FEBRERO",
    name: "APE Febrero / Reunión Ficta",
    sortOrder: 90,
    startsOn: "02-01",
    endsOn: "02-28",
    closesOn: "03-05",
    requiresConceptualJudgement: true,
    requiresGeneralGrade: true,
    // Cae en el año calendario siguiente al del ciclo.
    yearOffset: 1,
  },
];

/**
 * Períodos de Educación Media Superior (1.º, 2.º y 3.º).
 *
 * El spec de DGES sólo describe EBI; EMS se organiza por semestres con sus períodos de exámenes.
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
    description: "Escala de Educación Básica Integrada (RF-044). Aprobación a partir de 6.",
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
        maxValueHundredths: 599,
        colorToken: "amber",
        iconToken: "alert-circle",
        isPassing: false,
        isAlert: true,
        sortOrder: 20,
      },
      {
        code: "LOGRADO",
        label: "Logrado",
        descriptor: "Alcanza los aprendizajes esperados para el tramo.",
        minValueHundredths: 600,
        maxValueHundredths: 899,
        colorToken: "green",
        iconToken: "check",
        isPassing: true,
        isAlert: false,
        sortOrder: 30,
      },
      {
        code: "LOGRADO_PLENAMENTE",
        label: "Logrado plenamente",
        descriptor: "Alcanza con autonomía y supera los aprendizajes esperados.",
        minValueHundredths: 900,
        maxValueHundredths: 1000,
        colorToken: "emerald",
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

/** Tipos de actividad predefinidos del catálogo institucional (RF-041). */
export const GLOBAL_ACTIVITY_TYPES: ReadonlyArray<{ code: string; name: string; sortOrder: number }> = [
  { code: "ESCRITO", name: "Escrito", sortOrder: 10 },
  { code: "ORAL", name: "Oral", sortOrder: 20 },
  { code: "TRABAJO_DOMICILIARIO", name: "Trabajo domiciliario", sortOrder: 30 },
  { code: "TRABAJO_EN_CLASE", name: "Trabajo en clase", sortOrder: 40 },
  { code: "PROYECTO", name: "Proyecto", sortOrder: 50 },
  { code: "EXPOSICION", name: "Exposición", sortOrder: 60 },
  { code: "LABORATORIO", name: "Laboratorio", sortOrder: 70 },
  { code: "PARTICIPACION", name: "Participación", sortOrder: 80 },
  { code: "TAREA_MOODLE", name: "Tarea de Moodle", sortOrder: 90 },
];
