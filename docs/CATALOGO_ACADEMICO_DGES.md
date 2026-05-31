# Catálogo académico DGES (EduTrack)

## Fuente de datos

- Definición: `backend/prisma/data/academic-catalog-dges.ts`
- Carga idempotente: `backend/prisma/seed-academic-catalog.ts`
- Docentes: `backend/prisma/data/teachers-liceo.ts` + `backend/prisma/seed-teachers.ts`
- Seed completo (admin + catálogo + docentes): `npm run seed` → `prisma/seed.ts`
- Base limpia: `npm run seed:clean` (borra operativos y vuelve a cargar el seed nuevo)

## Modelo

| Capa | Tablas / concepto |
|------|-------------------|
| Catálogo de cursos | `Course` (7–9 EBI, 1–3 EMS) |
| Catálogo de orientaciones | `Orientation` (subdivisiones EMS) |
| Catálogo de asignaturas | `Subject` |
| Plan de estudios | `SubjectCourseAssignment` (`schoolYearId = null`) |
| Oferta por ciclo | `CourseOffering`, `CourseOrientation`, asignaciones con `schoolYearId` |

`CourseOffering.isActive = false` equivale a “no ofertado / no visible en filtros operativos” para ese ciclo (ej. **2 EMS en 2026**).

## Oferta liceo 2026 (referencia horario)

**Ofertados:** 7 EBI, 8 EBI, 9 EBI, 1 EMS, 3 EMS  

**En catálogo, no ofertados 2026:** 2 EMS  

**3 EMS orientaciones ofertadas 2026:** Ciencias de la Vida, Ciencia Arte y Diseño, Ciencia y Tecnología, Humanidades y Ciencias Económicas, Humanidades y Ciencia Política  

**3 EMS en catálogo, no ofertadas 2026:** Creativo Artístico, General  

## Seeds eliminados (no usar)

- `seed.js`, `seed-liceo-6months.mjs`, `seed-new-format-testing.mjs`, `seed-demo-data.js`

## Docentes (usuarios)

- 29 usuarios con rol **TEACHER** (`OrgRole.code`, etiqueta «Docente»).
- Perfil **`TeacherProfile`** (`displayName`, `isActive`) vinculado 1:1 a `User`.
- Email: `usuario@liceo.test` — contraseña inicial: **`docente123`** (hash Argon2id).
- `emailVerifiedAt`, `isApproved`, `isActive` en true al cargar el seed.

## Activar 2 EMS u otra oferta en otro año

Editar `SCHOOL_YEAR_OFFERS` en `academic-catalog-dges.ts` o activar `CourseOffering` / `CourseOrientation` desde admin de cursos, ciclo 2027, etc.
