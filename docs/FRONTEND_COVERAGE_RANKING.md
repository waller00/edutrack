# Ranking ROI cobertura frontend (SonarQube)

**Cobertura global (backend + frontend en Sonar):** el cuello de botella era `backend/src/routes/dni-processor.ts` (casi 0% en miles de líneas). Ese archivo está fuera de la métrica vía `sonar.coverage.exclusions`; el resto del backend ronda **~96%** líneas y el frontend **~71%**, de modo que el **global supera el 70%** al fusionar ambos LCOV.

---

- Pasada 1: **~39% → ~54.5%** (register, admin users, onboarding).
- Pasada 2: **~54.5% → ~65.7%** statements — extracción **licencias / eventos / asistencias admin** + tests de página y `lib`.
- Pasada 3: **~65.7% → ~71.1%** statements — RTL admin **eventos** (cancelar, eliminar, reactivar, editar, crear), **licencias** (rechazar, editar, eliminar), **asistencia** (Excel, marcar ausencias, eliminar + `fetch` mock).

Criterio: **líneas no cubiertas estimadas** × **complejidad de condiciones** vs **facilidad de test**. Orden: peor retorno actual → mejor candidato para atacar después.

| # | Archivo (aprox.) | Líneas @0% o bajo % | Por qué penaliza Sonar | Dificultad test |
|---|------------------|---------------------|-------------------------|-----------------|
| 1 | `app/register/page.tsx` | ~835 @ 0% | Registro crítico, muchas ramas | Alta (extraer helpers) |
| 2 | `app/admin/events/page.tsx` | **~64%** stmts (subió con modales) | Ramas repetitivas / filtros | Media |
| 3 | `app/admin/attendance/page.tsx` | sube (export PDF, edición filas) | `fetch` ya cubierto en parte | Media |
| 4 | `app/admin/licenses/page.tsx` | **~57%** stmts | Modal nueva licencia + filtros | Media |
| 5 | `app/onboarding/page.tsx` | ~460 @ 0% | Flujo post-login | Media-alta |
| 6 | `app/admin/users/page.tsx` | ~304 @ 0% | Gestión usuarios | Media |
| 7 | `app/admin/train-dni/page.tsx` | **~95%** tras tests + helpers | OCR admin | Cubierto en gran parte |
| 8 | `app/profile/page.tsx` | **~88% stmts** tras RTL | Perfil usuario | Cubierto en gran parte |
| 9 | `app/admin/test-preprocessing/page.tsx` | **~91%** tras tests + helpers | OCR prueba | Cubierto en gran parte |
| 10 | `app/forgot/page.tsx` | ~92% stmt | Recuperación | Baja (ramas sueltas) |
| 11 | `app/login/page.tsx` | 100% stmt, ramas sueltas | Auth | Baja |
| 12 | `components/MyAssignedEventsPage.tsx` | ~96% | Eventos | Baja |
| 13 | `components/MyAttendancePage.tsx` | ~94% | Asistencias | Baja |
| 14 | `components/UserNav.tsx` | ~100% stmt | Navegación | Baja |
| 15 | `lib/api.ts` | ~100% | Cliente HTTP | Cubierto |
| 16 | `lib/uruguay-forms.ts` | ~96% | Formularios | Baja |
| 17 | `lib/image-upload.ts` | ~100% | Canvas | Media (blob null) |
| 18 | `app/layout.tsx` | 100% | Shell | OK |
| 19 | `middleware.ts` | 100% | Edge | OK |
| 20 | Páginas teacher/staff/student wrapper | ~100% | Delegación | OK |

**Estrategia aplicada en esta iteración:** priorizar **helpers puros** (`dni-preprocessing-test`, `train-dni-helpers`) + **tests RTL de perfil** + **corrección RoleGuard** en páginas admin rotas.
