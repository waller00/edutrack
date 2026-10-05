import { describe, expect, it } from "vitest";
import {
  planAcademicPeriods,
  plannedPeriodFromSeed,
  shiftPeriodDate,
  type PlannedPeriod,
} from "./period-plan.js";
import { EBI_PERIODS, EMS_PERIODS } from "./dges-defaults.js";

const ymd = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

function source(over: Partial<PlannedPeriod> = {}): PlannedPeriod {
  return {
    level: "EBI",
    code: "MARZO_ABRIL",
    name: "Marzo – Abril",
    sortOrder: 20,
    kind: "TRAMO",
    startsOn: new Date("2025-03-01T12:00:00.000Z"),
    endsOn: new Date("2025-04-30T12:00:00.000Z"),
    closesOn: new Date("2025-05-08T12:00:00.000Z"),
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
    isMeeting: false,
    judgementLabel: null,
    isActive: true,
    ...over,
  };
}

describe("shiftPeriodDate", () => {
  it("corre la fecha un ciclo y la deja al mediodía UTC", () => {
    const shifted = shiftPeriodDate(new Date("2025-03-01T12:00:00.000Z"), 2025, 2026);
    expect(shifted?.toISOString()).toBe("2026-03-01T12:00:00.000Z");
  });

  it("conserva el año civil siguiente de un período que cae fuera del ciclo", () => {
    // El APE de febrero del ciclo 2025 vive en 2026: en el 2026 tiene que vivir en 2027.
    const shifted = shiftPeriodDate(new Date("2026-02-28T12:00:00.000Z"), 2025, 2026);
    expect(ymd(shifted)).toBe("2027-02-28");
  });

  it("recorta el 29 de febrero a un destino no bisiesto en vez de pasarse a marzo", () => {
    const shifted = shiftPeriodDate(new Date("2024-02-29T12:00:00.000Z"), 2024, 2025);
    expect(ymd(shifted)).toBe("2025-02-28");
  });

  it("mantiene el 29 de febrero cuando el destino es bisiesto", () => {
    expect(ymd(shiftPeriodDate(new Date("2024-02-29T12:00:00.000Z"), 2024, 2028))).toBe("2028-02-29");
  });

  it("deja en null lo que no tenía fecha", () => {
    expect(shiftPeriodDate(null, 2025, 2026)).toBeNull();
  });
});

describe("planAcademicPeriods · sin ciclo origen", () => {
  const plan = planAcademicPeriods({ targetSchoolYearCode: 2026 });

  it("siembra la plantilla reglamentaria completa de los dos niveles", () => {
    expect(plan.byLevel.EBI.origin).toBe("TEMPLATE");
    expect(plan.byLevel.EMS.origin).toBe("TEMPLATE");
    expect(plan.byLevel.EBI.periods).toHaveLength(EBI_PERIODS.length);
    expect(plan.byLevel.EMS.periods).toHaveLength(EMS_PERIODS.length);
    expect(plan.periods).toHaveLength(EBI_PERIODS.length + EMS_PERIODS.length);
  });

  it("ubica el APE de febrero en el año civil siguiente", () => {
    const febrero = plan.byLevel.EBI.periods.find((period) => period.code === "APE_FEBRERO");
    expect(ymd(febrero?.startsOn ?? null)).toMatch(/^2027-02/);
  });

  it("deja todos los períodos activos y ordenados", () => {
    expect(plan.byLevel.EBI.periods.every((period) => period.isActive)).toBe(true);
    const orders = plan.byLevel.EBI.periods.map((period) => period.sortOrder);
    expect([...orders].sort((a, b) => a - b)).toEqual(orders);
  });

  it("no recrea los períodos que la parametrización anterior dio de baja", () => {
    const codes = plan.byLevel.EBI.periods.map((period) => period.code);
    expect(codes).not.toContain("MAYO");
    expect(codes).not.toContain("JUNIO_JULIO");
    expect(codes).not.toContain("EVALUACION_SEMESTRAL");
  });
});

describe("planAcademicPeriods · con ciclo origen", () => {
  it("conserva lo que Dirección editó y sólo corre las fechas", () => {
    const editado = source({
      name: "Marzo a mediados de mayo",
      sortOrder: 25,
      requiresGeneralGrade: true,
      judgementLabel: "Informe de seguimiento",
      isActive: false,
    });
    const plan = planAcademicPeriods({
      targetSchoolYearCode: 2026,
      source: { code: 2025, periods: [editado] },
    });

    expect(plan.byLevel.EBI.origin).toBe("SOURCE_YEAR");
    const [copied] = plan.byLevel.EBI.periods;
    expect(copied).toMatchObject({
      code: "MARZO_ABRIL",
      name: "Marzo a mediados de mayo",
      sortOrder: 25,
      requiresGeneralGrade: true,
      judgementLabel: "Informe de seguimiento",
      isActive: false,
    });
    expect(ymd(copied.startsOn)).toBe("2026-03-01");
    expect(ymd(copied.endsOn)).toBe("2026-04-30");
    expect(ymd(copied.closesOn)).toBe("2026-05-08");
  });

  it("cae a la plantilla nivel por nivel: un origen sólo con EBI no deja a EMS sin períodos", () => {
    const plan = planAcademicPeriods({
      targetSchoolYearCode: 2026,
      source: { code: 2025, periods: [source()] },
    });

    expect(plan.byLevel.EBI.origin).toBe("SOURCE_YEAR");
    expect(plan.byLevel.EBI.periods).toHaveLength(1);
    expect(plan.byLevel.EMS.origin).toBe("TEMPLATE");
    expect(plan.byLevel.EMS.periods).toHaveLength(EMS_PERIODS.length);
  });

  it("descarta los períodos retirados que el ciclo origen todavía tenga", () => {
    const plan = planAcademicPeriods({
      targetSchoolYearCode: 2026,
      source: {
        code: 2025,
        periods: [source(), source({ code: "JUNIO_JULIO", name: "Junio – Julio", isActive: false })],
      },
    });

    expect(plan.byLevel.EBI.periods.map((period) => period.code)).toEqual(["MARZO_ABRIL"]);
  });

  it("usa la plantilla cuando el origen no tiene ningún período", () => {
    const plan = planAcademicPeriods({ targetSchoolYearCode: 2026, source: { code: 2025, periods: [] } });
    expect(plan.byLevel.EBI.origin).toBe("TEMPLATE");
    expect(plan.byLevel.EMS.origin).toBe("TEMPLATE");
  });
});

describe("plannedPeriodFromSeed", () => {
  it("aplica la forma del período de la plantilla", () => {
    const entrega = EBI_PERIODS.find((seed) => seed.code === "ENTREGA_1")!;
    const planned = plannedPeriodFromSeed("EBI", entrega, 2026);
    expect(planned).toMatchObject({
      level: "EBI",
      code: "ENTREGA_1",
      kind: "ENTREGA",
      isMeeting: true,
      requiresGeneralGrade: true,
      judgementLabel: "Informe de actuación",
      isActive: true,
    });
  });
});
