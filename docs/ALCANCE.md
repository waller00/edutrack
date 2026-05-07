## Alcance funcional y roles

### Diagrama de flujo (alto nivel)

```mermaid
flowchart TD
  A[Usuario abre app] --> B{Autenticado?}
  B -->|No| C[Login: usuario/email+pass o Google]
  C --> D[Backend emite cookies httpOnly con AT/RT]
  B -->|Si| E[Redireccion por rol]

  E -->|ADMIN| A1[Panel ADMIN]
  E -->|DOCENTE| T1[Panel Docente]

  %% Docente
  T1 --> T2[Seleccionar curso/clase del dia]
  T2 --> T3[Marcar asistencia: P, A, T, Just.]
  T3 --> T4[Guardar en base de datos]
  T4 --> ML1[Llamar ML /predict alumno]
  ML1 --> D1{Score > umbral?}
  D1 -->|Si| N1[Crear alerta + notificar]
  D1 -->|No| T5[Actualizar panel sin alerta]
  T1 --> T6[Revisar justificativos]
  T6 --> T7{Aprobar?}
  T7 -->|Si| T8[Marcar Justificado]
  T7 -->|No| T9[Rechazar con motivo]
  T1 --> T10[Crear anotaciones]

  %% Admin
  A1 --> A2[Gestionar estructura: cursos, materias, vinculos]
  A1 --> A3[Configurar politicas y umbrales ML]
  A1 --> A4[Ver KPIs/Reportes y exportar]
  A1 --> A5[Auditoria y seguridad]
  A1 --> A6[Entrenamiento ML programado y entrenar]
```

### Funcionalidades por rol

#### ADMIN
- Gestión institucional: cursos, materias, turnos, vínculos docentes-estudiantes-padres, importación CSV.
- Usuarios y roles: altas/bajas/modificaciones, reseteo de contraseña, bloqueo/desbloqueo, verificación de email.
- Configuración: políticas de asistencia (tolerancias/estados/reglas), plantillas de correo, calendario (feriados, exámenes), dominios de email.
- KPIs y reportes: asistencia promedio, puntualidad, evolución; filtros y exportación CSV.
- ML: panel global de riesgo, umbrales, disparar reentrenamiento, explicaciones y métricas del modelo, monitoreo de drift.
- Auditoría/seguridad: logs de acciones críticas, políticas de retención, backups/restauración.
- Notificaciones: activar/desactivar canales (email, opcional WhatsApp), listar alertas.

#### DOCENTE
- Agenda/Clases: ver clases del día; abrir toma de asistencia.
- Asistencia: marcar P/A/T/Justificado; edición del día; comentarios; carga rápida.
- Justificativos: revisar, aprobar/rechazar con motivo; historial por estudiante.
- Anotaciones: registrar observaciones con severidad y visibilidad; historial.
- Riesgo (ML): ver score 0–100 por alumno, explicaciones, recomendaciones; alertas al cruzar umbral.
- Comunicación: notificaciones en app/email; atajos de contacto a padres.
- Reportes del curso: asistencia por rango, puntualidad, exportación.



