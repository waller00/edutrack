import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { APP_TIMEZONE } from "../config/app-timezone.js";
import {
  applyEventStartDateFilter,
  buildMyEventsBaseFilter,
  applyMyEventsDateFilter,
  deriveOccurrenceStatus,
  resolveRecurringRangeEnd,
  expandRecurringEvent,
  generateRecurringInstances,
} from "./events-query.js";

describe("events-query", () => {
  it("applyEventStartDateFilter sin fechas no modifica", () => {
    const w: any = {};
    applyEventStartDateFilter(w, undefined, undefined);
    expect(w.startDate).toBeUndefined();
  });

  it("applyEventStartDateFilter con rango", () => {
    const w: any = {};
    applyEventStartDateFilter(w, "2025-01-01T00:00:00.000Z", "2025-01-31T23:59:59.000Z");
    expect(w.AND).toBeDefined();
    const single = w.AND[0].OR[0];
    const recurring = w.AND[0].OR[1];
    expect(single.startDate.gte).toBeInstanceOf(Date);
    expect(single.startDate.lte).toBeInstanceOf(Date);
    expect(recurring.startDate.lte).toBeInstanceOf(Date);
    expect(recurring.OR[1].recurrenceEnd.gte).toBeInstanceOf(Date);
  });

  it("buildMyEventsBaseFilter", () => {
    const f = buildMyEventsBaseFilter("uid-1");
    expect(f.OR).toHaveLength(2);
  });

  it("applyMyEventsDateFilter reemplaza OR por AND", () => {
    const w: any = { OR: [{ x: 1 }] };
    applyMyEventsDateFilter(w, "uid-1", "2025-06-01T00:00:00.000Z", "2025-06-07T00:00:00.000Z");
    expect(w.AND).toBeDefined();
    expect(w.OR).toBeUndefined();
  });

  it("applyMyEventsDateFilter sin fechas no modifica", () => {
    const w: any = { OR: [{ userId: "uid-1" }] };
    applyMyEventsDateFilter(w, "uid-1", undefined, undefined);
    expect(w.OR).toEqual([{ userId: "uid-1" }]);
    expect(w.AND).toBeUndefined();
  });

  it("applyMyEventsDateFilter con solo endDate no agrega OR de recurrenceEnd", () => {
    const w: any = { OR: [{ userId: "uid-1" }] };
    applyMyEventsDateFilter(w, "uid-1", undefined, "2025-06-07T00:00:00.000Z");
    const recurring = w.AND[1].OR[1];
    expect(recurring.startDate.lte).toBeInstanceOf(Date);
    expect(recurring.OR).toBeUndefined();
  });

  it("resolveRecurringRangeEnd prioriza endDate query", () => {
    const ev = { startDate: "2020-01-01", recurrenceEnd: null };
    expect(resolveRecurringRangeEnd(ev, "2025-12-31")).toEqual(new Date("2025-12-31"));
  });

  it("deriveOccurrenceStatus calcula estado por horario de ocurrencia", () => {
    const now = Date.now();
    expect(
      deriveOccurrenceStatus("SCHEDULED", new Date(now - 60_000), new Date(now + 60_000)),
    ).toBe("IN_PROGRESS");
    expect(
      deriveOccurrenceStatus("SCHEDULED", new Date(now - 120_000), new Date(now - 60_000)),
    ).toBe("COMPLETED");
    expect(
      deriveOccurrenceStatus("SCHEDULED", new Date(now + 60_000), new Date(now + 120_000)),
    ).toBe("SCHEDULED");
    expect(
      deriveOccurrenceStatus("CANCELLED", new Date(now + 60_000), new Date(now + 120_000)),
    ).toBe("CANCELLED");
  });

  it("resolveRecurringRangeEnd usa recurrenceEnd del evento o startDate si no existe", () => {
    expect(
      resolveRecurringRangeEnd({ startDate: "2020-01-01", recurrenceEnd: "2025-11-30T00:00:00.000Z" })
    ).toEqual(new Date("2025-11-30T00:00:00.000Z"));
    const fallback = resolveRecurringRangeEnd({ startDate: "2999-01-01T00:00:00.000Z", recurrenceEnd: null });
    expect(fallback.getTime()).toBe(new Date("2999-01-01T00:00:00.000Z").getTime());
  });

  it("expandRecurringEvent sin rango devuelve evento único", () => {
    const ev = { id: "1", isRecurring: true, daysOfWeek: [1] };
    expect(expandRecurringEvent(ev, undefined, undefined)).toEqual([ev]);
  });

  it("expandRecurringEvent genera instancias por día de semana", () => {
    const ev = {
      id: "e1",
      isRecurring: true,
      daysOfWeek: [1],
      startDate: "2025-06-02T00:00:00.000Z",
      startTime: null,
      endTime: null,
    };
    const out = expandRecurringEvent(ev, "2025-06-02T00:00:00.000Z", "2025-06-08T00:00:00.000Z");
    expect(out.length).toBeGreaterThan(0);
    expect(out.some((x: any) => x.isInstance)).toBe(true);
  });

  it("generateRecurringInstances respeta daysOfWeek", () => {
    const ev = {
      id: "x",
      daysOfWeek: [3],
      startTime: null,
      endTime: null,
    };
    const start = new Date("2025-06-01T12:00:00.000Z");
    const end = new Date("2025-06-10T12:00:00.000Z");
    const inst = generateRecurringInstances(ev, start, end);
    expect(
      inst.every(
        (i) =>
          DateTime.fromJSDate(new Date(i.startDate), { zone: "utc" }).setZone(APP_TIMEZONE).weekday % 7 === 3,
      ),
    ).toBe(true);
  });

  it("generateRecurringInstances propaga startTime y endTime por instancia", () => {
    const ev = {
      id: "rec",
      daysOfWeek: [1],
      startTime: new Date("2025-06-02T09:30:00.000Z"),
      endTime: new Date("2025-06-02T11:45:00.000Z"),
    };
    const start = new Date("2025-06-02T12:00:00.000Z");
    const end = new Date("2025-06-16T12:00:00.000Z");
    const inst = generateRecurringInstances(ev, start, end);
    expect(inst.length).toBeGreaterThan(0);
    const withTimes = inst.filter((i: { startTime?: Date | null; endTime?: Date | null }) => i.startTime && i.endTime);
    expect(withTimes.length).toBeGreaterThan(0);
  });

  it("applyEventStartDateFilter: solo inicio / solo fin", () => {
    const a: any = {};
    applyEventStartDateFilter(a, "2025-01-01T00:00:00.000Z", undefined);
    expect(a.AND[0].OR[0].startDate.gte).toBeInstanceOf(Date);
    expect(a.AND[0].OR[0].startDate.lte).toBeUndefined();

    const b: any = {};
    applyEventStartDateFilter(b, undefined, "2025-01-31T00:00:00.000Z");
    expect(b.AND[0].OR[0].startDate.lte).toBeInstanceOf(Date);
    expect(b.AND[0].OR[0].startDate.gte).toBeUndefined();
  });

  it("applyEventStartDateFilter: conserva where.AND existente (array y objeto)", () => {
    const arr: any = { AND: [{ x: 1 }] };
    applyEventStartDateFilter(arr, "2025-01-01T00:00:00.000Z", "2025-01-31T00:00:00.000Z");
    expect(arr.AND).toHaveLength(2);

    const obj: any = { AND: { y: 2 } };
    applyEventStartDateFilter(obj, "2025-01-01T00:00:00.000Z", "2025-01-31T00:00:00.000Z");
    expect(obj.AND).toHaveLength(2);
  });

  it("applyMyEventsDateFilter: solo inicio y solo fin", () => {
    const a: any = { OR: [{ userId: "u" }] };
    applyMyEventsDateFilter(a, "u", "2025-06-01T00:00:00.000Z", undefined);
    expect(a.AND).toBeDefined();
    const b: any = { OR: [{ userId: "u" }] };
    applyMyEventsDateFilter(b, "u", undefined, "2025-06-30T00:00:00.000Z");
    expect(b.AND).toBeDefined();
  });

  it("resolveRecurringRangeEnd: endDate, recurrenceEnd o fallback", () => {
    expect(resolveRecurringRangeEnd({}, "2025-12-31T00:00:00.000Z").toISOString()).toBe("2025-12-31T00:00:00.000Z");
    expect(resolveRecurringRangeEnd({ recurrenceEnd: "2025-11-30T00:00:00.000Z" }).toISOString()).toBe(
      "2025-11-30T00:00:00.000Z",
    );
    const fallback = resolveRecurringRangeEnd({ startDate: "2020-01-01T00:00:00.000Z" });
    expect(fallback.getTime()).toBeGreaterThanOrEqual(new Date("2020-01-01").getTime());
  });
});
