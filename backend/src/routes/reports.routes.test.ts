import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import cookieParser from "cookie-parser";
import { signAccessToken } from "../jwt.js";

const { prismaMock, workbookWriteSpy, MockWorkbook, MockPDFDocument, pdfInstances } = vi.hoisted(() => {
  class HoistedWorksheet {
    rows: any[] = [];
    columns: any[] = [];
    lastRow = { number: 0 };

    addRow(values: any[]) {
      const rowNumber = this.rows.length + 1;
      const row: any = {
        values,
        number: rowNumber,
        font: {},
        height: undefined,
        getCell: vi.fn(() => ({ font: {}, alignment: {}, style: {} })),
        eachCell: vi.fn((cb: (cell: any, colNumber: number) => void) => {
          values.forEach((_value, index) => cb({ style: {}, fill: {}, font: {}, alignment: {} }, index + 1));
        }),
      };
      this.rows.push(row);
      this.lastRow = { number: rowNumber };
      return row;
    }

    mergeCells = vi.fn();
    getRow = vi.fn((rowNumber: number) => this.rows[rowNumber - 1] ?? { getCell: () => ({ font: {} }) });
    eachRow = vi.fn((cb: (row: any, rowNumber: number) => void) => {
      this.rows.forEach((row, index) => cb(row, index + 1));
    });
  }

  const writeSpy = vi.fn(async () => undefined);

  class HoistedWorkbook {
    xlsx = { write: (...args: any[]) => writeSpy(...args) };
    worksheets: HoistedWorksheet[] = [];

    addWorksheet() {
      const sheet = new HoistedWorksheet();
      this.worksheets.push(sheet);
      return sheet;
    }
  }

  const instances: HoistedPDFDocument[] = [];

  class HoistedPDFDocument {
    y = 40;
    private response: any;
    constructor() {
      instances.push(this);
    }
    pipe = vi.fn((res: any) => {
      this.response = res;
      return res;
    });
    end = vi.fn(() => {
      this.response?.end?.();
      return this;
    });
    addPage = vi.fn(() => {
      this.y = 40;
      return this;
    });
    fontSize = vi.fn(() => this);
    fillColor = vi.fn(() => this);
    text = vi.fn(() => {
      this.y += 12;
      return this;
    });
    moveDown = vi.fn(() => {
      this.y += 10;
      return this;
    });
    strokeColor = vi.fn(() => this);
    lineWidth = vi.fn(() => this);
    moveTo = vi.fn(() => this);
    lineTo = vi.fn(() => this);
    stroke = vi.fn(() => this);
    rect = vi.fn(() => this);
    fillAndStroke = vi.fn(() => this);
  }

  return {
  prismaMock: {
    attendance: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
  },
  workbookWriteSpy: writeSpy,
  MockWorkbook: HoistedWorkbook,
  MockPDFDocument: HoistedPDFDocument,
  pdfInstances: instances,
}});

vi.mock("../prisma.js", () => ({ prisma: prismaMock }));
vi.mock("exceljs", () => ({
  default: { Workbook: MockWorkbook },
}));
vi.mock("pdfkit", () => ({
  default: MockPDFDocument,
}));

import reportsRoutes, {
  applyReportFilters,
  buildDetailedRecord,
  createEventStat,
  createUserStat,
  generateExcelReport,
  generatePDFReport,
  getTruncatedText,
  processAttendanceData,
  updateEventCounters,
  updateUserAttendanceRange,
  updateUserCounters,
} from "./reports.js";

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/reports", reportsRoutes);
  return a;
}

const adminHdr = () => ({
  Authorization: `Bearer ${signAccessToken({ sub: "adm", email: "admin@example.com", role: "ADMIN" })}`,
});

function createResponseMock() {
  return {
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end: vi.fn(),
  };
}

const attendanceWithEvent = {
  id: "att-1",
  date: new Date("2025-06-01T00:00:00.000Z"),
  time: "08:00",
  type: "CHECK_IN",
  status: "PRESENT",
  notes: "Todo ok",
  user: {
    id: "u1",
    name: "Ada",
    username: "ada",
    email: "ada@example.com",
    role: "STAFF",
  },
  event: {
    id: "e1",
    title: "Evento principal",
    type: "CLASE",
    startTime: new Date("2025-06-01T08:00:00.000Z"),
    endTime: new Date("2025-06-01T10:00:00.000Z"),
  },
};

describe("reports helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("applyReportFilters maps all supported filters", () => {
    const where: any = {};
    applyReportFilters(where, {
      startDate: "2025-06-01T00:00:00.000Z",
      endDate: "2025-06-30T00:00:00.000Z",
      userId: "u1",
      eventId: "e1",
      eventType: "CLASE",
      type: "CHECK_IN",
      status: "PRESENT",
      role: "STAFF",
    });
    expect(where.date.gte).toBeInstanceOf(Date);
    expect(where.date.lte).toBeInstanceOf(Date);
    expect(where.userId).toBe("u1");
    expect(where.eventId).toEqual({ not: null });
    expect(where.event.type).toBe("CLASE");
    expect(where.type).toBe("CHECK_IN");
    expect(where.status).toBe("PRESENT");
    expect(where.user.role).toBe("STAFF");
  });

  it("builds detailed records and user/event stats", () => {
    const record = buildDetailedRecord(attendanceWithEvent);
    expect(record.userName).toBe("Ada");
    expect(record.eventTitle).toBe("Evento principal");

    const userStats = createUserStat(attendanceWithEvent, "Ada");
    updateUserCounters(userStats, attendanceWithEvent);
    expect(userStats.totalAttendances).toBe(1);
    expect(userStats.attendanceRate).toBe(0);
    updateUserAttendanceRange(userStats, "2025-06-02T00:00:00.000Z");
    expect(userStats.lastAttendance).toBe("2025-06-02T00:00:00.000Z");

    const eventStats = createEventStat(attendanceWithEvent);
    updateEventCounters(eventStats, attendanceWithEvent);
    expect(eventStats.totalAssigned).toBe(1);
    expect(eventStats.attended).toBe(1);
  });

  it("processAttendanceData aggregates users, events and summary", () => {
    const exitAttendance = {
      ...attendanceWithEvent,
      id: "att-2",
      type: "CHECK_OUT",
      status: "EXIT",
      date: new Date("2025-06-03T00:00:00.000Z"),
    };
    const result = processAttendanceData([attendanceWithEvent, exitAttendance], { role: "STAFF" });
    expect(result.totalRecords).toBe(2);
    expect(result.userStats[0].presentCount).toBe(1);
    expect(result.userStats[0].exitCount).toBe(1);
    expect(result.eventStats[0].attendanceRate).toBe(50);
    expect(result.summary.totalUsers).toBe(1);
  });

  it("truncates long text and returns fallback for empty values", () => {
    expect(getTruncatedText("abcdef", 4, "N/A")).toBe("abcd...");
    expect(getTruncatedText(undefined, 4, "N/A")).toBe("N/A");
  });

  it("generates excel and pdf reports with mocked writers", async () => {
    const data = processAttendanceData([attendanceWithEvent], {});
    const excelRes = createResponseMock();
    await generateExcelReport(data, excelRes, {});
    expect(excelRes.headers["Content-Type"]).toContain("spreadsheetml");
    expect(workbookWriteSpy).toHaveBeenCalled();
    expect(excelRes.end).toHaveBeenCalled();

    const pdfRes = createResponseMock();
    await generatePDFReport(data, pdfRes, {});
    expect(pdfRes.headers["Content-Type"]).toBe("application/pdf");
  });

  it("generateExcelReport colorea LATE y ABSENT_NOT_JUSTIFIED", async () => {
    const late = { ...attendanceWithEvent, id: "a2", status: "LATE" as const };
    const absent = { ...attendanceWithEvent, id: "a3", status: "ABSENT_NOT_JUSTIFIED" as const };
    const data = processAttendanceData([late, absent], {});
    const excelRes = createResponseMock();
    await generateExcelReport(data, excelRes, {});
    expect(workbookWriteSpy).toHaveBeenCalled();
  });

  it("generates pdf covering medium/low rates and continuation pages", async () => {
    const manyUserStats = Array.from({ length: 30 }, (_, index) => ({
      id: `u${index}`,
      name: `Usuario ${index}`,
      email: `user${index}@example.com`,
      role: "STAFF",
      totalAttendances: 10,
      presentCount: 5,
      lateCount: 1,
      absentNotJustifiedCount: 2,
      absentJustifiedCount: 1,
      exitCount: 1,
      earlyExitCount: 0,
      totalEvents: 10,
      attendedEvents: 7,
      attendanceRate: index === 0 ? 75 : 60,
      firstAttendance: "2025-06-01T00:00:00.000Z",
      lastAttendance: "2025-06-02T00:00:00.000Z",
    }));
    const manyEventStats = Array.from({ length: 30 }, (_, index) => ({
      id: `e${index}`,
      title: `Evento ${index} ${"x".repeat(30)}`,
      type: index === 0 ? undefined : "CLASE",
      totalAssigned: 10,
      attended: 7,
      attendanceRate: index === 0 ? 75 : 60,
    }));
    const pdfRes = createResponseMock();

    await generatePDFReport(
      {
        filters: {},
        userStats: manyUserStats,
        eventStats: manyEventStats,
        detailedRecords: [],
        totalRecords: 0,
        summary: { totalUsers: manyUserStats.length, totalEvents: manyEventStats.length, averageAttendanceRate: 68 },
      },
      pdfRes,
      {},
    );

    const pdf = pdfInstances.at(-1);
    expect(pdf).toBeDefined();
    expect(pdf?.addPage).toHaveBeenCalled();
    expect(pdf?.fillColor).toHaveBeenCalledWith("#856404");
    expect(pdf?.fillColor).toHaveBeenCalledWith("#721C24");
  });
});

describe("reports routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /reports/report generates excel by default", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([attendanceWithEvent]);
    const res = await request(app()).get("/reports/report").set(adminHdr());
    expect(res.status).toBe(200);
    expect(workbookWriteSpy).toHaveBeenCalled();
  });

  it("GET /reports/report generates pdf when requested", async () => {
    prismaMock.attendance.findMany.mockResolvedValue([attendanceWithEvent]);
    const res = await request(app()).get("/reports/report?format=pdf").set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
  });

  it("GET /reports/report handles prisma errors", async () => {
    prismaMock.attendance.findMany.mockRejectedValueOnce(new Error("db"));
    const res = await request(app()).get("/reports/report").set(adminHdr());
    expect(res.status).toBe(500);
  });

  it("GET /reports/user-events/:userId returns events and applies date filters", async () => {
    prismaMock.event.findMany.mockResolvedValue([{ id: "e1", title: "Evento" }]);
    const res = await request(app())
      .get("/reports/user-events/u1?startDate=2025-06-01T00:00:00.000Z&endDate=2025-06-30T00:00:00.000Z")
      .set(adminHdr());
    expect(res.status).toBe(200);
    expect(res.body[0].id).toBe("e1");
    expect(prismaMock.event.findMany).toHaveBeenCalled();
  });

  it("GET /reports/user-events/:userId handles errors", async () => {
    prismaMock.event.findMany.mockRejectedValueOnce(new Error("db"));
    const res = await request(app())
      .get("/reports/user-events/u1")
      .set(adminHdr());
    expect(res.status).toBe(500);
  });
});
