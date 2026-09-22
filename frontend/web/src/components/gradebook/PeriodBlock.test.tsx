import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PeriodBlock, { type BlockGrade, type BlockLevel } from './PeriodBlock'

const LEVELS: BlockLevel[] = [
  { label: 'En proceso', minValueHundredths: 300, maxValueHundredths: 499, colorToken: 'orange', iconToken: 'alert-circle', isAlert: true },
  { label: 'Logrado', minValueHundredths: 600, maxValueHundredths: 799, colorToken: 'lime', iconToken: 'check', isAlert: false },
  { label: 'Muy bueno', minValueHundredths: 800, maxValueHundredths: 999, colorToken: 'blue', iconToken: 'diamond', isAlert: false },
]

function grade(over: Partial<BlockGrade>): BlockGrade {
  return {
    key: Math.random().toString(),
    category: 'oral',
    valueHundredths: 700,
    isAbsent: false,
    date: '2026-05-10',
    title: 'Oral',
    comment: null,
    ...over,
  }
}

const TRAMO = { id: 'p1', code: 'MAYO_JUNIO', name: 'Mayo – Junio', kind: 'TRAMO' as const }
const ENTREGA = {
  id: 'p2',
  code: 'ENTREGA_1',
  name: '1.ª Entrega',
  kind: 'ENTREGA' as const,
  requiresConceptualJudgement: true,
  judgementLabel: 'Informe de actuación',
}

describe('<PeriodBlock /> tramo', () => {
  it('muestra cada nota suelta, sin promediar, en las columnas de la planilla', () => {
    render(
      <PeriodBlock
        period={TRAMO}
        grades={[grade({ valueHundredths: 700 }), grade({ valueHundredths: 900 })]}
        saved={null}
        levels={LEVELS}
        decimals={0}
        editable={false}
      />,
    )
    expect(screen.getByText('Or')).toBeInTheDocument()
    expect(screen.getByText('Otras')).toBeInTheDocument()
    expect(screen.getByText('Ev')).toBeInTheDocument()
    expect(screen.getByLabelText('7, Logrado')).toBeInTheDocument()
    expect(screen.getByLabelText('9, Muy bueno')).toBeInTheDocument()
    expect(screen.queryByText('8')).not.toBeInTheDocument()
    expect(screen.queryByText('Prueba')).not.toBeInTheDocument()
  })

  it('agrega la columna Prueba sólo si el tramo tiene una', () => {
    render(
      <PeriodBlock
        period={TRAMO}
        grades={[grade({ category: 'test', valueHundredths: 400 })]}
        saved={null}
        levels={LEVELS}
        decimals={0}
        editable={false}
      />,
    )
    expect(screen.getByText('Prueba')).toBeInTheDocument()
    expect(screen.getByLabelText('4, En proceso')).toBeInTheDocument()
  })

  it('C y R se editan en la carta y cada una se guarda por separado', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <PeriodBlock
        period={TRAMO}
        grades={[]}
        saved={{ valueHundredths: 700, meetingValueHundredths: null, conceptualJudgement: null }}
        levels={LEVELS}
        decimals={0}
        editable
        onSave={onSave}
      />,
    )
    await userEvent.selectOptions(screen.getByLabelText('R: nota de reunión de Mayo – Junio'), '8')
    expect(onSave).toHaveBeenCalledWith({ meetingValueHundredths: 800 })
  })

  it('el + de una columna abre la carga con esa categoría', async () => {
    const onAddGrade = vi.fn()
    render(
      <PeriodBlock
        period={TRAMO}
        grades={[]}
        saved={null}
        levels={LEVELS}
        decimals={0}
        editable
        onAddGrade={onAddGrade}
      />,
    )
    await userEvent.click(screen.getByLabelText('Agregar nota de Evaluaciones escritas en Mayo – Junio'))
    expect(onAddGrade).toHaveBeenCalledWith('written')
  })
})

describe('<PeriodBlock /> entrega', () => {
  it('lleva informe de actuación, C y R, y no admite notas sueltas', () => {
    render(
      <PeriodBlock
        period={ENTREGA}
        grades={[]}
        saved={{ valueHundredths: 700, meetingValueHundredths: 800, conceptualJudgement: null }}
        levels={LEVELS}
        decimals={0}
        editable={false}
      />,
    )
    expect(screen.getByRole('button', { name: /Informe de actuación: falta/ })).toBeInTheDocument()
    expect(screen.getByLabelText('8, Muy bueno')).toBeInTheDocument()
    expect(screen.queryByText('Or')).not.toBeInTheDocument()
  })

  it('guarda el informe desde la misma carta', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <PeriodBlock period={ENTREGA} grades={[]} saved={null} levels={LEVELS} decimals={0} editable onSave={onSave} />,
    )
    await userEvent.click(screen.getByRole('button', { name: /Informe de actuación/ }))
    await userEvent.type(screen.getByLabelText('Informe de actuación'), 'Avanza con autonomía.')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave).toHaveBeenCalledWith({ conceptualJudgement: 'Avanza con autonomía.' })
  })

  it('si guardar falla, lo dice en el bloque', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('El período está cerrado.'))
    render(
      <PeriodBlock period={ENTREGA} grades={[]} saved={null} levels={LEVELS} decimals={0} editable onSave={onSave} />,
    )
    await userEvent.selectOptions(screen.getByLabelText('C: calificación de 1.ª Entrega'), '7')
    expect(await screen.findByRole('alert')).toHaveTextContent('El período está cerrado.')
  })
})

describe('<PeriodBlock /> diagnóstico', () => {
  it('sólo tiene el texto', () => {
    render(
      <PeriodBlock
        period={{ id: 'd', code: 'MODULO_INTRODUCTORIO', name: 'Diagnóstico', kind: 'DIAGNOSTICO' }}
        grades={[]}
        saved={{ valueHundredths: null, meetingValueHundredths: null, conceptualJudgement: 'Lee con fluidez.' }}
        levels={LEVELS}
        decimals={0}
        editable={false}
      />,
    )
    const block = screen.getByText('Diagnóstico', { selector: 'p' }).parentElement!
    expect(within(block).queryByText('C')).not.toBeInTheDocument()
    expect(within(block).getByRole('button', { name: /Diagnóstico: cargado/ })).toBeInTheDocument()
  })
})
