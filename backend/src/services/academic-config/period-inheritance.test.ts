import { beforeEach, describe, expect, it, vi } from "vitest";
import { inheritAcademicPeriods } from "./period-inheritance.js";
import { AcademicConfigError } from "./validation.js";
import { EBI_PERIODS, EMS_PERIODS } from "./dges-defaults.js";

const TEMPLATE_TOTAL = EBI_PERIODS.length + EMS_PERIODS.length;

const TARGET = { id: "sy-2026", code: 2026 };
const SOURCE = { id: "sy-2025", code: 2025 };

function db() {
  return {
    schoolYear: { findUnique: vi.fn() },
    academicPeriod: { findMany: vi.fn(), createMany: vi.fn(), update: vi.fn() },
  };
}

type Db = ReturnType<typeof db>;

/** `findUnique` responde por id, como la base: así el orden de las llamadas no importa. */
function withYears(mock: Db, years: { id: string; code: number }[]) {
  mock.schoolYear.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve(years.find((year) => year.id === where.id) ?? null),
  );
}

function sourcePeriod(over: Record<string, unknown> = {}) {
  return {
    level: "EBI",
    code: "MARZO_ABRIL",
    name: "Marzo – Abril",
    sortOrder: 20,
    kind: "TRAMO",
    startsOn: new Date("2025-03-01T12:00:00.000Z"),
    endsOn: new Date("2025-04-30T12:00:00.000Z"),
    closesOn: null,
    requiresConceptualJudgement: false,
    requiresGeneralGrade: false,
    isMeeting: false,
    judgementLabel: null,
    isActive: true,
    ...over,
  };
}

let mock: Db;

beforeEach(() => {
  mock = db();
  withYears(mock, [TARGET, SOURCE]);
  mock.academicPeriod.findMany.mockResolvedValue([]);
  mock.academicPeriod.createMany.mockResolvedValue({ count: 0 });
});

describe("inheritAcademicPeriods", () => {
  it("siembra la plantilla cuando no hay ciclo origen", async () => {
    const summary = await inheritAcademicPeriods({ targetSchoolYearId: TARGET.id }, mock as never);

    expect(summary.created).toBe(TEMPLATE_TOTAL);
    expect(summary.existing).toBe(0);
    expect(summary.sourceSchoolYearId).toBeNull();
    expect(summary.byLevel.EBI.origin).toBe("TEMPLATE");
    expect(mock.academicPeriod.createMany).toHaveBeenCalledTimes(1);
    const [[call]] = mock.academicPeriod.createMany.mock.calls;
    expect(call.data).toHaveLength(TEMPLATE_TOTAL);
    expect(call.data[0]).toMatchObject({ schoolYearId: TARGET.id });
  });

  it("copia los períodos del ciclo origen con las fechas corridas", async () => {
    mock.academicPeriod.findMany
      .mockResolvedValueOnce([sourcePeriod()]) // períodos del origen
      .mockResolvedValueOnce([]); // lo que ya tiene el destino

    const summary = await inheritAcademicPeriods(
      { targetSchoolYearId: TARGET.id, sourceSchoolYearId: SOURCE.id },
      mock as never,
    );

    expect(summary.sourceSchoolYearCode).toBe(2025);
    expect(summary.byLevel.EBI.origin).toBe("SOURCE_YEAR");
    expect(summary.byLevel.EBI.created).toBe(1);
    // EMS no estaba en el origen: cae a la plantilla.
    expect(summary.byLevel.EMS.origin).toBe("TEMPLATE");

    const [[call]] = mock.academicPeriod.createMany.mock.calls;
    const marzo = call.data.find((row: { code: string }) => row.code === "MARZO_ABRIL");
    expect(marzo.startsOn.toISOString()).toBe("2026-03-01T12:00:00.000Z");
  });

  it("lee los períodos del origen sin filtrar por isActive: los apagados se heredan apagados", async () => {
    mock.academicPeriod.findMany.mockResolvedValueOnce([sourcePeriod({ isActive: false })]).mockResolvedValueOnce([]);

    await inheritAcademicPeriods({ targetSchoolYearId: TARGET.id, sourceSchoolYearId: SOURCE.id }, mock as never);

    const [[sourceQuery]] = mock.academicPeriod.findMany.mock.calls;
    expect(sourceQuery.where).toEqual({ schoolYearId: SOURCE.id });
    const [[call]] = mock.academicPeriod.createMany.mock.calls;
    const marzo = call.data.find((row: { code: string }) => row.code === "MARZO_ABRIL");
    expect(marzo.isActive).toBe(false);
  });

  it("es idempotente: si ya están todos no escribe nada", async () => {
    const present = [
      ...EBI_PERIODS.map((seed, i) => ({ id: `ebi-${i}`, level: "EBI", code: seed.code })),
      ...EMS_PERIODS.map((seed, i) => ({ id: `ems-${i}`, level: "EMS", code: seed.code })),
    ];
    mock.academicPeriod.findMany.mockResolvedValue(present);

    const summary = await inheritAcademicPeriods({ targetSchoolYearId: TARGET.id }, mock as never);

    expect(summary.created).toBe(0);
    expect(summary.existing).toBe(TEMPLATE_TOTAL);
    expect(mock.academicPeriod.createMany).not.toHaveBeenCalled();
    expect(mock.academicPeriod.update).not.toHaveBeenCalled();
  });

  it("crea sólo los que faltan y no toca los que ya estaban", async () => {
    mock.academicPeriod.findMany.mockResolvedValue([{ id: "p-1", level: "EBI", code: EBI_PERIODS[0].code }]);

    const summary = await inheritAcademicPeriods({ targetSchoolYearId: TARGET.id }, mock as never);

    expect(summary.existing).toBe(1);
    expect(summary.created).toBe(TEMPLATE_TOTAL - 1);
    expect(mock.academicPeriod.update).not.toHaveBeenCalled();
  });

  it("con REFRESH_LABELS corrige nombre y orden de los existentes, nada más", async () => {
    mock.academicPeriod.findMany.mockResolvedValue([{ id: "p-1", level: "EBI", code: EBI_PERIODS[0].code }]);

    const summary = await inheritAcademicPeriods(
      { targetSchoolYearId: TARGET.id, onExisting: "REFRESH_LABELS" },
      mock as never,
    );

    expect(summary.refreshed).toBe(1);
    expect(mock.academicPeriod.update).toHaveBeenCalledTimes(1);
    const [[update]] = mock.academicPeriod.update.mock.calls;
    expect(update).toEqual({
      where: { id: "p-1" },
      data: { name: EBI_PERIODS[0].name, sortOrder: EBI_PERIODS[0].sortOrder },
    });
  });

  it("rechaza un ciclo destino que no existe", async () => {
    withYears(mock, []);
    await expect(inheritAcademicPeriods({ targetSchoolYearId: "nope" }, mock as never)).rejects.toMatchObject({
      httpStatus: 404,
      code: "SCHOOL_YEAR_NOT_FOUND",
    });
  });

  it("rechaza un ciclo origen que no existe", async () => {
    withYears(mock, [TARGET]);
    await expect(
      inheritAcademicPeriods({ targetSchoolYearId: TARGET.id, sourceSchoolYearId: "nope" }, mock as never),
    ).rejects.toMatchObject({ httpStatus: 404, code: "SOURCE_SCHOOL_YEAR_NOT_FOUND" });
  });

  it("rechaza heredar un ciclo de sí mismo antes de tocar la base", async () => {
    await expect(
      inheritAcademicPeriods({ targetSchoolYearId: TARGET.id, sourceSchoolYearId: TARGET.id }, mock as never),
    ).rejects.toBeInstanceOf(AcademicConfigError);
    expect(mock.schoolYear.findUnique).not.toHaveBeenCalled();
  });
});
