import { describe, expect, it } from 'vitest'
import type { PlannedInstance, ResolvedAttendanceByInstance } from '../models.js'
import { generateDimensionReportPdf, generateDimensionReportXlsx } from './dimensionReportExport.js'

function planned(p: Partial<PlannedInstance> & Pick<PlannedInstance, 'plannedInstanceId' | 'eventId' | 'plannedDate'>): PlannedInstance {
  return {
    eventTitle: 'Clase Matemática',
    eventType: 'CLASE',
    eventStatus: 'ACTIVE',
    isRecurringInstance: false,
    plannedStartTime: null,
    plannedEndTime: null,
    userIdRequired: 'u1',
    courseOfferingId: 'off-1',
    courseLabel: '1ºA',
    subjectLabel: 'Matemática',
    ...p,
  }
}

const instances: ResolvedAttendanceByInstance[] = [
  {
    planned: planned({ plannedInstanceId: 'a', eventId: 'e1', plannedDate: '2026-05-01' }),
    checkInStatusResolved: 'PRESENT',
    checkOutStatusResolved: 'EXIT',
    hasCheckIn: true,
    hasCheckOut: true,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 45,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Ada Lovelace',
    userRole: 'TEACHER',
    userEmail: 'ada@edu.test',
  },
  {
    planned: planned({ plannedInstanceId: 'b', eventId: 'e1', plannedDate: '2026-05-02', userIdRequired: 'u2' }),
    checkInStatusResolved: 'LATE',
    checkOutStatusResolved: 'EXIT',
    hasCheckIn: true,
    hasCheckOut: false,
    actualInTime: null,
    actualOutTime: null,
    durationMinutes: 30,
    isJustifiedAbsence: false,
    licenseIdJustifying: null,
    checkInNotes: null,
    checkOutNotes: null,
    userDisplayName: 'Alan Turing',
    userRole: 'TEACHER',
    userEmail: 'alan@edu.test',
  },
]

describe('dimensionReportExport', () => {
  it('genera XLSX por persona con contenido', async () => {
    const buf = await generateDimensionReportXlsx({ resolvedInstances: instances, from: '2026-05-01', to: '2026-05-31', dimension: 'person' })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('genera XLSX por curso con contenido', async () => {
    const buf = await generateDimensionReportXlsx({ resolvedInstances: instances, from: '2026-05-01', to: '2026-05-31', dimension: 'course' })
    expect(buf.length).toBeGreaterThan(0)
  })

  it('genera PDF por persona con contenido', async () => {
    const buf = await generateDimensionReportPdf({ resolvedInstances: instances, from: '2026-05-01', to: '2026-05-31', dimension: 'person' })
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)
  })

  it('genera PDF por curso aún sin instancias', async () => {
    const buf = await generateDimensionReportPdf({ resolvedInstances: [], from: '2026-05-01', to: '2026-05-31', dimension: 'course' })
    expect(buf.length).toBeGreaterThan(0)
  })
})
