import { describe, expect, it } from "vitest";
import { attlogStatusToPunchType, buildIclockOptionsAllResponse, parseAttlogBody } from "./iclock-parser.js";

describe("parseAttlogBody", () => {
  it("parsea línea ATTLOG con fecha local Uruguay", () => {
    const rows = parseAttlogBody("1001\t2026-05-21 14:30:00\t0\t15\n", "America/Montevideo");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceUserId).toBe("1001");
    expect(rows[0]!.status).toBe(0);
    expect(rows[0]!.occurredAt).toBeInstanceOf(Date);
  });

  it("ignora líneas vacías o mal formadas", () => {
    const rows = parseAttlogBody("\n\nbad\n1002\t2026-05-21 08:00:00\t1\n", "America/Montevideo");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceUserId).toBe("1002");
  });

  it("acepta timestamp unix en segundos", () => {
    const epoch = 1_770_000_000;
    const rows = parseAttlogBody(`1003\t${epoch}\t0\t1\n`, "America/Montevideo");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.deviceUserId).toBe("1003");
    expect(rows[0]!.occurredAt.getTime()).toBe(epoch * 1000);
  });
});

describe("buildIclockOptionsAllResponse", () => {
  it("incluye el SN del dispositivo", () => {
    const text = buildIclockOptionsAllResponse("SRN5260500102");
    expect(text).toContain("GET OPTION FROM: SRN5260500102");
  });
});

describe("attlogStatusToPunchType", () => {
  it("mapea 0/1 a entrada/salida", () => {
    expect(attlogStatusToPunchType(0)).toBe("CHECK_IN");
    expect(attlogStatusToPunchType(1)).toBe("CHECK_OUT");
    expect(attlogStatusToPunchType(99)).toBeUndefined();
  });
});
