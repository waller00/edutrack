# Estructura del proyecto

Este mapa resume dónde buscar cada tipo de código.

## Backend

El backend vive en `backend/src`.

- `app.ts` y `server.ts`: únicos archivos de entrada en la raíz de `src`.
- `__tests__/`: tests de integración de la aplicación/servidor.
- `routes/`: endpoints HTTP agrupados por área funcional.
- `middlewares/`: middlewares compartidos de Express.
- `services/`: casos de uso e integraciones internas con más lógica.
- `config/`: configuración de negocio y helpers globales, como zona horaria y parámetros operativos.
- `db/`: cliente Prisma.
- `auth/`: JWT, Google OAuth, políticas de contraseña y validaciones puras de perfil.
- `identity/`: CI uruguaya, roles organizacionales, permisos de perfiles y helpers de usuario.
- `attendance/`: reglas puras de asistencia y resolución de año lectivo para asistencia.
- `events/`: helpers de consulta y expansión de eventos.
- `medical-leaves/`: validaciones y helpers de licencias médicas.
- `notifications/`: email y canales de notificación.
- `integrations/didit/`: firma, estados y sincronización con Didit.

Los tests unitarios viven junto al dominio que validan, por ejemplo `auth/jwt.test.ts` o `attendance/attendance-logic.test.ts`. En la raíz de `backend/src` sólo quedan entradas de aplicación y archivos globales de tipos.

## Frontend

El frontend vive en `frontend/web/src`.

- `app/`: rutas y páginas de Next.js.
- `components/admin/`: paneles y shell de administración.
- `components/auth/`: guardas y componentes ligados a permisos.
- `components/common/`: controles genéricos reutilizables.
- `components/forms/`: campos y controles de formularios.
- `components/home/`: paneles del dashboard inicial.
- `components/navigation/`: navegación global.
- `components/notifications/`: UI de notificaciones.
- `components/personal/`: pantallas reutilizadas por mis asistencias, eventos y licencias.
- `contexts/`: providers de React compartidos.
- `test/`: configuración de tests.
- `lib/api/`: cliente API y helpers de errores.
- `lib/admin/`: formateo y helpers de pantallas administrativas.
- `lib/attendance/`: helpers de visualización de asistencia propia.
- `lib/auth/`: validación de contraseña, registro, onboarding y borradores.
- `lib/events/`: helpers de eventos asignados.
- `lib/forms/`: formatos de Uruguay, fechas y teléfonos.
- `lib/home/`: helpers del dashboard inicial.
- `lib/media/`: carga y compresión de imágenes.
- `lib/medical-leaves/`: helpers de certificados de licencias médicas.
- `lib/notifications/`: helpers de web push.
- `lib/profile/`: validación y normalización de perfil.

Los imports apuntan directo a la carpeta final, por ejemplo `@/lib/api/client` o `@/components/auth/RoleGuard`.
