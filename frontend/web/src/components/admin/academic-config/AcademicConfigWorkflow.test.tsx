import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AcademicConfigPanel from './AcademicConfigPanel'
import PeriodsTab from './PeriodsTab'
import GradeBooksTab from './GradeBooksTab'
import { api } from '@/lib/api/client'
import type { useOptionalAdminSchoolYear } from '@/contexts/AdminSchoolYearContext'
import type { AcademicPeriod, GradingScale } from '@/lib/academic-config/types'

const context = vi.hoisted(() => ({
  value: null as ReturnType<typeof useOptionalAdminSchoolYear>,
}))
vi.mock('@/contexts/AdminSchoolYearContext', () => ({
  useOptionalAdminSchoolYear: () => context.value,
}))
vi.mock('@/lib/api/client', () => ({ api: vi.fn() }))
const mockedApi = vi.mocked(api)

const period: AcademicPeriod = {
  id: 'p1',
  schoolYearId: 'y2025',
  level: 'EBI',
  code: 'MAYO',
  name: 'Mayo',
  sortOrder: 4,
  startsOn: '2025-05-01',
  endsOn: '2025-05-31',
  closesOn: '2025-06-08',
  requiresConceptualJudgement: true,
  requiresGeneralGrade: true,
  isActive: true,
  kind: 'ENTREGA',
  isMeeting: true,
  judgementLabel: 'Informe de actuación',
  usage: { assessments: 5, closedGradeBooks: 2 },
}
const scale: GradingScale = {
  id: 's1',
  name: 'Numérica',
  code: 'NUMERICA',
  kind: 'NUMERIC',
  isActive: true,
  minValueHundredths: 100,
  maxValueHundredths: 1000,
  decimals: 0,
  sortOrder: 0,
  description: null,
  gradebookRole: null,
  gaps: [],
  levels: [],
  usage: { assessments: 0 },
}
const rules = [
  { type: 'ALERT_SUBJECTS', threshold: 3, isActive: true, source: 'DEFAULT' },
  { type: 'SCORE_DROP', threshold: 200, isActive: true, source: 'DEFAULT' },
  { type: 'NO_ASSESSMENTS', threshold: 0, isActive: false, source: 'DEFAULT' },
]

function cycle(id = 'y2025', loading = false) {
  context.value = {
    loading,
    years: [],
    activeId: 'y2026',
    selectedId: id,
    allYears: false,
    schoolYearQuery: `schoolYearId=${id}`,
    schoolYearScopedQuery: `schoolYearId=${id}`,
    setSelectedId: vi.fn(),
    setAllYears: vi.fn(),
    reload: vi.fn(),
  }
}

describe('Configuración de libreta: flujo simplificado', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    context.value = null
    mockedApi.mockImplementation(async (path, init) => {
      if (path.includes('/periods'))
        return {
          data: [
            period,
            {
              ...period,
              id: 'p2',
              name: 'Junio',
              code: 'JUNIO',
              isActive: false,
            },
          ],
          schoolYearId: 'y2025',
        } as never
      if (path.includes('/scales'))
        return {
          data: [
            scale,
            {
              ...scale,
              id: 's2',
              name: 'Ordinal histórica',
              code: 'HISTORICA',
              isActive: false,
            },
          ],
        } as never
      if (path.includes('/activity-types'))
        return {
          data: [
            {
              id: 't1',
              name: 'Evaluación oral',
              code: 'ORAL',
              isActive: true,
              category: 'ORAL',
              description: 'Exposición',
              usage: { assessments: 4 },
            },
            {
              id: 't2',
              name: 'Oral anterior',
              code: 'ORAL_OLD',
              isActive: false,
              category: 'ORAL',
              usage: { assessments: 0 },
            },
          ],
        } as never
      if (path.includes('/alert-rules')) {
        const saved = init?.body ? JSON.parse(String(init.body)) : null
        return {
          data: rules.map((rule) =>
            rule.type === saved?.type
              ? { ...rule, ...saved, source: 'YEAR' }
              : rule,
          ),
          schoolYearId: 'y2025',
        } as never
      }
      return {} as never
    })
  })

  it('combina estado y búsqueda sin tildes en los catálogos', async () => {
    render(<AcademicConfigPanel />)
    await screen.findByText('Mayo')
    expect(screen.queryByText('Junio')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar período'), {
      target: { value: 'JUN' },
    })
    expect(
      screen.getByText('No hay períodos que coincidan con los filtros.'),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /^Inactivos/ }))
    expect(screen.getByText('Junio')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Escalas' }))
    await screen.findByRole('heading', { name: 'Numérica' })
    fireEvent.change(screen.getByLabelText('Buscar escala'), {
      target: { value: 'numerica' },
    })
    expect(screen.getByRole('heading', { name: 'Numérica' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /^Inactivos/ }))
    expect(screen.queryByText('Ordinal histórica')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Buscar escala'), {
      target: { value: '' },
    })
    expect(screen.getByText('Ordinal histórica')).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: 'Tipos de actividad' }))
    await screen.findByText('Evaluación oral')
    fireEvent.change(screen.getByLabelText('Buscar tipo de actividad'), {
      target: { value: 'evaluacion' },
    })
    expect(screen.getByText('Evaluación oral')).toBeVisible()
    expect(screen.queryByText('Oral anterior')).not.toBeInTheDocument()
    expect(screen.getByText('Exposición')).not.toBeVisible()
    fireEvent.click(screen.getByText('Detalles de Evaluación oral'))
    expect(screen.getByText('Exposición')).toBeVisible()
  })

  it('permite navegar las secciones con flechas, Inicio y Fin', async () => {
    render(<AcademicConfigPanel />)
    await screen.findByText('Mayo')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Períodos' }), {
      key: 'ArrowRight',
    })
    expect(screen.getByRole('tab', { name: 'Escalas' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Escalas' }), {
      key: 'End',
    })
    expect(
      screen.getByRole('heading', { name: 'Generación de libretas' }),
    ).toBeVisible()
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Libretas' }), {
      key: 'Home',
    })
    expect(screen.getByRole('tab', { name: 'Períodos' })).toHaveFocus()
    await screen.findByText('Mayo')
  })

  it('aplica el calendario sin perder opciones avanzadas al editar', async () => {
    render(<PeriodsTab onError={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Mayo' }))
    const modal = screen.getByRole('dialog', { name: 'Editar Mayo' })
    expect(within(modal).getByLabelText('Tipo de bloque')).not.toBeVisible()
    fireEvent.click(within(modal).getByRole('button', { name: /^Período/ }))
    const calendar = screen.getByRole('dialog', { name: 'Elegir período' })
    fireEvent.change(within(calendar).getByLabelText('Fecha inicio'), {
      target: { value: '02/05/2025' },
    })
    fireEvent.change(within(calendar).getByLabelText('Fecha fin'), {
      target: { value: '30/05/2025' },
    })
    fireEvent.click(within(calendar).getByRole('button', { name: 'Aplicar' }))
    fireEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/academic-config/periods/p1',
        expect.objectContaining({ method: 'PATCH' }),
      ),
    )
    const init = mockedApi.mock.calls.find(
      ([path, options]) => path.endsWith('/p1') && options?.method === 'PATCH',
    )?.[1]
    expect(JSON.parse(String(init?.body))).toMatchObject({
      startsOn: '2025-05-02',
      endsOn: '2025-05-30',
      sortOrder: 4,
      kind: 'ENTREGA',
      judgementLabel: 'Informe de actuación',
      isMeeting: true,
    })
  })

  it('Escape cierra primero el calendario y conserva el formulario', async () => {
    render(<PeriodsTab onError={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Editar Mayo' }))
    fireEvent.click(screen.getByRole('button', { name: /^Período/ }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: 'Elegir período' }),
    ).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Editar Mayo' })).toBeVisible()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(
      screen.queryByRole('dialog', { name: 'Editar Mayo' }),
    ).not.toBeInTheDocument()
  })

  it('espera el ciclo seleccionado y descarta una carga tardía del ciclo anterior', async () => {
    cycle('y2025', true)
    let finishOld!: (value: unknown) => void
    mockedApi.mockImplementation((path) => {
      if (path.includes('y2025'))
        return new Promise((resolve) => {
          finishOld = resolve
        }) as never
      return Promise.resolve({
        data: [{ ...period, name: 'Mayo 2026', schoolYearId: 'y2026' }],
        schoolYearId: 'y2026',
      }) as never
    })
    const { rerender } = render(<PeriodsTab onError={vi.fn()} />)
    expect(mockedApi).not.toHaveBeenCalled()
    cycle('y2025')
    const onError = vi.fn()
    rerender(<PeriodsTab onError={onError} />)
    await waitFor(() => expect(mockedApi).toHaveBeenCalledTimes(1))
    cycle('y2026')
    rerender(<PeriodsTab onError={onError} />)
    await screen.findByText('Mayo 2026')
    await act(async () => finishOld({ data: [period], schoolYearId: 'y2025' }))
    expect(screen.queryByText('Mayo')).not.toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'Nuevo período en EBI' }),
    )
    fireEvent.change(screen.getByLabelText('Nombre'), {
      target: { value: 'Junio 2026' },
    })
    fireEvent.change(screen.getByLabelText('Código'), {
      target: { value: 'JUNIO' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    await waitFor(() =>
      expect(mockedApi).toHaveBeenCalledWith(
        '/admin/academic-config/periods',
        expect.objectContaining({
          body: expect.stringContaining('"schoolYearId":"y2026"'),
        }),
      ),
    )
  })

  it('guarda una alerta sin pisar lo escrito en otra y confirma el resultado', async () => {
    render(<AcademicConfigPanel />)
    await screen.findByText('Mayo')
    fireEvent.click(screen.getByRole('tab', { name: 'Alertas' }))
    const heading = await screen.findByRole('heading', {
      name: 'Asignaturas en alerta',
    })
    const subject = within(heading.closest('section')!)
    const drop = within(
      screen
        .getByRole('heading', { name: 'Caída del promedio' })
        .closest('section')!,
    )
    expect(subject.getByRole('button', { name: 'Guardar' })).toBeDisabled()
    fireEvent.change(drop.getByLabelText('Puntos de caída'), {
      target: { value: '2,5' },
    })
    fireEvent.change(subject.getByLabelText('Asignaturas'), {
      target: { value: '4' },
    })
    fireEvent.click(subject.getByRole('button', { name: 'Guardar' }))
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se guardó la regla «Asignaturas en alerta».',
    )
    expect(drop.getByLabelText('Puntos de caída')).toHaveValue('2,5')
    expect(drop.getByRole('button', { name: 'Guardar' })).toBeEnabled()
  })

  it('oculta el resultado de generación al cambiar de ciclo', async () => {
    cycle()
    mockedApi.mockResolvedValue({
      data: {
        created: 1,
        updated: 0,
        unchanged: 0,
        skippedEvents: 0,
        skippedNotOffered: 0,
      },
    })
    const onError = vi.fn()
    const { rerender } = render(<GradeBooksTab onError={onError} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Generar libretas ahora' }),
    )
    expect(await screen.findByRole('status')).toHaveTextContent(
      'Se creó 1 libreta nueva.',
    )
    expect(mockedApi).toHaveBeenCalledWith(
      '/admin/academic-config/gradebooks/provision?schoolYearId=y2025',
      { method: 'POST' },
    )
    cycle('y2026')
    rerender(<GradeBooksTab onError={onError} />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
