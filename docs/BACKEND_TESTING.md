# Tests del backend (Vitest + SonarQube)

## Comandos

```bash
cd backend
npm run test              # suite completa
npm run test:watch
npm run test:coverage     # genera coverage/lcov.info (SonarQube)
```

## SonarQube

En `sonar-project.properties`:

```properties
sonar.javascript.lcov.reportPaths=backend/coverage/lcov.info,...
```

Tras `npm run test:coverage`, ejecutá el scanner de Sonar para subir líneas/ramas cubiertas.

Objetivo global (backend + frontend): **≥ 70%**. `dni-processor.ts` está excluido de la métrica por bajo retorno (OCR).

## Estrategia de cobertura

| Tipo | Qué cubre |
|------|-----------|
| **Puro** | `uruguay-ci`, `attendance-logic`, `events-query`, `auth-profile-pure`, `password-policy` |
| **Middleware** | `authGuard`, permisos |
| **Rutas (Prisma mock)** | `admin`, `events`, `attendance`, `medical-leaves`, `auth` (register/verify/me) |
| **Integración** | `app` → `/health`, auth |

## Archivos de bajo retorno

- `dni-processor.ts`, `reports.ts`: mocks pesados o E2E; excluidos o parcialmente cubiertos según `sonar.coverage.exclusions`.

## Auth en tests

En `NODE_ENV=test`, `authGuard` acepta Bearer token de prueba (`backend/src/test-utils/bearer-token.ts`) además de cookie `sid`.
