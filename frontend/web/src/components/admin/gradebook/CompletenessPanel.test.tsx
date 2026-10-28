import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CompletenessPanel, { bulkNoticeText, completenessPath, isDone, rowLabel } from './CompletenessPanel'
import { api } from '@/lib/api/client'

vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

type Props = ComponentProps<typeof CompletenessPanel>

function row(over: Record<string, unknown> = {}) {
  return {
    gradeBookId: 'gb-1',
    subjectName: 'Matemática',
    courseName: '8 EBI',
    teacherName: 'Ana Benítez',
    periodStatus: 'OPEN',
    rosterSize: 20,
    expectsAssessments: true,
    assessmentCount: 3,
    hasNoAssessments: false,
    missingAssessmentGrades: 0,
    requiresGrade: true,
    missingGrades: 6,
    requiresJudgement: true,
    missingJudgements: 0,
    requiresConduct: true,
    missingConduct: 0,
    requiresGroupReport: true,
    missingGroupReport: false,
    complete: false,
    ...over,
  }
}

function respond(notified = 1) {
  mockedApi.mockImplementation((path: string) => {
    if (String(path).endsWith('/request-all')) return Promise.resolve({ teachers: 2, gradeBooks: 3, withoutTeacher: 1 } as never)
    return Promise.resolve({ ok: true, notified } as never)
  })
}

function renderPanel(rows: unknown[], over: Partial<Props> = {}) {
  const onReload = vi.fn().mockResolvedValue(undefined)
  render(
    <CompletenessPanel
      periodId="e1"
      group={null}
      stage="before"
      rows={rows as Props['rows']}
      loading={false}
      error={null}
      onReload={onReload}
      {...over}
    />,
  )
  return { onReload }
}

const posted = (suffix: string) => {
  const call = mockedApi.mock.calls.find(([path]) => String(path).endsWith(suffix))
  return { path: String(call?.[0]), body: JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? 'null')) }
}

beforeEach(() => {
  vi.clearAllMocks()
  respond()
})

describe('<CompletenessPanel />', () => {
  it('muestra por columna qué falta: evaluaciones, R, C, juicio e informe del grupo', () => {
    renderPanel([row({ missingAssessmentGrades: 4, missingConduct: 2, missingGroupReport: true })])

    expect(screen.getByText('3 cargadas · faltan 4 notas')).toBeInTheDocument()
    expect(screen.getByText('Faltan 6')).toBeInTheDocument()
    expect(screen.getByText('Faltan 2')).toBeInTheDocument()
    expect(screen.getByText('▲ Falta')).toBeInTheDocument()
    for (const header of ['Rendimiento (R)', 'Conducta (C)', 'Informe del grupo']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument()
    }
    expect(screen.getByText('Ana Benítez')).toBeInTheDocument()
  })

  it('con sólo notas sueltas, dice cuántos alumnos no tienen ninguna', () => {
    renderPanel([row({ studentsWithoutGrades: 2, complete: false })])
    expect(screen.getByText('3 cargadas · 2 alumnos sin notas')).toBeInTheDocument()
  })

  it('marca la libreta sin evaluaciones', () => {
    renderPanel([row({ hasNoAssessments: true, assessmentCount: 0, missingGrades: 0 })])
    expect(screen.getByText('Sin evaluaciones')).toBeInTheDocument()
  })

  it('por defecto esconde las que están al día', async () => {
    renderPanel([row(), row({ gradeBookId: 'gb-2', subjectName: 'Historia', complete: true })])

    expect(screen.getByText(/8 EBI · Matemática/)).toBeInTheDocument()
    expect(screen.queryByText(/Historia/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Sólo las que faltan'))
    expect(await screen.findByText(/Historia/)).toBeInTheDocument()
  })

  it('el aviso manda sólo el período: el detalle lo arma el backend', async () => {
    renderPanel([row()])

    fireEvent.click(screen.getByRole('button', { name: /Avisar al docente/ }))

    await waitFor(() => expect(posted('/request').path).toBe('/admin/gradebook/completeness/gb-1/request'))
    expect(posted('/request').body).toEqual({ periodId: 'e1', stage: 'before' })
    expect(await screen.findByText('Avisado')).toBeInTheDocument()
  })

  it('no dice "Avisado" si no le llegó a nadie', async () => {
    respond(0)
    renderPanel([row()])

    fireEvent.click(screen.getByRole('button', { name: /Avisar al docente/ }))
    expect(await screen.findByText('Sin docente a quien avisar')).toBeInTheDocument()
  })

  it('no deja avisar si la libreta no tiene titular', () => {
    renderPanel([row({ teacherName: null })])
    expect(screen.getByRole('button', { name: /Avisar al docente/ })).toBeDisabled()
  })

  it('celebra cuando no falta nada', () => {
    renderPanel([row({ complete: true })])
    expect(screen.getByText('Todas las libretas están al día para esta reunión.')).toBeInTheDocument()
  })

  it('muestra el error de carga sin dejar la pantalla en blanco', () => {
    renderPanel([], { error: 'Sin permiso' })
    expect(screen.getByRole('alert')).toHaveTextContent('Sin permiso')
  })

  it('mientras revisa no dice que está todo al día', () => {
    renderPanel([], { loading: true })
    expect(screen.getByText('Revisando libretas…')).toBeInTheDocument()
    expect(screen.queryByText(/al día/)).not.toBeInTheDocument()
  })

  it('nombra la libreta con la orientación del grupo', () => {
    renderPanel([row({ courseName: '5.º', orientationName: 'Científico' })])
    expect(screen.getByText('5.º — Científico · Matemática')).toBeInTheDocument()
  })

  it('en el cierre mira el período, y avisa con esa etapa', async () => {
    renderPanel([row({ complete: true, periodStatus: 'OPEN' })], { stage: 'after' })

    expect(screen.getByText('Abierto')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Avisar al docente/ }))
    await waitFor(() => expect(posted('/request').body).toEqual({ periodId: 'e1', stage: 'after' }))
  })

  it('muestra cuándo se avisó por última vez', () => {
    renderPanel([row({ lastRequestedAt: { before: '2026-06-10T15:00:00.000Z', after: null } })])
    expect(screen.getByText('Avisado el 10/06/2026')).toBeInTheDocument()
  })

  it('avisa a todos de una vez, recarga y dice a cuántos docentes', async () => {
    const { onReload } = renderPanel([row(), row({ gradeBookId: 'gb-2', subjectName: 'Historia' })])

    fireEvent.click(screen.getByRole('button', { name: 'Avisar a todos (2)' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Se avisó a 2 docentes por 3 libretas')
    expect(posted('/request-all').body).toEqual({ periodId: 'e1', stage: 'before' })
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('con un grupo elegido, avisar a todos avisa sólo por ese grupo', async () => {
    renderPanel([row()], { group: { courseOfferingId: 'off-5', courseOrientationId: 'co-1' } })

    fireEvent.click(screen.getByRole('button', { name: 'Avisar a todos (1)' }))

    await waitFor(() =>
      expect(posted('/request-all').body).toEqual({
        periodId: 'e1',
        stage: 'before',
        courseOfferingId: 'off-5',
        courseOrientationId: 'co-1',
      }),
    )
  })
})

describe('auxiliares del control', () => {
  it('cada etapa tiene su "al día"', () => {
    const r = row({ complete: true, periodStatus: 'OPEN' }) as never
    expect(isDone(r, 'before')).toBe(true)
    expect(isDone(r, 'after')).toBe(false)
  })

  it('el nombre sin orientación no deja un guion suelto', () => {
    expect(rowLabel({ courseName: '1.º', orientationName: null, subjectName: 'Matemática' })).toBe('1.º · Matemática')
  })

  it('el resultado del aviso masivo en singular y sin titulares', () => {
    expect(bulkNoticeText({ teachers: 1, gradeBooks: 1, withoutTeacher: 0 })).toBe('Se avisó a 1 docente por 1 libreta, un aviso por docente.')
    expect(bulkNoticeText({ teachers: 0, gradeBooks: 0, withoutTeacher: 2 })).toContain('no tienen titular')
  })

  it('pide el control por el id de la reunión, con el grupo si hay', () => {
    expect(completenessPath('s1', null)).toBe('/admin/gradebook/completeness?periodId=s1')
    expect(completenessPath('s1', { courseOfferingId: 'off-1', courseOrientationId: null })).toBe(
      '/admin/gradebook/completeness?periodId=s1&courseOfferingId=off-1',
    )
  })
})
