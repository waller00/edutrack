import { describe, it, expect } from "vitest";
import {
  getDuplicateAttendanceMessage,
  getAttendanceStatus,
  getBiometricStatus,
  isBiometricLate,
  buildBiometricAttendancePayload,
} from "./attendance-logic.js";

describe("getDuplicateAttendanceMessage", () => {
  it("distingue entrada y salida", () => {
    expect(getDuplicateAttendanceMessage("CHECK_IN")).toContain("entrada");
    expect(getDuplicateAttendanceMessage("CHECK_OUT")).toContain("salida");
  });
});

describe("getAttendanceStatus", () => {
  const t = (iso: string) => new Date(iso);

  it("con licencia aprobada siempre ausencia justificada", () => {
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: t("2025-06-01T10:00:00Z"),
        startTime: t("2025-06-01T08:00:00Z"),
        hasApprovedLicense: true,
      })
    ).toBe("ABSENT_JUSTIFIED");
  });

  it("CHECK_IN sin hora de inicio del evento → PRESENT", () => {
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: t("2025-06-01T09:00:00Z"),
        startTime: null,
        hasApprovedLicense: false,
      })
    ).toBe("PRESENT");
  });

  it("CHECK_IN hasta 5 min tarde → PRESENT", () => {
    const start = t("2025-06-01T09:00:00Z");
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: new Date(start.getTime() + 5 * 60 * 1000),
        startTime: start,
        hasApprovedLicense: false,
      })
    ).toBe("PRESENT");
  });

  it("CHECK_IN más de 5 min tarde → LATE", () => {
    const start = t("2025-06-01T09:00:00Z");
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: new Date(start.getTime() + 6 * 60 * 1000),
        startTime: start,
        hasApprovedLicense: false,
      })
    ).toBe("LATE");
  });

  it("CHECK_IN respeta tolerancia configurable", () => {
    const start = t("2025-06-01T09:00:00Z");
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: new Date(start.getTime() + 10 * 60 * 1000),
        startTime: start,
        hasApprovedLicense: false,
        lateToleranceMinutes: 10,
      })
    ).toBe("PRESENT");
    expect(
      getAttendanceStatus({
        type: "CHECK_IN",
        actualTime: new Date(start.getTime() + 11 * 60 * 1000),
        startTime: start,
        hasApprovedLicense: false,
        lateToleranceMinutes: 10,
      })
    ).toBe("LATE");
  });

  it("CHECK_OUT sin hora fin → EXIT", () => {
    expect(
      getAttendanceStatus({
        type: "CHECK_OUT",
        actualTime: t("2025-06-01T17:00:00Z"),
        endTime: null,
        hasApprovedLicense: false,
      })
    ).toBe("EXIT");
  });

  it("CHECK_OUT hasta 5 min antes del fin → EXIT", () => {
    const end = t("2025-06-01T18:00:00Z");
    expect(
      getAttendanceStatus({
        type: "CHECK_OUT",
        actualTime: new Date(end.getTime() - 5 * 60 * 1000),
        endTime: end,
        hasApprovedLicense: false,
      })
    ).toBe("EXIT");
  });

  it("CHECK_OUT más de 5 min antes del fin → EARLY_EXIT", () => {
    const end = t("2025-06-01T18:00:00Z");
    expect(
      getAttendanceStatus({
        type: "CHECK_OUT",
        actualTime: new Date(end.getTime() - 10 * 60 * 1000),
        endTime: end,
        hasApprovedLicense: false,
      })
    ).toBe("EARLY_EXIT");
  });
});

describe("getBiometricStatus", () => {
  it("CHECK_OUT por defecto es EXIT y puede ser EARLY_EXIT", () => {
    expect(getBiometricStatus("CHECK_OUT", true)).toBe("EXIT");
    expect(getBiometricStatus("CHECK_OUT", false)).toBe("EXIT");
    expect(getBiometricStatus("CHECK_OUT", false, true)).toBe("EARLY_EXIT");
  });

  it("CHECK_IN tarde → LATE", () => {
    expect(getBiometricStatus("CHECK_IN", true)).toBe("LATE");
    expect(getBiometricStatus("CHECK_IN", false)).toBe("PRESENT");
  });
});

describe("isBiometricLate", () => {
  it("después de 8:30 es tarde", () => {
    expect(isBiometricLate(new Date("2025-01-01T08:31:00"))).toBe(true);
    expect(isBiometricLate(new Date("2025-01-01T09:00:00"))).toBe(true);
  });

  it("8:30 exacto no es tarde", () => {
    expect(isBiometricLate(new Date("2025-01-01T08:30:00"))).toBe(false);
  });

  it("antes de 8:30 no es tarde", () => {
    expect(isBiometricLate(new Date("2025-01-01T08:00:00"))).toBe(false);
  });
});

describe("buildBiometricAttendancePayload", () => {
  const uid = "user-uuid-1";
  const d = new Date("2025-06-01");
  const t = new Date("2025-06-01T09:00:00Z");

  it("CHECK_IN incluye nota de dispositivo", () => {
    const p = buildBiometricAttendancePayload({
      userId: uid,
      attendanceDate: d,
      attendanceTime: t,
      deviceId: "DEV-1",
      type: "CHECK_IN",
    });
    expect(p.userId).toBe(uid);
    expect(p.type).toBe("CHECK_IN");
    expect(p.status).toBe("PRESENT");
    expect(String(p.notes)).toContain("DEV-1");
    expect(String(p.notes)).toContain("Entrada");
  });

  it("CHECK_IN tarde añade RETRASO", () => {
    const p = buildBiometricAttendancePayload({
      userId: uid,
      attendanceDate: d,
      attendanceTime: t,
      isLate: true,
      type: "CHECK_IN",
    });
    expect(p.status).toBe("LATE");
    expect(String(p.notes)).toContain("RETRASO");
  });

  it("sin deviceId usa N/A", () => {
    const p = buildBiometricAttendancePayload({
      userId: uid,
      attendanceDate: d,
      attendanceTime: t,
      type: "CHECK_OUT",
    });
    expect(String(p.notes)).toContain("N/A");
    expect(p.status).toBe("EXIT");
  });

  it("CHECK_OUT anticipado añade estado y nota", () => {
    const p = buildBiometricAttendancePayload({
      userId: uid,
      attendanceDate: d,
      attendanceTime: t,
      type: "CHECK_OUT",
      status: "EARLY_EXIT",
    });
    expect(p.status).toBe("EARLY_EXIT");
    expect(String(p.notes)).toContain("SALIDA ANTICIPADA");
  });
});
