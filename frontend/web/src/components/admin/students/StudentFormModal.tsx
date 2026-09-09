'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import DateField from '@/components/forms/DateField'
import FormField, { fieldInputClass } from '@/components/forms/FormField'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { validateStudent, type StudentFormError, type StudentTabId } from '@/lib/admin/student-form'
import StudentMoodleBadge from './StudentMoodleBadge'
import StudentPhotoField from './StudentPhotoField'
import StudentTuitionSection from './StudentTuitionSection'
import StudentEnrollmentHistoryPanel from './StudentEnrollmentHistoryPanel'
import type {
  CourseOpt,
  OrientationOpt,
  StudentFormState,
  StudentPhotoMeta,
  StudentTuitionMonth,
} from './student-types'
import { STUDENT_STATUS_OPTIONS, ymd } from './student-types'

type Props = {
  mode: 'create' | 'edit'
  form: StudentFormState
  courses: CourseOpt[]
  orientations: OrientationOpt[]
  tuitionYear: number
  saving: boolean
  moodlePending: boolean
  message: string
  onTuitionYearChange: (year: number) => void
  onPatch: <K extends keyof StudentFormState>(key: K, value: StudentFormState[K]) => void
  onUsernameEdit: (value: string | null) => void
  onMoodleAction: (action: 'provision' | 'resend') => void
  onSave: () => void
  onClose: () => void
}

const TABS: { id: StudentTabId; label: string }[] = [
  { id: 'datos', label: 'Datos' },
  { id: 'contacto', label: 'Contacto' },
  { id: 'moodle', label: 'Aula virtual' },
  { id: 'mensualidades', label: 'Mensualidades' },
  { id: 'historial', label: 'Historial' },
]

export default function StudentFormModal({
  mode,
  form,
  courses,
  orientations,
  tuitionYear,
  saving,
  moodlePending,
  message,
  onTuitionYearChange,
  onPatch,
  onUsernameEdit,
  onMoodleAction,
  onSave,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)
  const isEdit = mode === 'edit'
  const [tab, setTab] = useState<StudentTabId>('datos')
  // Al crear, el contacto arranca plegado: son datos opcionales que ya no traban el alta.
  const [contactOpen, setContactOpen] = useState(false)
  const [error, setError] = useState<StudentFormError | null>(null)

  useEffect(() => {
    firstFieldRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key !== 'Tab' || !panelRef.current) return
      // Trampa de foco: el diálogo no debe dejar tabular hacia la página de atrás.
      const focusable = panelRef.current.querySelectorAll<HTMLElement>(
        'button, input, select, textarea, [href], [tabindex]:not([tabindex="-1"])',
      )
      if (focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const fullName = `${form.firstName} ${form.lastName}`.trim()
  const errorFor = (field: string) => (error?.field === field ? error.message : undefined)

  /**
   * Al guardar se salta a la pestaña del problema y se enfoca el campo. Sin esto, dividir la ficha
   * en pestañas escondería un campo obligatorio y el error quedaría fuera de la vista.
   */
  function submit() {
    const problem = validateStudent(form)
    setError(problem)
    if (!problem) {
      onSave()
      return
    }
    if (isEdit) setTab(problem.tab)
    if (problem.tab === 'contacto') setContactOpen(true)
    // El salto de pestaña recién monta el campo en el próximo render.
    setTimeout(() => document.getElementById(`st-${problem.field}`)?.focus(), 0)
  }

  const identity = (
    <div className="flex flex-col gap-4 sm:flex-row">
      <StudentPhotoField
        studentId={isEdit ? form.id : null}
        firstName={form.firstName}
        lastName={form.lastName}
        photo={form.photo ?? null}
        onChange={(photo: StudentPhotoMeta | null) => onPatch('photo', photo)}
        onError={(m) => setError({ field: 'photo', tab: 'datos', message: m })}
      />

      <div className="flex-1 space-y-3">
        {errorFor('photo') && (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
            {errorFor('photo')}
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Nombre" id="st-firstName" required error={errorFor('firstName')}>
            <input
              id="st-firstName"
              ref={firstFieldRef}
              className={fieldInputClass('input-field', errorFor('firstName'))}
              value={form.firstName}
              onChange={(e) => onPatch('firstName', e.target.value)}
            />
          </FormField>
          <FormField label="Apellido" id="st-lastName" required error={errorFor('lastName')}>
            <input
              id="st-lastName"
              className={fieldInputClass('input-field', errorFor('lastName'))}
              value={form.lastName}
              onChange={(e) => onPatch('lastName', e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="Cédula"
          id="st-documentId"
          required
          error={errorFor('documentId')}
          hint="Con puntos y guion o sin nada: 1.234.567-8"
        >
          <input
            id="st-documentId"
            inputMode="numeric"
            className={fieldInputClass('input-field', errorFor('documentId'))}
            value={form.documentId ?? ''}
            onChange={(e) => onPatch('documentId', e.target.value || null)}
          />
        </FormField>

        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Curso" id="st-courseId">
            <select
              id="st-courseId"
              className="select-field w-full"
              value={form.courseId ?? ''}
              onChange={(e) => {
                onPatch('courseId', e.target.value || null)
                onPatch('orientationId', null)
              }}
            >
              <option value="">—</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Orientación"
            id="st-orientationId"
            hint={
              form.courseId && orientations.length === 0
                ? 'Este curso no tiene orientaciones configuradas.'
                : undefined
            }
          >
            <select
              id="st-orientationId"
              className="select-field w-full"
              value={form.orientationId ?? ''}
              disabled={!form.courseId || orientations.length === 0}
              onChange={(e) => onPatch('orientationId', e.target.value || null)}
            >
              <option value="">Tronco común</option>
              {orientations.map((o) => (
                <option key={o.orientationId} value={o.orientationId}>
                  {o.orientation.name}
                </option>
              ))}
            </select>
          </FormField>
        </div>

        {isEdit && (
          <>
            <FormField label="Estado de matrícula" id="st-enrollmentStatus">
              <select
                id="st-enrollmentStatus"
                className="select-field w-full"
                value={form.enrollmentStatus}
                onChange={(e) => onPatch('enrollmentStatus', e.target.value)}
              >
                {STUDENT_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </FormField>

            {form.enrollmentStatus !== 'ACTIVE' && (
              <div className="grid gap-3 rounded-lg bg-amber-50/60 p-3 sm:grid-cols-2">
                <FormField label="Fecha de baja" id="st-withdrawnAt">
                  <DateField
                    id="st-withdrawnAt"
                    value={ymd(form.withdrawnAt)}
                    onChange={(v) => onPatch('withdrawnAt', v || null)}
                  />
                </FormField>
                <FormField label="Año lectivo de la baja" id="st-withdrawalAcademicYear">
                  <input
                    id="st-withdrawalAcademicYear"
                    type="number"
                    className="input-field w-full"
                    value={form.withdrawalAcademicYear ?? ''}
                    onChange={(e) =>
                      onPatch('withdrawalAcademicYear', e.target.value ? Number(e.target.value) : null)
                    }
                  />
                </FormField>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )

  const contact = (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField
          label="Email"
          id="st-email"
          error={errorFor('email')}
          hint="Hace falta sólo para crear la cuenta del aula virtual."
        >
          <input
            id="st-email"
            type="email"
            className={fieldInputClass('input-field', errorFor('email'))}
            value={form.email ?? ''}
            onChange={(e) => onPatch('email', e.target.value || null)}
          />
        </FormField>
        <FormField
          label="Usuario del aula virtual"
          id="st-username"
          error={errorFor('username')}
          hint="Se sugiere solo a partir del nombre."
        >
          <input
            id="st-username"
            placeholder="nombre.apellido"
            className={fieldInputClass('input-field', errorFor('username'))}
            value={form.username ?? ''}
            onChange={(e) => onUsernameEdit(e.target.value || null)}
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Teléfono de contacto" id="st-contactPhone" error={errorFor('contactPhone')}>
          <input
            id="st-contactPhone"
            className={fieldInputClass('input-field', errorFor('contactPhone'))}
            value={form.contactPhone ?? ''}
            onChange={(e) => onPatch('contactPhone', e.target.value || null)}
          />
        </FormField>
        <FormField label="Teléfono del tutor" id="st-tutorPhone" error={errorFor('tutorPhone')}>
          <input
            id="st-tutorPhone"
            className={fieldInputClass('input-field', errorFor('tutorPhone'))}
            value={form.tutorPhone ?? ''}
            onChange={(e) => onPatch('tutorPhone', e.target.value || null)}
          />
        </FormField>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Dirección" id="st-address" error={errorFor('address')}>
          <input
            id="st-address"
            className={fieldInputClass('input-field', errorFor('address'))}
            value={form.address ?? ''}
            onChange={(e) => onPatch('address', e.target.value || null)}
          />
        </FormField>
        <FormField label="Vencimiento del carné de salud" id="st-healthCardExpiresAt">
          <DateField
            id="st-healthCardExpiresAt"
            value={ymd(form.healthCardExpiresAt)}
            onChange={(v) => onPatch('healthCardExpiresAt', v || null)}
          />
        </FormField>
      </div>

      <FormField label="Acceso al portal del liceo" id="st-liceoAccessNotes" error={errorFor('liceoAccessNotes')}>
        <textarea
          id="st-liceoAccessNotes"
          rows={2}
          className={fieldInputClass('input-field', errorFor('liceoAccessNotes'))}
          value={form.liceoAccessNotes ?? ''}
          onChange={(e) => onPatch('liceoAccessNotes', e.target.value || null)}
        />
      </FormField>

      <FormField
        label="Notas internas"
        id="st-internalNotes"
        error={errorFor('internalNotes')}
        hint="Visible sólo para administración."
      >
        <textarea
          id="st-internalNotes"
          rows={3}
          className={fieldInputClass('input-field', errorFor('internalNotes'))}
          value={form.internalNotes ?? ''}
          onChange={(e) => onPatch('internalNotes', e.target.value || null)}
        />
      </FormField>
    </div>
  )

  const tuition = (
    <StudentTuitionSection
      year={tuitionYear}
      months={form.tuitionMonths}
      onYearChange={onTuitionYearChange}
      onChange={(months: StudentTuitionMonth[]) => onPatch('tuitionMonths', months)}
    />
  )

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="student-modal-title">
      <div ref={panelRef} className="responsive-modal-panel max-w-3xl p-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
          <h2 id="student-modal-title" className="text-lg font-semibold text-gray-900">
            {isEdit ? fullName || 'Editar estudiante' : 'Nuevo estudiante'}
          </h2>
          <button
            type="button"
            className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>

        {isEdit && (
          <div role="tablist" aria-label="Secciones de la ficha" className="flex flex-wrap gap-1 border-b border-gray-200 px-5">
            {TABS.map((item) => {
              const selected = tab === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`tab-${item.id}`}
                  aria-selected={selected}
                  aria-controls={`panel-${item.id}`}
                  onClick={() => setTab(item.id)}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                    selected
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {item.label}
                </button>
              )
            })}
          </div>
        )}

        <div className="max-h-[70vh] space-y-5 overflow-y-auto px-5 py-5 text-sm">
          {message ? (
            <p className={`rounded-lg px-3 py-2 text-sm ${getAdminFlashMessageClass(message)}`}>{message}</p>
          ) : null}

          {!isEdit ? (
            <>
              {identity}
              <section className="rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={() => setContactOpen((v) => !v)}
                  aria-expanded={contactOpen}
                  className="flex w-full items-center justify-between px-4 py-3 text-left"
                >
                  <span>
                    <span className="text-sm font-medium text-gray-900">Contacto y aula virtual</span>
                    <span className="block text-xs text-gray-500">
                      Opcional. El email y el usuario se pueden cargar después.
                    </span>
                  </span>
                  <span aria-hidden className="text-gray-400">{contactOpen ? '▲' : '▼'}</span>
                </button>
                {contactOpen && <div className="border-t border-gray-100 px-4 py-4">{contact}</div>}
              </section>
            </>
          ) : (
            <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
              {tab === 'datos' && identity}
              {tab === 'contacto' && contact}
              {tab === 'moodle' && (
                <div className="space-y-3">
                  <p className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">
                    La cuenta del aula virtual no se crea sola al dar de alta: se crea acá, cuando
                    querés, y el estudiante recibe su acceso por correo.
                  </p>
                  <StudentMoodleBadge
                    moodle={form.moodle}
                    studentName={fullName}
                    pending={moodlePending}
                    onAction={onMoodleAction}
                    withHint
                  />
                </div>
              )}
              {tab === 'mensualidades' && tuition}
              {/* Sólo se monta al abrir la pestaña: se auto-consulta, y así no se pide de gusto. */}
              {tab === 'historial' && form.id && <StudentEnrollmentHistoryPanel studentId={form.id} />}
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end gap-2 border-t border-gray-100 px-5 py-3 sm:flex-row">
          <button type="button" className="btn-secondary text-sm" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary text-sm" disabled={saving} onClick={submit}>
            <PendingButtonContent pending={saving} pendingText="Guardando…" idle="Guardar" />
          </button>
        </div>
      </div>
    </div>
  )
}
