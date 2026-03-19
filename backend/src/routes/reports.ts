import { Router } from 'express'
import { authGuard, requireRole } from '../middlewares/auth.js'
import { prisma } from '../prisma.js'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'

const r = Router()

export function applyReportFilters(where: any, query: any) {
  const { startDate, endDate, userId, eventId, eventType, type, status, role } = query
  if (startDate || endDate) {
    where.date = {}
    if (startDate) where.date.gte = new Date(startDate as string)
    if (endDate) where.date.lte = new Date(endDate as string)
  }
  if (userId) where.userId = userId
  if (eventId) where.eventId = eventId
  if (eventType) {
    where.event = { type: eventType }
    where.eventId = { not: null }
  }
  if (type) where.type = type
  if (status) where.status = status
  if (role) where.user = { role }
}

export function buildDetailedRecord(att: any) {
  return {
    id: att.id,
    userId: att.user.id,
    userName: att.user.name || att.user.username || 'Sin nombre',
    userEmail: att.user.email,
    userRole: att.user.role,
    eventId: att.event?.id || null,
    eventTitle: att.event?.title || 'Sin evento',
    eventType: att.event?.type || 'N/A',
    date: att.date,
    time: att.time,
    type: att.type,
    status: att.status,
    notes: att.notes || ''
  }
}

export function createUserStat(att: any, userName: string) {
  return {
    id: att.user.id,
    name: userName,
    email: att.user.email,
    role: att.user.role,
    totalAttendances: 0,
    presentCount: 0,
    lateCount: 0,
    absentNotJustifiedCount: 0,
    absentJustifiedCount: 0,
    exitCount: 0,
    earlyExitCount: 0,
    totalEvents: 0,
    attendedEvents: 0,
    attendanceRate: 0,
    firstAttendance: null,
    lastAttendance: null
  }
}

export function updateUserAttendanceRange(stats: any, date: string | Date) {
  if (!stats.firstAttendance || new Date(date) < new Date(stats.firstAttendance)) {
    stats.firstAttendance = date
  }
  if (!stats.lastAttendance || new Date(date) > new Date(stats.lastAttendance)) {
    stats.lastAttendance = date
  }
}

export function updateUserCounters(stats: any, att: any) {
  stats.totalAttendances++
  updateUserAttendanceRange(stats, att.date)
  if (att.type === 'CHECK_IN') {
    stats.totalEvents++
    if (att.status === 'PRESENT' || att.status === 'LATE') {
      stats.attendedEvents++
    }
    if (att.status === 'PRESENT') stats.presentCount++
    else if (att.status === 'LATE') stats.lateCount++
    else if (att.status === 'ABSENT_NOT_JUSTIFIED') stats.absentNotJustifiedCount++
    else if (att.status === 'ABSENT_JUSTIFIED') stats.absentJustifiedCount++
    return
  }
  if (att.status === 'EXIT') stats.exitCount++
  else if (att.status === 'EARLY_EXIT') stats.earlyExitCount++
}

export function createEventStat(att: any) {
  return {
    id: att.event.id,
    title: att.event.title,
    type: att.event.type,
    startTime: att.event.startTime,
    endTime: att.event.endTime,
    totalAssigned: 0,
    attended: 0,
    attendanceRate: 0
  }
}

export function updateEventCounters(stats: any, att: any) {
  stats.totalAssigned++
  if (att.type === 'CHECK_IN' && (att.status === 'PRESENT' || att.status === 'LATE')) {
    stats.attended++
  }
}

export function getTruncatedText(value: string | undefined, maxLength: number, fallback: string) {
  if (!value) return fallback
  if (value.length <= maxLength) return value
  return `${value.substring(0, maxLength)}...`
}

// Generar reporte de asistencias
r.get('/report', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { format = 'excel' } = req.query

    const where: any = {}
    applyReportFilters(where, req.query)

    // Obtener datos de asistencias
    const attendances = await prisma.attendance.findMany({
      where,
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true, username: true }
        },
        event: {
          select: { id: true, title: true, type: true, startTime: true, endTime: true }
        }
      },
      orderBy: [
        { user: { name: 'asc' } },
        { date: 'desc' }
      ]
    })

    // Procesar datos para el reporte
    const reportData = processAttendanceData(attendances, req.query)

    if (format === 'pdf') {
      await generatePDFReport(reportData, res, req.query)
    } else {
      await generateExcelReport(reportData, res, req.query)
    }

  } catch (error) {
    console.error('Error generando reporte:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export function processAttendanceData(attendances: any[], filters: any) {
  const userStats = new Map()
  const eventStats = new Map()
  const detailedRecords = []
  
  attendances.forEach(att => {
    const userId = att.user.id
    const userName = att.user.name || att.user.username || 'Sin nombre'
    detailedRecords.push(buildDetailedRecord(att))
    
    if (!userStats.has(userId)) {
      userStats.set(userId, createUserStat(att, userName))
    }
    
    const stats = userStats.get(userId)
    updateUserCounters(stats, att)
  })
  
  // Calcular porcentajes
  userStats.forEach(stats => {
    if (stats.totalEvents > 0) {
      stats.attendanceRate = Math.round((stats.attendedEvents / stats.totalEvents) * 100)
    }
  })
  
  attendances.forEach(att => {
    if (att.event) {
      const eventId = att.event.id
      if (!eventStats.has(eventId)) {
        eventStats.set(eventId, createEventStat(att))
      }
      
      const eventStat = eventStats.get(eventId)
      updateEventCounters(eventStat, att)
    }
  })
  
  // Calcular porcentajes de eventos
  eventStats.forEach(stats => {
    if (stats.totalAssigned > 0) {
      stats.attendanceRate = Math.round((stats.attended / stats.totalAssigned) * 100)
    }
  })
  
  const sortedDetailedRecords = [...detailedRecords].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return {
    filters,
    userStats: Array.from(userStats.values()),
    eventStats: Array.from(eventStats.values()),
    detailedRecords: sortedDetailedRecords,
    totalRecords: attendances.length,
    summary: {
      totalUsers: userStats.size,
      totalEvents: eventStats.size,
      averageAttendanceRate: userStats.size > 0 
        ? Math.round(Array.from(userStats.values()).reduce((sum, user) => sum + user.attendanceRate, 0) / userStats.size)
        : 0
    }
  }
}

export async function generateExcelReport(data: any, res: any, filters: any) { // NOSONAR legacy report builder
  const workbook = new ExcelJS.Workbook()
  
  // Hoja principal con la tabla filtrada
  const mainSheet = workbook.addWorksheet('Reporte de Asistencias')
  
  // Título principal
  const titleRow = mainSheet.addRow(['REPORTE DE ASISTENCIAS'])
  titleRow.getCell(1).font = { size: 18, bold: true, color: { argb: '1F4E79' } }
  titleRow.getCell(1).alignment = { horizontal: 'center' }
  mainSheet.mergeCells('A1:K1')
  mainSheet.addRow([''])
  
  // Información del reporte
  const reportDate = new Date().toLocaleDateString('es-ES', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
  
  mainSheet.addRow(['Fecha de generacion:', reportDate])
  mainSheet.addRow([''])
  
  // Filtros aplicados
  mainSheet.addRow(['FILTROS APLICADOS'])
  mainSheet.getRow(mainSheet.lastRow.number).font = { bold: true, color: { argb: '2F5597' } }
  mainSheet.addRow([''])
  
  if (filters.startDate) mainSheet.addRow(['Fecha inicio:', filters.startDate])
  if (filters.endDate) mainSheet.addRow(['Fecha fin:', filters.endDate])
  if (filters.userId) mainSheet.addRow(['Usuario:', data.userStats.find(u => u.id === filters.userId)?.name || 'Especifico'])
  if (filters.eventId) mainSheet.addRow(['Evento:', data.eventStats.find(e => e.id === filters.eventId)?.title || 'Especifico'])
  if (filters.type) mainSheet.addRow(['Tipo:', filters.type === 'CHECK_IN' ? 'Entrada' : 'Salida'])
  if (filters.status) mainSheet.addRow(['Estado:', filters.status])
  if (filters.role) mainSheet.addRow(['Rol:', filters.role])
  
  mainSheet.addRow([''])
  
  // Estadísticas generales
  mainSheet.addRow(['ESTADISTICAS GENERALES'])
  mainSheet.getRow(mainSheet.lastRow.number).font = { bold: true, color: { argb: '2F5597' } }
  mainSheet.addRow([''])
  
  mainSheet.addRow(['Total de registros:', data.totalRecords])
  mainSheet.addRow(['Total de usuarios:', data.summary.totalUsers])
  mainSheet.addRow(['Total de eventos:', data.summary.totalEvents])
  mainSheet.addRow(['Tasa promedio de asistencia:', `${data.summary.averageAttendanceRate}%`])
  
  // Aplicar estilos a las estadísticas
  for (let i = mainSheet.lastRow.number - 4; i <= mainSheet.lastRow.number; i++) {
    const row = mainSheet.getRow(i)
    row.getCell(1).font = { bold: true }
    row.getCell(2).font = { color: { argb: '1F4E79' } }
  }
  
  mainSheet.addRow([''])
  mainSheet.addRow([''])
  
  // Tabla principal con los registros filtrados (igual que se ve en pantalla)
  const tableHeaders = [
    'Fecha', 'Hora', 'Usuario', 'Email', 'Rol', 
    'Evento', 'Tipo Evento', 'Tipo', 'Estado', 'Notas'
  ]
  
  const headerRow = mainSheet.addRow(tableHeaders)
  
  // Estilos para encabezados de la tabla principal
  headerRow.eachCell((cell, colNumber) => {
    cell.style = {
      font: { bold: true, color: { argb: 'FFFFFF' }, size: 11 },
      fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: '2F5597' } },
      alignment: { horizontal: 'center', vertical: 'middle' },
      border: {
        top: { style: 'thin', color: { argb: 'FFFFFF' } },
        left: { style: 'thin', color: { argb: 'FFFFFF' } },
        bottom: { style: 'thin', color: { argb: 'FFFFFF' } },
        right: { style: 'thin', color: { argb: 'FFFFFF' } }
      }
    }
  })
  
  // Datos de la tabla principal (registros filtrados)
  data.detailedRecords.forEach((record: any, index: number) => {
    const row = mainSheet.addRow([
      new Date(record.date).toLocaleDateString('es-ES'),
      record.time || 'N/A',
      record.userName,
      record.userEmail,
      record.userRole,
      record.eventTitle,
      record.eventType,
      record.type === 'CHECK_IN' ? 'Entrada' : 'Salida',
      record.status,
      record.notes || ''
    ])
    
    // Alternar colores de filas
    const isEven = index % 2 === 0
    row.eachCell((cell, colNumber) => {
      cell.style = {
        fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: isEven ? 'F8F9FA' : 'FFFFFF' } },
        border: {
          top: { style: 'thin', color: { argb: 'E0E0E0' } },
          left: { style: 'thin', color: { argb: 'E0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'E0E0E0' } },
          right: { style: 'thin', color: { argb: 'E0E0E0' } }
        },
        alignment: { vertical: 'middle', wrapText: true }
      }
      
      // Resaltar estados importantes
      if (colNumber === 9) { // Estado
        const status = record.status
        if (status === 'PRESENT') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D4EDDA' } }
          cell.font = { color: { argb: '155724' }, bold: true }
        } else if (status === 'LATE') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3CD' } }
          cell.font = { color: { argb: '856404' }, bold: true }
        } else if (status === 'ABSENT_NOT_JUSTIFIED') {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8D7DA' } }
          cell.font = { color: { argb: '721C24' }, bold: true }
        }
      }
    })
  })
  
  // Ajustar ancho de columnas automáticamente para mejor visualización
  mainSheet.columns.forEach((column, index) => {
    if (index === 0) column.width = 15 // Fecha (agrandada)
    else if (index === 1) column.width = 12 // Hora (un poco más grande)
    else if (index === 2) column.width = 25 // Usuario
    else if (index === 3) column.width = 35 // Email
    else if (index === 4) column.width = 12 // Rol
    else if (index === 5) column.width = 30 // Evento
    else if (index === 6) column.width = 15 // Tipo Evento
    else if (index === 7) column.width = 10 // Tipo
    else if (index === 8) column.width = 18 // Estado
    else if (index === 9) column.width = 40 // Notas
  })
  
  // Configurar altura de filas para mejor visualización
  mainSheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) { // No aplicar a la fila de encabezados
      row.height = 25
    }
  })
  
  // Configurar respuesta
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename=reporte_asistencias_mejorado.xlsx')
  
  await workbook.xlsx.write(res)
  res.end()
}

export async function generatePDFReport(data: any, res: any, filters: any) { // NOSONAR legacy PDF builder
  const doc = new PDFDocument({ 
    margin: 40,
    size: 'A4',
    info: {
      Title: 'Reporte de Asistencias',
      Author: 'Sistema de Gestion de Asistencias',
      Subject: 'Reporte detallado de asistencias',
      Creator: 'Sistema de Gestion'
    }
  })
  
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', 'attachment; filename=reporte_asistencias_mejorado.pdf')
  
  doc.pipe(res)
  
  // Función para agregar encabezado de página
  function addPageHeader() {
    doc.fontSize(16).fillColor('#1F4E79').text('REPORTE DE ASISTENCIAS', { align: 'center' })
    doc.moveDown(0.5)
    
    const reportDate = new Date().toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
    
    doc.fontSize(10).fillColor('#666666').text(`Generado el: ${reportDate}`, { align: 'center' })
    doc.moveDown(1)
  }
  
  // Función para agregar línea separadora
  function addSeparator() {
    doc.moveDown(0.5)
    doc.strokeColor('#E0E0E0').lineWidth(1)
    doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke()
    doc.moveDown(0.5)
  }
  
  // Página 1: Resumen Ejecutivo
  addPageHeader()
  
  doc.fontSize(14).fillColor('#2F5597').text('RESUMEN EJECUTIVO', { underline: true })
  doc.moveDown(1)
  
  // Filtros aplicados
  doc.fontSize(12).fillColor('#333333').text('Filtros aplicados:', { underline: true })
  doc.moveDown(0.5)
  
  if (filters.startDate) doc.text(`Fecha inicio: ${filters.startDate}`)
  if (filters.endDate) doc.text(`Fecha fin: ${filters.endDate}`)
  if (filters.userId) doc.text(`Usuario: ${data.userStats.find((u: any) => u.id === filters.userId)?.name || 'Especifico'}`)
  if (filters.eventId) doc.text(`Evento: ${data.eventStats.find((e: any) => e.id === filters.eventId)?.title || 'Especifico'}`)
  if (filters.type) doc.text(`Tipo: ${filters.type === 'CHECK_IN' ? 'Entrada' : 'Salida'}`)
  if (filters.status) doc.text(`Estado: ${filters.status}`)
  if (filters.role) doc.text(`Rol: ${filters.role}`)
  
  addSeparator()
  
  // Estadísticas generales
  doc.fontSize(12).fillColor('#333333').text('Estadisticas generales:', { underline: true })
  doc.moveDown(0.5)
  
  doc.text(`Total de registros: ${data.totalRecords}`)
  doc.text(`Total de usuarios: ${data.summary.totalUsers}`)
  doc.text(`Total de eventos: ${data.summary.totalEvents}`)
  doc.text(`Tasa promedio de asistencia: ${data.summary.averageAttendanceRate}%`)
  
  addSeparator()
  
  // Resumen por roles
  doc.fontSize(12).fillColor('#333333').text('Resumen por roles:', { underline: true })
  doc.moveDown(0.5)
  
  const roleStats = new Map()
  data.userStats.forEach((user: any) => {
    if (!roleStats.has(user.role)) {
      roleStats.set(user.role, { count: 0, totalRate: 0 })
    }
    const stats = roleStats.get(user.role)
    stats.count++
    stats.totalRate += user.attendanceRate
  })
  
  roleStats.forEach((stats, role) => {
    const avgRate = Math.round(stats.totalRate / stats.count)
    doc.text(`${role}: ${stats.count} usuarios, promedio ${avgRate}% asistencia`)
  })
  
  // Nueva página para estadísticas detalladas
  doc.addPage()
  addPageHeader()
  
  doc.fontSize(14).fillColor('#2F5597').text('ESTADISTICAS DETALLADAS POR USUARIO', { underline: true })
  doc.moveDown(1)
  
  // Tabla de usuarios mejorada
  const tableTop = doc.y
  const itemHeight = 25
  const colWidths = [140, 120, 60, 50, 45, 45, 60, 60, 45, 50, 50, 50, 60]
  
  // Encabezados de tabla mejorados
  const headers = [
    'Usuario', 'Email', 'Rol', 'Total', 'Pres', 'Tarde', 
    'Aus NJ', 'Aus J', 'Sal', 'SA', 'Ev', 'As', '%'
  ]
  
  let x = 40
  let headerY = tableTop
  
  // Dibujar encabezados con fondo
  headers.forEach((header, i) => {
    doc.rect(x, headerY, colWidths[i], itemHeight).fillAndStroke('#2F5597', '#FFFFFF')
    doc.fontSize(9).fillColor('#FFFFFF').text(header, x + 3, headerY + 8)
    x += colWidths[i]
  })
  
  // Datos de usuarios
  let y = tableTop + itemHeight
  let pageCount = 0
  
  data.userStats.forEach((user: any, index: number) => {
    // Verificar si necesitamos nueva página
    if (y > 700) {
      doc.addPage()
      addPageHeader()
      doc.fontSize(14).fillColor('#2F5597').text('ESTADISTICAS DETALLADAS POR USUARIO (continuacion)', { underline: true })
      doc.moveDown(1)
      
      // Redibujar encabezados
      x = 40
      headerY = doc.y
      headers.forEach((header, i) => {
        doc.rect(x, headerY, colWidths[i], itemHeight).fillAndStroke('#2F5597', '#FFFFFF')
        doc.fontSize(9).fillColor('#FFFFFF').text(header, x + 3, headerY + 8)
        x += colWidths[i]
      })
      y = headerY + itemHeight
    }
    
      const rowData = [
        getTruncatedText(user.name, 18, 'Sin nombre'),
        getTruncatedText(user.email, 18, 'N/A'),
      user.role,
      user.totalAttendances,
      user.presentCount,
      user.lateCount,
      user.absentNotJustifiedCount,
      user.absentJustifiedCount,
      user.exitCount,
      user.earlyExitCount,
      user.totalEvents,
      user.attendedEvents,
      `${user.attendanceRate}%`
    ]
    
    // Alternar colores de filas
    const isEven = index % 2 === 0
    const fillColor = isEven ? '#F8F9FA' : '#FFFFFF'
    
    x = 40
    rowData.forEach((cell, i) => {
      doc.rect(x, y, colWidths[i], itemHeight).fillAndStroke(fillColor, '#E0E0E0')
      
      // Resaltar porcentaje de asistencia
      if (i === 12) {
        const rate = user.attendanceRate
        if (rate >= 90) {
          doc.fillColor('#155724')
        } else if (rate >= 70) {
          doc.fillColor('#856404')
        } else {
          doc.fillColor('#721C24')
        }
      } else {
        doc.fillColor('#333333')
      }
      
      doc.fontSize(8).text(cell.toString(), x + 3, y + 8)
      x += colWidths[i]
    })
    y += itemHeight
  })
  
  // Nueva página para eventos solo si hay eventos
  if (data.eventStats && data.eventStats.length > 0) {
    doc.addPage()
    addPageHeader()
    
    doc.fontSize(14).fillColor('#28A745').text('ESTADISTICAS POR EVENTO', { underline: true })
    doc.moveDown(1)
    
    // Tabla de eventos
    const eventTableTop = doc.y
    const eventColWidths = [200, 80, 80, 80, 80]
    const eventHeaders = ['Evento', 'Tipo', 'Asignados', 'Asistieron', 'Tasa (%)']
    
    x = 40
    headerY = eventTableTop
    
    // Encabezados de eventos
    eventHeaders.forEach((header, i) => {
      doc.rect(x, headerY, eventColWidths[i], itemHeight).fillAndStroke('#28A745', '#FFFFFF')
      doc.fontSize(9).fillColor('#FFFFFF').text(header, x + 3, headerY + 8)
      x += eventColWidths[i]
    })
    
    // Datos de eventos
    y = eventTableTop + itemHeight
    data.eventStats.forEach((event: any, index: number) => {
      if (y > 700) {
        doc.addPage()
        addPageHeader()
        doc.fontSize(14).fillColor('#28A745').text('ESTADISTICAS POR EVENTO (continuacion)', { underline: true })
        doc.moveDown(1)
        
        x = 40
        headerY = doc.y
        eventHeaders.forEach((header, i) => {
          doc.rect(x, headerY, eventColWidths[i], itemHeight).fillAndStroke('#28A745', '#FFFFFF')
          doc.fontSize(9).fillColor('#FFFFFF').text(header, x + 3, headerY + 8)
          x += eventColWidths[i]
        })
        y = headerY + itemHeight
      }
      
      const truncatedTitle = getTruncatedText(event.title, 25, 'Sin titulo')
      const eventRowData = [
        truncatedTitle,
        event.type || 'N/A',
        event.totalAssigned || 0,
        event.attended || 0,
        `${event.attendanceRate || 0}%`
      ]
      
      const isEven = index % 2 === 0
      const fillColor = isEven ? '#F8F9FA' : '#FFFFFF'
      
      x = 40
      eventRowData.forEach((cell, i) => {
        doc.rect(x, y, eventColWidths[i], itemHeight).fillAndStroke(fillColor, '#E0E0E0')
        
        // Resaltar porcentaje de asistencia
        if (i === 4) {
          const rate = event.attendanceRate || 0
          if (rate >= 90) {
            doc.fillColor('#155724')
          } else if (rate >= 70) {
            doc.fillColor('#856404')
          } else {
            doc.fillColor('#721C24')
          }
        } else {
          doc.fillColor('#333333')
        }
        
        doc.fontSize(8).text(cell.toString(), x + 3, y + 8)
        x += eventColWidths[i]
      })
      y += itemHeight
    })
  }
  
  doc.end()
}

// Obtener eventos asignados a un usuario específico
r.get('/user-events/:userId', authGuard, requireRole('ADMIN'), async (req, res) => {
  try {
    const { userId } = req.params
    const { startDate, endDate } = req.query

    const where: any = {
      OR: [
        { userId: userId },
        { assignedUserId: userId }
      ]
    }

    if (startDate || endDate) {
      where.startDate = {}
      if (startDate) where.startDate.gte = new Date(startDate as string)
      if (endDate) where.startDate.lte = new Date(endDate as string)
    }

    const events = await prisma.event.findMany({
      where,
      select: {
        id: true,
        title: true,
        type: true,
        startDate: true,
        endDate: true,
        startTime: true,
        endTime: true
      },
      orderBy: { startDate: 'desc' }
    })

    res.json(events)
  } catch (error) {
    console.error('Error obteniendo eventos del usuario:', error)
    res.status(500).json({ message: 'Error interno del servidor' })
  }
})

export default r
