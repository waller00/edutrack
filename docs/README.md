# Documentación EduTrack

Índice de la documentación del proyecto. Si algo no coincide con el código, el código manda.

## Empezar

| Documento | Para qué |
|-----------|----------|
| [README.md](../README.md) | Arranque local, variables, servicios Docker |
| [ESTRUCTURA_PROYECTO.md](ESTRUCTURA_PROYECTO.md) | Dónde está cada módulo en backend y frontend |
| [FUNCIONALIDADES.md](FUNCIONALIDADES.md) | Catálogo completo de lo implementado |

## Arquitectura clave

```
[Navegador] ──cookie sid──► [Backend BFF :4000] ──OIDC──► [Keycloak :8089]
                                    │                         │
                                    ├── Redis (sesiones)      └── Google IdP, TOTP
                                    └── PostgreSQL (perfil, permisos, negocio)
```

- **Login:** Keycloak (tema `edutrack`) vía `/auth/login` → callback → cookie `sid`.
- **Autorización:** permisos por `orgRole` en Postgres (`ADMIN`, `TEACHER`, `STAFF`, …).
- **Registro:** sigue en la app (`/auth/register`) + usuario en Keycloak + aprobación admin.

## Operación y despliegue

| Documento | Para qué |
|-----------|----------|
| [MANUAL_DESPLIEGUE_CONTINUO.md](MANUAL_DESPLIEGUE_CONTINUO.md) | CI/CD, testing/producción, smoke tests |
| [REVERSE_PROXY_CLOUDFLARE.md](REVERSE_PROXY_CLOUDFLARE.md) | Reverse proxy Nginx para Cloudflare antes de activar WAF |
| [TESTING_DB_RESTORE.md](TESTING_DB_RESTORE.md) | Restaurar dumps en el Droplet |
| [CIBERSEGURIDAD_CONTINUIDAD.md](CIBERSEGURIDAD_CONTINUIDAD.md) | Seguridad, backups, RTO/RPO, incidentes |
| [BIOMETRICO_F22.md](BIOMETRICO_F22.md) | Reloj ZKTeco F22 (ADMS) |

## Calidad y datos

| Documento | Para qué |
|-----------|----------|
| [BACKEND_TESTING.md](BACKEND_TESTING.md) | Tests Vitest del backend + Sonar |
| [REPORTES.md](REPORTES.md) | Exportación Excel/PDF de asistencias |
| [CATALOGO_ACADEMICO_DGES.md](CATALOGO_ACADEMICO_DGES.md) | Seeds del catálogo académico DGES |

## Fuera de alcance actual

No están implementados (no buscar en docs viejos):

- Predicción ML de inasistencias
- Portal padres/tutores (rol `PADRE`)
- App móvil nativa
- Sincronización Moodle más allá de alta de usuarios
- Pagos en línea de cuotas

Ver sección 22 de [FUNCIONALIDADES.md](FUNCIONALIDADES.md) para el detalle.
