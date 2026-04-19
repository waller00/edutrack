# STAGE 1: Instalar dependencias
FROM node:20-bookworm-slim AS deps
WORKDIR /app
# Instalamos libc6-compat para compatibilidad con librerías nativas si fuera necesario
RUN apt-get update && apt-get install -y --no-install-recommends libc6 && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

# STAGE 2: Construir la aplicación
# NEXT_PUBLIC_* se inyecta en el cliente en tiempo de build (no alcanza con env en runtime).
FROM node:20-bookworm-slim AS builder
WORKDIR /app
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY=
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_TURNSTILE_SITE_KEY
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# STAGE 3: Imagen de producción final (Liviana)
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Creamos un usuario de sistema para no correr como root (seguridad)
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copiamos solo lo estrictamente necesario para ejecutar
COPY --from=builder /app/public ./public
# El truco: Next genera una carpeta 'standalone' con lo mínimo para correr
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT=3000

# El servidor de Next.js standalone se arranca con node server.js
CMD ["node", "server.js"]