# STAGE 1: Instalar dependencias
FROM node:20-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
RUN npx prisma generate

# STAGE 2: Compilar el código
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build || npx tsc
# Conservamos dependencias de desarrollo en testing para poder ejecutar seeds TS con `npm run seed:*`.

# STAGE 3: Imagen de producción final
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
# Instalamos solo lo mínimo necesario para que Prisma y SSL funcionen
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Copiamos solo lo que realmente se necesita para ejecutar
COPY --from=build /app/dist ./dist
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/prisma ./prisma

# Usamos un usuario con menos privilegios por seguridad
USER node

EXPOSE 4000

# Script de inicio: sincroniza esquema y arranca el servidor
CMD ["sh", "-c", "npx prisma db push --skip-generate ${PRISMA_DB_PUSH_FLAGS:-} && node --import ./dist/instrument.js dist/server.js"]
