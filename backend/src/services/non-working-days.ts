import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { uruguayYmdOfInstant } from "../config/app-timezone.js";

export function utcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
}

/**
 * Feriado o día no laborable de una fecha ya armada como día: medianoche UTC del día civil
 * (`new Date(`${ymd}T00:00:00.000Z`)`) o el inicio del día en Uruguay. Para el instante en que
 * empieza una clase usar `findNonWorkingDayForInstant`.
 */
export async function findNonWorkingDayForDate(date: Date) {
  const day = utcDay(date);
  const rows = await prisma.$queryRaw<Array<{ id: string; date: Date; type: string; reason: string; notes: string | null }>>(
    Prisma.sql`
      SELECT id, date, type, reason, notes
      FROM "NonWorkingDay"
      WHERE date = ${day}
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

export async function isNonWorkingDate(date: Date) {
  return Boolean(await findNonWorkingDayForDate(date));
}

/**
 * Feriado del día civil (zona institucional) en que cae un instante. Con el día UTC, una clase
 * nocturna (21:30 en Uruguay son las 00:30 UTC del día siguiente) miraba el feriado de mañana.
 */
export async function findNonWorkingDayForInstant(at: Date) {
  return findNonWorkingDayForDate(new Date(`${uruguayYmdOfInstant(at)}T00:00:00.000Z`));
}

export async function isNonWorkingInstant(at: Date) {
  return Boolean(await findNonWorkingDayForInstant(at));
}
