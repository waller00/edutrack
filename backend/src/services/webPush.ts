import webpush from "web-push";
import { prisma } from "../prisma.js";

let vapidApplied = false;

export function isWebPushConfigured(): boolean {
  return Boolean(
    process.env.VAPID_PUBLIC_KEY?.trim() &&
      process.env.VAPID_PRIVATE_KEY?.trim() &&
      process.env.VAPID_SUBJECT?.trim(),
  );
}

function applyVapidDetails(): void {
  if (vapidApplied || !isWebPushConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!.trim(),
    process.env.VAPID_PUBLIC_KEY!.trim(),
    process.env.VAPID_PRIVATE_KEY!.trim(),
  );
  vapidApplied = true;
}

/** Clave pública para `PushManager.subscribe` en el cliente. */
export function getVapidPublicKey(): string | null {
  const k = process.env.VAPID_PUBLIC_KEY?.trim();
  return k || null;
}

export type WebPushPayload = {
  title: string;
  body: string;
  /** Ruta en el front (mismo origen), ej. `/teacher/licenses`. */
  url?: string;
};

/**
 * Envía el mismo payload JSON a todas las suscripciones del usuario.
 * Elimina suscripciones inválidas (410/404).
 */
export async function sendWebPushPayloadToUser(
  userId: string,
  payload: WebPushPayload,
): Promise<{ sent: number; failed: number }> {
  if (!isWebPushConfigured()) return { sent: 0, failed: 0 };
  applyVapidDetails();

  const bodyStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || "/",
  });

  const subs = await prisma.webPushSubscription.findMany({ where: { userId } });
  let sent = 0;
  let failed = 0;

  for (const s of subs) {
    const pushSubscription = {
      endpoint: s.endpoint,
      keys: { p256dh: s.p256dh, auth: s.auth },
    };
    try {
      await webpush.sendNotification(pushSubscription, bodyStr, {
        TTL: 60 * 60 * 24,
        urgency: "normal",
      });
      sent++;
    } catch (err: unknown) {
      failed++;
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 410 || status === 404) {
        await prisma.webPushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
      }
    }
  }

  return { sent, failed };
}
