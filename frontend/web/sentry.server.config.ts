import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  const environment = process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development";

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.user) event.user = { id: event.user.id };
      if (event.request?.cookies) delete event.request.cookies;
      return event;
    },
  });
}
