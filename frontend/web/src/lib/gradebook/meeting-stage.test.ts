import { describe, expect, it } from 'vitest'
import { meetingStage, type MeetingStageInput } from './meeting-stage'

type Endorsement = NonNullable<MeetingStageInput['endorsement']>

function endorsement(over: Partial<Endorsement> = {}): Endorsement {
  return {
    overallStatus: 'PENDING',
    periodStatus: 'CLOSED',
    blockingSections: [],
    reclosedAfterObservation: false,
    sections: [],
    ...over,
  }
}

const both = (input: MeetingStageInput) => ({ teacher: meetingStage(input, 'teacher'), reviewer: meetingStage(input, 'reviewer') })

describe('etapas de una reunión', () => {
  it('abierta con faltantes: cargar', () => {
    const { teacher, reviewer } = both({ periodStatus: 'OPEN', missing: 3 })
    expect(teacher).toMatchObject({ stage: 'LOAD', label: 'Abierta', hint: 'Falta cargar lo de abajo para poder cerrarla.' })
    expect(reviewer.hint).toBe('Abierta: el docente está cargando')
  })

  it('abierta sin saber qué falta, también cargar', () => {
    expect(meetingStage({ periodStatus: 'OPEN', missing: null }, 'teacher')).toMatchObject({
      stage: 'LOAD',
      hint: 'Abierta: cargá la C, la R y los juicios, y después cerrala.',
    })
  })

  it('abierta y completa: cerrar', () => {
    const { teacher, reviewer } = both({ periodStatus: 'OPEN', missing: 0 })
    expect(teacher).toMatchObject({ stage: 'CLOSE', label: 'Lista para cerrar', hint: 'Todo cargado: falta cerrarla.' })
    expect(reviewer.hint).toBe('Abierta: el docente no la cerró')
  })

  it('cerrada: en revisión, y para quien revisa, "Para revisar" como en Control', () => {
    const { teacher, reviewer } = both({ periodStatus: 'CLOSED', missing: 0, closedAt: '2026-10-01T15:00:00Z', endorsement: endorsement() })
    expect(teacher).toMatchObject({ stage: 'REVIEW', label: 'En revisión', hint: 'Cerrada el 01/10/2026: la revisa Dirección.' })
    expect(reviewer).toMatchObject({ stage: 'REVIEW', hint: 'Para revisar' })
  })

  it('observada: el docente sabe qué sigue y quien revisa, que espera al docente', () => {
    const { teacher, reviewer } = both({
      periodStatus: 'CLOSED',
      missing: 0,
      endorsement: endorsement({ blockingSections: ['GRADES'] }),
    })
    expect(teacher).toMatchObject({
      stage: 'REVIEW',
      label: 'Observada',
      symbol: '▲',
      hint: 'Te hicieron observaciones. Si hay que corregir algo, administración te la reabre.',
    })
    expect(reviewer.hint).toBe('Observada: espera al docente')
  })

  it('observada y vuelta a cerrar: la revisan de nuevo', () => {
    const { teacher, reviewer } = both({
      periodStatus: 'CLOSED',
      missing: 0,
      endorsement: endorsement({ blockingSections: ['GRADES'], reclosedAfterObservation: true }),
    })
    expect(teacher.hint).toBe('La volviste a cerrar: la revisan de nuevo.')
    expect(reviewer.hint).toBe('Volvió a cerrarse: revisá la corrección')
  })

  it('reabierta: el docente lee el motivo, y la etapa depende de si falta algo', () => {
    const reopened = { periodStatus: 'REOPENED' as const, reopenReason: 'Corregir el juicio de Ana', endorsement: endorsement({ periodStatus: 'REOPENED' }) }
    expect(meetingStage({ ...reopened, missing: 2 }, 'teacher')).toMatchObject({
      stage: 'LOAD',
      label: 'Reabierta',
      hint: 'Reabierta para corregir: Corregir el juicio de Ana. Cuando termines, volvé a cerrarla.',
    })
    expect(meetingStage({ ...reopened, missing: 0 }, 'teacher').stage).toBe('CLOSE')
    expect(meetingStage({ ...reopened, missing: null }, 'reviewer').hint).toBe('Reabierta: el docente está corrigiendo')
  })

  it('visada, con la fecha del visado, igual para los dos', () => {
    const visada = endorsement({
      overallStatus: 'ENDORSED',
      sections: [{ section: 'ALL', status: 'ENDORSED', occurredAt: '2026-07-20T12:00:00Z', observations: null }],
    })
    const { teacher, reviewer } = both({ periodStatus: 'CLOSED', missing: 0, endorsement: visada })
    expect(teacher).toMatchObject({ stage: 'ENDORSED', label: 'Visada', symbol: '✓', hint: 'Visada el 20/07/2026' })
    expect(reviewer.hint).toBe('Visada el 20/07/2026')
  })

  it('reabierta después de visada: lo que vale es que se está corrigiendo', () => {
    const visada = endorsement({ overallStatus: 'ENDORSED', periodStatus: 'REOPENED' })
    expect(meetingStage({ periodStatus: 'REOPENED', missing: 1, endorsement: visada }, 'teacher').label).toBe('Reabierta')
  })
})
