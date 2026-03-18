# Sistema de Reportes de Asistencias

## 📊 Funcionalidades Implementadas

### **Exportación de Reportes**
- **Formato Excel (.xlsx)**: Reporte completo con múltiples hojas
- **Formato PDF**: Reporte visual con tablas y estadísticas

### **Tipos de Reportes**

#### **1. Reporte por Usuario (con filtro de usuario)**
Cuando se filtra por un usuario específico, el reporte incluye:
- **Estadísticas detalladas del usuario**:
  - Total de asistencias
  - Cantidad de veces presente
  - Cantidad de veces llegó tarde
  - Cantidad de ausencias (justificadas y no justificadas)
  - Cantidad de salidas normales y anticipadas
  - Total de eventos asignados
  - Eventos a los que asistió
  - **Porcentaje de asistencia**

#### **2. Reporte General (sin filtros específicos)**
Cuando se exporta sin filtros o con filtros generales:
- **Datos clave de cada trabajador**:
  - Estadísticas individuales de todos los usuarios
  - Comparativa entre usuarios
  - Tasa promedio de asistencia general

#### **3. Reporte por Filtros Específicos**
- **Por estado**: Información sobre el estado filtrado
- **Por fecha**: Datos del período seleccionado
- **Por rol**: Estadísticas por tipo de usuario (ADMIN, TEACHER, STAFF)
- **Por tipo**: Datos de entrada o salida específicamente

## 🔧 Cómo Usar

### **Paso 1: Aplicar Filtros**
1. Ir a la página de "Gestión de Asistencias"
2. Usar los filtros disponibles:
   - **Fecha inicio/fin**: Para períodos específicos
   - **Usuario**: Para un trabajador específico
   - **Tipo**: Entrada o Salida
   - **Estado**: Presente, Tarde, Ausente, etc.
   - **Rol**: ADMIN, TEACHER, STAFF

### **Paso 2: Exportar Reporte**
1. Hacer clic en **"Exportar Excel"** o **"Exportar PDF"**
2. El archivo se descargará automáticamente
3. El nombre del archivo será: `reporte_asistencias.xlsx` o `reporte_asistencias.pdf`

## 📋 Contenido de los Reportes

### **Reporte Excel (.xlsx)**
**Hoja 1: Resumen**
- Filtros aplicados
- Estadísticas generales
- Total de registros
- Total de usuarios
- Total de eventos
- Tasa promedio de asistencia

**Hoja 2: Usuarios**
- Tabla detallada con estadísticas por usuario
- Columnas: Usuario, Email, Rol, Total Asistencias, Presente, Tarde, Ausente (No Justificada), Ausente (Justificada), Salida, Salida Anticipada, Total Eventos, Eventos Asistidos, Tasa de Asistencia (%)

**Hoja 3: Eventos**
- Estadísticas por evento
- Columnas: Evento, Tipo, Total Asignados, Asistieron, Tasa de Asistencia (%)

### **Reporte PDF**
- Resumen ejecutivo con filtros aplicados
- Estadísticas generales
- Tabla de usuarios con estadísticas clave
- Formato visual optimizado para impresión

## 📈 Ejemplos de Uso

### **Ejemplo 1: Reporte de un Usuario Específico**
1. Filtrar por usuario "Carlos Ruiz"
2. Exportar Excel
3. **Resultado**: Reporte detallado de Carlos Ruiz mostrando:
   - 15 asistencias totales
   - 10 veces presente
   - 2 veces llegó tarde
   - 2 ausencias no justificadas
   - 1 ausencia justificada
   - 85% de tasa de asistencia

### **Ejemplo 2: Reporte por Período**
1. Filtrar por fecha: 01/01/2024 - 31/01/2024
2. Exportar PDF
3. **Resultado**: Reporte del mes de enero con estadísticas de todos los usuarios

### **Ejemplo 3: Reporte por Estado**
1. Filtrar por estado "Ausente (No Justificada)"
2. Exportar Excel
3. **Resultado**: Lista de todas las ausencias no justificadas con detalles

## 🎯 Beneficios

- **Análisis detallado**: Estadísticas completas por usuario y evento
- **Flexibilidad**: Múltiples formatos de exportación
- **Filtrado inteligente**: Reportes específicos según necesidades
- **Visualización clara**: Datos organizados y fáciles de interpretar
- **Trazabilidad**: Información completa sobre asistencias y ausencias

## 🔒 Permisos

- Solo usuarios con rol **ADMIN** pueden generar reportes
- Los reportes incluyen todos los datos de asistencias del sistema
- Se respetan los filtros aplicados para mantener la privacidad






