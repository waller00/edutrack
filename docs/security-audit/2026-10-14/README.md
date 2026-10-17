# Evidencia de auditoría

Ver el [informe](../../AUDITORIA_SEGURIDAD_2026-10-14.md).

- `manifest.json`: commit, entorno y hashes de archivos revisados.
- `test-results.json`: 109 pruebas existentes y 9 pruebas de auditoría, todas aprobadas.
- `reproductions/*.test.ts`: casos locales con mocks. Sus expectativas describen problemas actuales; no son pruebas de que la aplicación sea segura.
- `backend-npm-audit.json`, `frontend-npm-audit.json`: resultados de dependencias de producción consultados el 14/10/2026. El código de salida 1 de npm audit indica avisos encontrados.
- `public-http.json`: estado y cabeceras de seis consultas GET anónimas. Sin cuerpos de respuestas ni cookies.

## Repetir las reproducciones

Requiere Node 22 y npm. Desde la raíz del proyecto:

```bash
bash docs/security-audit/2026-10-14/run-reproductions.sh
```

El script crea una copia temporal de los archivos versionados del backend, excluye archivos `.env`, instala dependencias sin scripts de instalación y genera Prisma sin conectarse a una base. Luego ejecuta las cuatro reproducciones, que simulan servicios externos. Necesita acceso al registro npm y sockets HTTP locales para Supertest. La copia se conserva en la ruta temporal que imprime para permitir su inspección. No realiza peticiones a producción.

Las pruebas existentes se ejecutaron por separado seleccionando: `auth-session`, `auth-permissions`, `keycloak-provisioning`, `auth-keycloak.routes`, `medical-leaves.routes`, `gradebook/access`, `gradebook/edit-window`, `zkteco-iclock.routes`, `student-photo` y `moodle/client`.
