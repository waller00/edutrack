# Reportes de asistencias

Exportación desde **Gestión de Asistencias** (`/admin/attendance`). Permisos: `reports.read`, `exports.create`.

## Formatos

| Formato | Descripción |
|---------|-------------|
| Excel (.xlsx) | Resumen, hoja por usuarios, hoja por eventos |
| PDF | Resumen ejecutivo + tabla de usuarios |

## Tipos de reporte

**Por usuario** (filtro de usuario activo): total de asistencias, presente, tarde, ausencias (justificadas/no), salidas, eventos asignados/asistidos, porcentaje de asistencia.

**General** (sin usuario): estadísticas de todos los trabajadores filtrados.

**Por filtros**: fecha, estado, rol (`ADMIN`, `TEACHER`, `STAFF`), tipo entrada/salida.

## Uso

1. Ir a `/admin/attendance`.
2. Aplicar filtros (fechas, usuario, tipo, estado, rol).
3. Clic en **Exportar Excel** o **Exportar PDF**.
4. Archivo descargado: `reporte_asistencias.xlsx` o `reporte_asistencias.pdf`.

## Contenido Excel

| Hoja | Columnas principales |
|------|----------------------|
| Resumen | Filtros, totales, tasa promedio |
| Usuarios | Usuario, email, rol, presente, tarde, ausencias, eventos, % asistencia |
| Eventos | Evento, tipo, asignados, asistieron, % asistencia |

## Permisos

Solo usuarios con permiso de reportes/exportación. Los datos respetan los filtros aplicados en pantalla.
