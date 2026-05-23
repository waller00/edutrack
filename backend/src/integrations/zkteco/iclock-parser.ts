import { DateTime } from "luxon";

export type ParsedAttlogLine = {
  deviceUserId: string;
  occurredAt: Date;
  /** 0 = entrada, 1 = salida (convención ZKTeco ATTLOG). */
  status?: number;
  verifyMode?: number;
  rawLine: string;
};

const TIMESTAMP_FORMAT = "yyyy-LL-dd HH:mm:ss";

export function parseAttlogBody(body: string, timezone: string): ParsedAttlogLine[] {
  const lines: ParsedAttlogLine[] = [];
  const zone = timezone || "America/Montevideo";

  for (const raw of body.split("\n")) {
    const line = raw.replace(/\r$/, "").trim();
    if (!line) continue;

    const parts = line.split("\t");
    if (parts.length < 2) continue;

    const deviceUserId = parts[0]!.trim();
    if (!deviceUserId) continue;

    const tsRaw = parts[1]!.trim();
    let occurredAt: Date | null = null;

    const fromLocal = DateTime.fromFormat(tsRaw, TIMESTAMP_FORMAT, { zone });
    if (fromLocal.isValid) {
      occurredAt = fromLocal.toUTC().toJSDate();
    } else {
      const epoch = Number(tsRaw);
      if (Number.isFinite(epoch) && epoch > 0) {
        occurredAt = new Date(epoch * 1000);
      }
    }
    if (!occurredAt || Number.isNaN(occurredAt.getTime())) continue;

    const status = parts.length > 2 ? Number(parts[2]) : undefined;
    const verifyMode = parts.length > 3 ? Number(parts[3]) : undefined;

    lines.push({
      deviceUserId,
      occurredAt,
      status: Number.isFinite(status) ? status : undefined,
      verifyMode: Number.isFinite(verifyMode) ? verifyMode : undefined,
      rawLine: line,
    });
  }

  return lines;
}

export function attlogStatusToPunchType(status: number | undefined): "CHECK_IN" | "CHECK_OUT" | undefined {
  if (status === 0) return "CHECK_IN";
  if (status === 1) return "CHECK_OUT";
  return undefined;
}

/** Respuesta inicial GET /iclock/cdata?options=all (protocolo push ZKTeco). */
export function buildIclockOptionsAllResponse(serialNumber: string): string {
  const sn = serialNumber.trim() || "UNKNOWN";
  return [
    `GET OPTION FROM: ${sn}`,
    "ATTLOGStamp=0",
    "OPERLOGStamp=0",
    "ATTPHOTOStamp=0",
    "ErrorDelay=30",
    "Delay=30",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransFlag=TransData AttLog\tOpLog\tAttPhoto",
    "TimeZone=-3",
    "Realtime=1",
    "Encrypt=0",
  ].join("\n");
}
