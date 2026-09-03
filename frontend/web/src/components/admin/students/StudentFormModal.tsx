'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import DateField from '@/components/forms/DateField'
import { PendingButtonContent } from '@/components/common/PendingButtonContent'
import { getAdminFlashMessageClass } from '@/lib/admin/ui-helpers'
import { isValidUruguayanCI } from '@/lib/forms/uruguay-forms'
import StudentMoodleBadge from './StudentMoodleBadge'
import StudentTuitionSection from './StudentTuitionSection'
import StudentEnrollmentHistoryPanel from './StudentEnrollmentHistoryPanel'
import type { CourseOpt, OrientationOpt, StudentFormState, StudentTuitionMonth } from './student-types'
import { STUDENT_STATUS_OPTIONS, ymd } from './student-types'

type Props = {
  mode: 'create' | 'edit'
  form: StudentFormState
  courses: CourseOpt[]
  orientations: OrientationOpt[]
  tuitionYear: number
  saving: boolean
  resending: boolean
  message: string
  onTuitionYearChange: (year: number) => void
  onPatch: <K extends keyof StudentFormState>(key: K, value: StudentFormState[K]) => void
  onUsernameEdit: (value: string | null) => void
  onResendMoodle: () => void
  onSave: () => void
  onClose: () => void
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string
  htmlFor: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
      {!error && hint ? <p className="mt-1 text-[11px] text-gray-500">{hint}</p> : null}
    </div>
  )
}

export default function StudentFormModal({
  mode,
  form,
  courses,
  orientations,
  tuitionYear,
  saving,
  resending,
  message,
  onTuitionYearChange,
  onPatch,
  onUsernameEdit,
  onResendMoodle,
  onSave,
  onClose,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const firstFieldRef = useRef<HTMLInputElement>(null)

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

  const documentId = form.documentId?.trim() ?? ''
  const documentIdInvalid = documentId !== '' && !isValidUruguayanCI(documentId)
  const canSave =
    !saving &&
    Boolean(form.firstName.trim()) &&
    Boolean(form.lastName.trim()) &&
    Boolean(documentId) &&
    !documentIdInvalid &&
    Boolean(form.email?.trim()) &&
    Boolean(form.username?.trim())

  return (
    <div className="responsive-modal" role="dialog" aria-modal="true" aria-labelledby="student-modal-title">
      <div ref={panelRef} className="responsive-modal-panel max-w-2xl p-0">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h2 id="student-modal-title" className="text-lg font-semibold text-gray-900">
            {mode === 'create' ? 'Nuevo estudiante' : 'Editar estudiante'}
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

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-4 py-4 text-sm">
          {message ? (
            <p className={`rounded-lg px-3 py-2 text-sm ${getAdminFlashMessageClass(message)}`}>{message}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nombre *" htmlFor="st-first">
              <input
                ref={firstFieldRef}
                id="st-first"
                className="input-field w-full"
                value={form.firstName}
                onChange={(e) => onPatch('firstName', e.target.value)}
              />
            </Field>
            <Field label="Apellido *" htmlFor="st-last">
              <input
                id="st-last"
                className="input-field w-full"
                value={form.lastName}
                onChange={(e) => onPatch('lastName', e.target.value)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Cédula *"
              htmlFor="st-doc"
              error={documentIdInvalid ? 'Cédula inválida: verificá el número y el dígito verificador' : undefined}
            >
              <input
                id="st-doc"
                className={`input-field w-full ${documentIdInvalid ? 'border-red-400' : ''}`}
                value={form.documentId ?? ''}
                onChange={(e) => onPatch('documentId', e.target.value || null)}
                inputMode="numeric"
                placeholder="1.234.567-8"
                aria-invalid={documentIdInvalid}
              />
            </Field>
            <Field label="Estado matrícula" htmlFor="st-status">
              <select
                id="st-status"
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
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Curso" htmlFor="st-course">
              <select
                id="st-course"
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
            </Field>
            <Field
              label="Orientación"
              htmlFor="st-orientation"
              hint={
                form.courseId && orientations.length === 0 ? 'Este curso no tiene orientaciones configuradas.' : undefined
              }
            >
              <select
                id="st-orientation"
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
            </Field>
          </div>

          {form.enrollmentStatus !== 'ACTIVE' ? (
            <div className="grid gap-3 rounded-lg bg-amber-50/60 p-3 sm:grid-cols-2">
              <Field label="Fecha de baja" htmlFor="st-withdrawn">
                <DateField
                  className="input-field w-full"
                  value={ymd(form.withdrawnAt)}
                  onChange={(v) => onPatch('withdrawnAt', v ? `${v}T12:00:00.000Z` : null)}
                />
              </Field>
              <Field label="Año lectivo de la baja" htmlFor="st-withdrawn-year">
                <input
                  id="st-withdrawn-year"
                  type="number"
                  className="input-field w-full"
                  value={form.withdrawalAcademicYear ?? ''}
                  onChange={(e) =>
                    onPatch('withdrawalAcademicYear', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </Field>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email *" htmlFor="st-email" hint="Con el email se crea su cuenta del aula virtual (Moodle).">
              <input
                id="st-email"
                type="email"
                required
                className="input-field w-full"
                value={form.email ?? ''}
                onChange={(e) => onPatch('email', e.target.value || null)}
              />
            </Field>
            <Field label="Usuario (Moodle) *" htmlFor="st-username">
              <input
                id="st-username"
                required
                className="input-field w-full"
                value={form.username ?? ''}
                onChange={(e) => onUsernameEdit(e.target.value || null)}
                placeholder="nombre.apellido"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Teléfono contacto" htmlFor="st-phone">
              <input
                id="st-phone"
                className="input-field w-full"
                value={form.contactPhone ?? ''}
                onChange={(e) => onPatch('contactPhone', e.target.value || null)}
              />
            </Field>
            <Field label="Teléfono del tutor" htmlFor="st-tutor">
              <input
                id="st-tutor"
                className="input-field w-full"
                value={form.tutorPhone ?? ''}
                onChange={(e) => onPatch('tutorPhone', e.target.value || null)}
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dirección" htmlFor="st-address">
              <input
                id="st-address"
                className="input-field w-full"
                value={form.address ?? ''}
                onChange={(e) => onPatch('address', e.target.value || null)}
              />
            </Field>
            <Field label="Vencimiento del carné de salud" htmlFor="st-health">
              <DateField
                className="input-field w-full"
                value={ymd(form.healthCardExpiresAt)}
                onChange={(v) => onPatch('healthCardExpiresAt', v ? `${v}T12:00:00.000Z` : null)}
              />
            </Field>
          </div>

          <Field label="Acceso al portal del liceo" htmlFor="st-liceo">
            <textarea
              id="st-liceo"
              rows={2}
              className="input-field w-full"
              value={form.liceoAccessNotes ?? ''}
              onChange={(e) => onPatch('liceoAccessNotes', e.target.value || null)}
            />
          </Field>

          <Field label="Notas internas" htmlFor="st-notes" hint="Visible solo para administración.">
            <textarea
              id="st-notes"
              rows={3}
              className="input-field w-full"
              value={form.internalNotes ?? ''}
              onChange={(e) => onPatch('internalNotes', e.target.value || null)}
            />
          </Field>

          {mode === 'edit' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200 bg-slate-50 p-3">
              <div>
                <p className="text-xs font-medium uppercase text-gray-500">Estado en Moodle</p>
                <StudentMoodleBadge
                  moodle={form.moodle}
                  studentName={`${form.firstName} ${form.lastName}`}
                  resending={resending}
                  onResend={onResendMoodle}
                />
              </div>
            </div>
          ) : null}

          <StudentTuitionSection
            months={form.tuitionMonths}
            year={tuitionYear}
            onYearChange={onTuitionYearChange}
            onChange={(months: StudentTuitionMonth[]) => onPatch('tuitionMonths', months)}
          />

          {mode === 'edit' && form.id ? <StudentEnrollmentHistoryPanel studentId={form.id} /> : null}
        </div>

        <div className="flex flex-col justify-end gap-2 border-t border-gray-100 px-4 py-3 sm:flex-row">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn-primary" disabled={!canSave} onClick={onSave}>
            <PendingButtonContent pending={saving} pendingText="Guardando…" idle="Guardar" />
          </button>
        </div>
      </div>
    </div>
  )
}
