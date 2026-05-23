import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEVICE_CODE = process.env.BIOMETRIC_DEVICE_CODE || "F22-LOCAL-01";
const DEVICE_NAME = process.env.BIOMETRIC_DEVICE_NAME || "ZKTeco F22 Local";
const DEVICE_SECRET = process.env.BIOMETRIC_DEVICE_SECRET || "local-f22-secret";
/** Número de serie del terminal (menú del F22 / ADMS SN). Obligatorio para push directo iClock. */
const DEVICE_ADMS_SERIAL = process.env.BIOMETRIC_ADMS_SERIAL || "";
const DEVICE_TIMEZONE = process.env.BIOMETRIC_DEVICE_TZ || "America/Montevideo";
const MAX_MAPPINGS = Number(process.env.BIOMETRIC_SEED_MAX_USERS || 5);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function main() {
  const users = await prisma.user.findMany({
    where: { isActive: true, isApproved: true },
    orderBy: { createdAt: "asc" },
    take: MAX_MAPPINGS,
    select: { id: true, email: true, username: true, firstName: true, lastName: true },
  });

  if (users.length === 0) {
    console.log("[biometric-seed] No hay usuarios activos/aprobados para mapear.");
    return;
  }

  const device = await prisma.biometricDevice.upsert({
    where: { code: DEVICE_CODE },
    create: {
      code: DEVICE_CODE,
      admsSerial: DEVICE_ADMS_SERIAL || null,
      name: DEVICE_NAME,
      secretHash: sha256(DEVICE_SECRET),
      timezone: DEVICE_TIMEZONE,
      isActive: true,
    },
    update: {
      name: DEVICE_NAME,
      admsSerial: DEVICE_ADMS_SERIAL || null,
      secretHash: sha256(DEVICE_SECRET),
      timezone: DEVICE_TIMEZONE,
      isActive: true,
    },
    select: { id: true, code: true, name: true, timezone: true },
  });

  const mappings = [];
  for (const [index, user] of users.entries()) {
    const deviceUserId = String(1001 + index);
    const mapping = await prisma.biometricUserMapping.upsert({
      where: {
        deviceId_deviceUserId: {
          deviceId: device.id,
          deviceUserId,
        },
      },
      create: {
        deviceId: device.id,
        userId: user.id,
        deviceUserId,
        isActive: true,
      },
      update: {
        userId: user.id,
        isActive: true,
      },
      select: { id: true, deviceUserId: true, userId: true },
    });
    mappings.push({ mapping, user });
  }

  console.log("");
  console.log("[biometric-seed] Dispositivo ADMS listo:");
  console.log(`- code: ${device.code}`);
  if (DEVICE_ADMS_SERIAL) console.log(`- admsSerial (SN): ${DEVICE_ADMS_SERIAL}`);
  else console.log("- admsSerial: (no definido — configurar BIOMETRIC_ADMS_SERIAL con el SN del F22)");
  console.log(`- name: ${device.name}`);
  console.log(`- timezone: ${device.timezone}`);
  console.log(`- secret (plain): ${DEVICE_SECRET}`);
  console.log("");
  console.log("[biometric-seed] Mapeos creados/actualizados:");
  for (const row of mappings) {
    const label = row.user.username || row.user.email || `${row.user.firstName || ""} ${row.user.lastName || ""}`.trim();
    console.log(`- deviceUserId ${row.mapping.deviceUserId} -> ${label} (${row.mapping.userId})`);
  }
  console.log("");
  console.log("[biometric-seed] Ejemplo de payload para probar:");
  console.log(
    JSON.stringify(
      {
        deviceCode: DEVICE_CODE,
        deviceUserId: mappings[0]?.mapping.deviceUserId || "1001",
        timestamp: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error("[biometric-seed] Error:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
