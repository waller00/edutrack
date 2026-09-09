import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StudentFormModal from './StudentFormModal'
import { emptyStudentDraft, type StudentFormState } from './student-types'

vi.mock('./StudentPhotoField', () => ({
  default: () => <div>foto</div>,
  initialsOf: () => 'DA',
}))
vi.mock('./StudentTuitionSection', () => ({ default: () => <div>panel de mensualidades</div> }))
vi.mock('./StudentEnrollmentHistoryPanel', () => ({ default: () => <div>panel de historial</div> }))

const onSave = vi.fn()
const onPatch = vi.fn()
const onClose = vi.fn()
const onMoodleAction = vi.fn()

function form(over: Partial<StudentFormState> = {}): StudentFormState {
  return { id: 's1', ...emptyStudentDraft(), ...over }
}

function setup(over: Record<string, unknown> = {}, formOver: Partial<StudentFormState> = {}) {
  return render(
    <StudentFormModal
      mode="create"
      form={form(formOver)}
      courses={[{ id: 'c1', name: 'Primero', code: '1' }]}
      orientations={[]}
      tuitionYear={2026}
      saving={false}
      moodlePending={false}
      message=""
      onTuitionYearChange={vi.fn()}
      onPatch={onPatch}
      onUsernameEdit={vi.fn()}
      onMoodleAction={onMoodleAction}
      onSave={onSave}
      onClose={onClose}
      {...over}
    />,
  )
}

const VALID = { firstName: 'Ana', lastName: 'Díaz', documentId: '51234561' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('alta', () => {
  it('no muestra pestañas ni mensualidades: sólo lo esencial', () => {
    // Cobrar cuotas de un estudiante que todavía no existe no tiene sentido.
    setup()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('panel de mensualidades')).not.toBeInTheDocument()
    expect(screen.queryByText('panel de historial')).not.toBeInTheDocument()
  })

  it('el contacto arranca plegado y se puede abrir', () => {
    setup()
    expect(screen.queryByLabelText(/^Email/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Contacto y aula virtual/ }))

    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Usuario del aula virtual/)).toBeInTheDocument()
  })

  it('no ofrece el estado de matrícula: nace activo', () => {
    setup()
    expect(screen.queryByLabelText(/Estado de matrícula/)).not.toBeInTheDocument()
  })

  it('guarda con nombre, apellido y cédula', () => {
    setup({}, VALID)
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave).toHaveBeenCalled()
  })

  it('guarda sin email ni usuario', () => {
    setup({}, { ...VALID, email: null, username: null })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))
    expect(onSave).toHaveBeenCalled()
  })

  it('dice qué falta en vez de dejar el botón muerto', () => {
    setup({}, { ...VALID, lastName: '' })

    const guardar = screen.getByRole('button', { name: 'Guardar' })
    expect(guardar).not.toBeDisabled()
    fireEvent.click(guardar)

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Poné el apellido del estudiante.')
  })

  it('abre el contacto plegado cuando el error está adentro', () => {
    // Si no, el mensaje señalaría un campo que no se ve.
    setup({}, { ...VALID, email: 'no-es-un-email' })
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByLabelText(/^Email/)).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('El email no tiene un formato válido.')
  })
})

describe('edición', () => {
  const editProps = { mode: 'edit' as const }

  it('muestra las cinco pestañas', () => {
    setup(editProps, VALID)
    const tabs = screen.getByRole('tablist')
    for (const label of ['Datos', 'Contacto', 'Aula virtual', 'Mensualidades', 'Historial']) {
      expect(within(tabs).getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('el historial se monta recién al abrir su pestaña', () => {
    // Se auto-consulta al montar: dejarlo siempre montado pedía datos que nadie mira.
    setup(editProps, VALID)
    expect(screen.queryByText('panel de historial')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Historial' }))
    expect(screen.getByText('panel de historial')).toBeInTheDocument()
  })

  it('salta a la pestaña que tiene el error y lo muestra', () => {
    // Es lo que evita que las pestañas escondan un campo obligatorio.
    setup(editProps, { ...VALID, email: 'roto' })
    fireEvent.click(screen.getByRole('tab', { name: 'Mensualidades' }))
    expect(screen.getByText('panel de mensualidades')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(screen.getByRole('tab', { name: 'Contacto' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('alert')).toHaveTextContent('El email no tiene un formato válido.')
  })

  it('la pestaña del aula virtual explica que la cuenta no se crea sola', () => {
    setup(editProps, VALID)
    fireEvent.click(screen.getByRole('tab', { name: 'Aula virtual' }))
    expect(screen.getByText(/no se crea sola al dar de alta/)).toBeInTheDocument()
  })

  it('ofrece crear la cuenta cuando el alumno no la tiene', () => {
    setup(editProps, {
      ...VALID,
      moodle: { ...emptyStudentDraft().moodle, state: 'NOT_FOUND', linked: false, canProvision: true },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Aula virtual' }))
    fireEvent.click(screen.getByRole('button', { name: /Crear cuenta en Moodle/ }))

    expect(onMoodleAction).toHaveBeenCalledWith('provision')
  })

  it('ofrece reenviar cuando la cuenta existe y está pendiente', () => {
    setup(editProps, {
      ...VALID,
      moodle: { ...emptyStudentDraft().moodle, state: 'PENDING', linked: true, canProvision: true },
    })
    fireEvent.click(screen.getByRole('tab', { name: 'Aula virtual' }))
    fireEvent.click(screen.getByRole('button', { name: /Reenviar acceso/ }))

    expect(onMoodleAction).toHaveBeenCalledWith('resend')
  })

  it('permite dar de baja y pide la fecha', () => {
    setup(editProps, { ...VALID, enrollmentStatus: 'WITHDRAWN' })
    expect(screen.getByLabelText(/Fecha de baja/)).toBeInTheDocument()
  })
})

describe('accesibilidad', () => {
  it('Escape cierra el diálogo', () => {
    setup()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })

  it('es un diálogo con nombre', () => {
    setup()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByRole('heading', { name: 'Nuevo estudiante' })).toBeInTheDocument()
  })
})
