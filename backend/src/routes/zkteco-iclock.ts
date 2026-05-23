import { Router } from "express";
import {
  attlogStatusToPunchType,
  buildIclockOptionsAllResponse,
  parseAttlogBody,
} from "../integrations/zkteco/iclock-parser.js";
import { prisma } from "../db/prisma.js";
import {
  findBiometricDeviceByAdmsSn,
  processBiometricIngest,
} from "../services/biometric-ingest-core.js";
import { tryCaptureBiometricLinkPunch } from "../services/biometric-link.js";

const r = Router();

function normalizeIp(ip: string | undefined) {
  if (!ip) return "";
  return ip.replace("::ffff:", "").trim();
}

function resolveRequestIp(req: {
  headers: Record<string, unknown>;
  ip?: string;
  connection?: { remoteAddress?: string };
}) {
  const forwarded = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return normalizeIp(forwarded || req.ip || req.connection?.remoteAddress || "");
}

function getSerialNumber(req: { query: Record<string, unknown> }): string {
  const sn = String(req.query.SN || req.query.sn || "").trim();
  return sn;
}

const ADMS_PATHS = new Set(["/cdata", "/getrequest", "/registry", "/devicecmd"]);

/** Log solo peticiones ADMS (diagnóstico: IP real del reloj). */
r.use((req, _res, next) => {
  if (!ADMS_PATHS.has(req.path)) {
    next();
    return;
  }
  const sn = getSerialNumber(req);
  console.info("[zkteco-iclock] request", {
    method: req.method,
    path: req.path,
    sn: sn || undefined,
    requestIp: resolveRequestIp(req),
    table: req.query.table,
    options: req.query.options,
  });
  next();
});

function touchDeviceSeen(deviceId: string) {
  void prisma.biometricDevice.update({
    where: { id: deviceId },
    data: { lastSeenAt: new Date() },
  });
}

function deviceIpAllowed(allowedIps: string[], requestIp: string) {
  if (allowedIps.length === 0) return true;
  return allowedIps.includes(requestIp);
}

/** GET/POST /iclock/cdata — registro y envío de fichadas (ATTLOG). */
r.all("/cdata", async (req, res) => {
  const sn = getSerialNumber(req);
  if (!sn) {
    res.status(400).type("text/plain").send("ERROR: missing SN");
    return;
  }

  const requestIp = resolveRequestIp(req);
  const table = String(req.query.table || "").toUpperCase();
  const options = String(req.query.options || "").toLowerCase();

  if (req.method === "GET" && options === "all") {
    console.info("[zkteco-iclock] options=all", { sn, requestIp });
    res.status(200).type("text/plain").send(buildIclockOptionsAllResponse(sn));
    return;
  }

  const device = await findBiometricDeviceByAdmsSn(sn);
  if (!device) {
    console.warn("[zkteco-iclock] dispositivo no registrado", { sn, requestIp });
    res.status(200).type("text/plain").send("OK");
    return;
  }

  if (!deviceIpAllowed(device.allowedIps, requestIp)) {
    console.warn("[zkteco-iclock] IP no permitida", { sn, requestIp });
    res.status(403).type("text/plain").send("ERROR: IP not allowed");
    return;
  }

  touchDeviceSeen(device.id);

  if (table === "ATTLOG" && req.method === "POST") {
    const body =
      typeof req.body === "string"
        ? req.body
        : Buffer.isBuffer(req.body)
          ? req.body.toString("utf8")
          : "";
    const records = parseAttlogBody(body, device.timezone);
    let processed = 0;

    for (const row of records) {
      const punchType = attlogStatusToPunchType(row.status);
      const externalId = `iclock-${sn}-${row.deviceUserId}-${row.occurredAt.getTime()}`;
      const payload = { source: "zkteco-iclock", sn, line: row.rawLine, status: row.status };

      const existingMapping = await prisma.biometricUserMapping.findFirst({
        where: { deviceId: device.id, deviceUserId: row.deviceUserId, isActive: true },
        select: { id: true },
      });

      if (!existingMapping) {
        const captured = await tryCaptureBiometricLinkPunch({
          deviceDbId: device.id,
          deviceCode: device.code,
          deviceUserId: row.deviceUserId,
          occurredAt: row.occurredAt,
          externalId,
          punchType,
          payload,
        });
        if (captured.handled) {
          console.info("[zkteco-iclock] marca capturada para vinculación", {
            sn,
            pin: row.deviceUserId,
            linkRequestId: captured.linkRequestId,
          });
          continue;
        }
      }

      const result = await processBiometricIngest({
        deviceDbId: device.id,
        deviceCode: device.code,
        deviceUserId: row.deviceUserId,
        occurredAt: row.occurredAt,
        externalId,
        punchType,
        payload,
      });
      if (result.ok && !result.duplicate) processed += 1;
      if (result.ok === false && result.reason === "NO_MAPPING") {
        console.warn("[zkteco-iclock] sin mapeo", { sn, pin: row.deviceUserId });
      }
    }

    res.status(200).type("text/plain").send(`OK:${processed}`);
    return;
  }

  if (table === "OPERLOG" || table === "USERINFO") {
    res.status(200).type("text/plain").send("OK");
    return;
  }

  res.status(200).type("text/plain").send("OK");
});

/** GET /iclock/getrequest — heartbeat; el dispositivo consulta comandos pendientes. */
r.get("/getrequest", async (req, res) => {
  const sn = getSerialNumber(req);
  if (!sn) {
    res.status(400).type("text/plain").send("ERROR: missing SN");
    return;
  }

  const requestIp = resolveRequestIp(req);
  const device = await findBiometricDeviceByAdmsSn(sn);
  if (device) {
    touchDeviceSeen(device.id);
  } else {
    console.warn("[zkteco-iclock] getrequest sin dispositivo en BD", { sn, requestIp });
  }

  res.status(200).type("text/plain").send("OK");
});

/** POST /iclock/registry — registro / capacidades del terminal. */
r.all("/registry", async (req, res) => {
  const sn = getSerialNumber(req);
  if (sn) {
    const device = await findBiometricDeviceByAdmsSn(sn);
    if (device) touchDeviceSeen(device.id);
    else console.warn("[zkteco-iclock] registry sin dispositivo en BD", { sn });
  }
  res.status(200).type("text/plain").send("OK");
});

/** POST /iclock/devicecmd — confirmación de comandos remotos. */
r.post("/devicecmd", async (req, res) => {
  const sn = getSerialNumber(req);
  if (sn) {
    const device = await findBiometricDeviceByAdmsSn(sn);
    if (device) touchDeviceSeen(device.id);
  }
  res.status(200).type("text/plain").send("OK");
});

export default r;
