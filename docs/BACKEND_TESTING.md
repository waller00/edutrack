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

Tras `npm run test:coverage`, ejecutá el scanner de Sonar para subir líneas/ramas cubiertas en **new code** y global.

## Estrategia de cobertura

| Tipo | Qué cubre |
|------|-----------|
| **Puro** | `uruguay-ci`, `attendance-logic`, `events-query`, `auth-profile-pure`, `jwt` |
| **Middleware** | `authGuard`, roles |
| **Rutas (Prisma mock)** | `admin`, `events`, `attendance` (register), `medical-leaves`, `auth` (register/verify/check-username/me) |
| **Integración** | `app` → `/health`, login inválido |

## Archivos de bajo retorno (muchas líneas / OCR / PDF)

- `dni-processor.ts`, `reports.ts`: requieren mocks pesados o E2E; opcional excluir en `sonar.coverage.exclusions` si el quality gate penaliza sin valor proporcional.
