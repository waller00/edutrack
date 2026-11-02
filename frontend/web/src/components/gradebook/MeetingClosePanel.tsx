'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Lock } from 'lucide-react'
import { api } from '@/lib/api/client'
import { useOptionalAuth } from '@/contexts/AuthContext'
import { hasPermission } from '@/lib/auth/permissions'
import {
  ENDORSEMENT_SECTION_LABELS,
  formatEndorsementDate,
  REVIEW_SECTIONS,
  sectionState,
  type EndorsementHistoryEntry,
  type EndorsementRow,
} from '@/lib/gradebook/endorsements'
import { meetingStage, type MeetingStage } from '@/lib/gradebook/meeting-stage'
import MeetingStepper from './MeetingStepper'

type MeetingRow = {
  periodId: string
  name: string
  kind?: 'DIAGNOSTICO' | 'TRAMO' | 'ENTREGA'
  isMeeting?: boolean
  status: 'OPEN' | 'CLOSED' | 'REOPENED'
  closesOn?: string | null
  closedAt?: string | null
  closedLate?: boolean
}

type Blocker = {
  code: 'MISSING_GRADES' | 'MISSING_CONDUCT' | 'MISSING_JUDGEMENT' | 'MISSING_GROUP_REPORT'
  studentIds: string[]
}

/** La planilla de la reunión: lo que falta para cerrar ya viene calculado, con los alumnos. */
type Sheet = {
  period: { id: string; name: string; judgementLabel?: string | null }
  state: { status: 'OPEN' | 'CLOSED' | 'REOPENED'; closedAt: string | null; closedLate: boolean; reopenReason: string | null }
  blockers: Blocker[]
  students: Array<{ studentId: string; lastName: string; firstName: string }>
}

type ReviewRow = EndorsementRow & { reopenReason: string | null; history: EndorsementHistoryEntry[] }

type Message = { kind: 'ok' | 'error'; text: string } | null

const BLOCKER_LABELS: Record<Blocker['code'], string> = {
  MISSING_GRADES: 'sin R (rendimiento)',
  MISSING_CONDUCT: 'sin C (conducta)',
  MISSING_JUDGEMENT: 'sin informe o juicio',
  MISSING_GROUP_REPORT: 'falta el informe del grupo',
}

/** "3 sin R (rendimiento)"; el informe del grupo no es de alumnos, va sin número. */
function blockerText(blocker: Blocker): string {
  const label = BLOCKER_LABELS[blocker.code] ?? blocker.code
  return blocker.code === 'MISSING_GROUP_REPORT' ? label : `${blocker.studentIds.length} ${label}`
}

/** El 409 del cierre trae la lista completa de faltantes en `detail.blockers`. */
export function closeErrorText(err: unknown): string {
  const data = (err as { data?: { message?: string; detail?: { blockers?: Blocker[] } } })?.data
  const blockers = data?.detail?.blockers ?? []
  if (blockers.length > 0) {
    const list = blockers.map(blockerText).join(' · ')
    return `No se puede cerrar todavía: ${list}.`
  }
  return data?.message ?? (err instanceof Error ? err.message : 'No se pudo cerrar')
}

/** La reunión que se abre desplegada: la primera sin cerrar; si están todas cerradas, la última. */
export function openingMeeting<T extends Pick<MeetingRow, 'status'>>(meetings: readonly T[]): T | null {
  return meetings.find((meeting) => meeting.status !== 'CLOSED') ?? meetings.at(-1) ?? null
}

function dayMonth(ymd: string): string {
  const [, month, day] = ymd.slice(0, 10).split('-')
  return `${day}/${month}`
}

function blockerTitle(code: Blocker['code'], judgementLabel: string | null | undefined): string {
  if (code === 'MISSING_GRADES') return 'R (rendimiento)'
  if (code === 'MISSING_CONDUCT') return 'C (conducta)'
  if (code === 'MISSING_JUDGEMENT') return judgementLabel?.trim() || 'Juicio'
  return 'Informe del grupo'
}

const SHOWN_NAMES = 4

/** Los alumnos a los que les falta algo: cada nombre abre su carta. */
function StudentLinks({
  ids,
  students,
  onPick,
}: {
  ids: readonly string[]
  students: Sheet['students']
  onPick?: (studentId: string) => void
}) {
  const names = new Map(students.map((s) => [s.studentId, `${s.lastName}, ${s.firstName}`]))
  const rest = ids.length - SHOWN_NAMES
  return (
    <>
      {ids.slice(0, SHOWN_NAMES).map((id, index) => (
        <Fragment key={id}>
          {index > 0 && ' · '}
          {onPick ? (
            <button type="button" onClick={() => onPick(id)} className="font-medium text-emerald-700 hover:underline">
              {names.get(id) ?? 'Alumno'}
            </button>
          ) : (
            <span>{names.get(id) ?? 'Alumno'}</span>
          )}
        </Fragment>
      ))}
      {rest > 0 && <span> y {rest} más</span>}
    </>
  )
}

function Missing({
  sheet,
  onPickStudent,
  onOpenGroup,
}: {
  sheet: Sheet
  onPickStudent?: (studentId: string) => void
  onOpenGroup?: (periodId: string) => void
}) {
  return (
    <div className="space-y-1.5 rounded-lg border border-amber-200 bg-amber-50/60 p-3 text-sm text-amber-950">
      <p className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
        Falta para cerrar
      </p>
      <ul className="space-y-1 pl-5">
        {sheet.blockers.map((blocker) => (
          <li key={blocker.code} className="list-disc">
            <span className="font-medium">{blockerTitle(blocker.code, sheet.period.judgementLabel)}</span>
            {blocker.code === 'MISSING_GROUP_REPORT' ? (
              onOpenGroup ? (
                <>
                  {' · '}
                  <button
                    type="button"
                    onClick={() => onOpenGroup(sheet.period.id)}
                    className="font-medium text-emerald-700 hover:underline"
                  >
                    Ir al informe del grupo
                  </button>
                </>
              ) : null
            ) : (
              <>
                {': '}
                <StudentLinks ids={blocker.studentIds} students={sheet.students} onPick={onPickStudent} />
              </>
            )}
          </li>
        ))}
      </ul>
      {onOpenGroup && (
        <button
          type="button"
          onClick={() => onOpenGroup(sheet.period.id)}
          className="text-sm font-medium text-emerald-700 hover:underline"
        >
          Completarlo en la tabla de todo el grupo
        </button>
      )}
    </div>
  )
}

/** Lo que Dirección o Adscripción observaron en esta reunión y sigue sin corregir. */
function Observations({ review }: { review: ReviewRow | null }) {
  const live = review ? REVIEW_SECTIONS.map((s) => sectionState(review, s)).filter((s) => s.status === 'OBSERVED') : []
  if (live.length === 0) return null
  return (
    <ul className="space-y-2" aria-label="Observaciones">
      {live.map((item) => (
        <li
          key={item.section}
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0">
            <span className="font-medium">Observación sobre {ENDORSEMENT_SECTION_LABELS[item.section].toLowerCase()}</span>
            {item.occurredAt && <span className="text-xs text-amber-800"> · {formatEndorsementDate(item.occurredAt)}</span>}
            {item.observations && <span className="block whitespace-pre-wrap">{item.observations}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

type CloseResult = { closedLate?: boolean; coveredPeriodCodes?: string[] }

function withTramos(res: CloseResult | undefined): string {
  return res?.coveredPeriodCodes?.length ? ' y sus tramos' : ''
}

/**
 * Una reunión desplegada: su etapa, qué falta o el botón para cerrarla, y lo que le observaron.
 * Cada reunión tiene su propio estado (confirmar, reabrir, mensaje): al elegir otra, arranca limpio.
 */
function MeetingDetail({
  gradeBookId,
  meeting,
  sheet,
  review,
  stage,
  canClose,
  canReopen,
  onDone,
  onPickStudent,
  onOpenGroup,
}: {
  gradeBookId: string
  meeting: MeetingRow
  sheet: Sheet | null
  review: ReviewRow | null
  stage: MeetingStage
  canClose: boolean
  canReopen: boolean
  /** Se cerró o se reabrió: el panel y quien lo usa recargan. */
  onDone: () => void
  onPickStudent?: (studentId: string) => void
  onOpenGroup?: (periodId: string) => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [reopening, setReopening] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<Message>(null)
  const closed = meeting.status === 'CLOSED'

  async function run(request: () => Promise<CloseResult>, done: (res: CloseResult) => string, failed: (err: unknown) => string) {
    setBusy(true)
    setMessage(null)
    try {
      const res = await request()
      setMessage({ kind: 'ok', text: done(res) })
      setConfirming(false)
      setReopening(false)
      setReason('')
      onDone()
    } catch (err) {
      setMessage({ kind: 'error', text: failed(err) })
    } finally {
      setBusy(false)
    }
  }

  function close() {
    void run(
      () => api<CloseResult>(`/gradebook/${gradeBookId}/periods/${meeting.periodId}/close`, { method: 'POST' }),
      (res) => `Se cerró ${meeting.name}${withTramos(res)}${res?.closedLate ? ' (fuera de plazo)' : ''}. Ahora la revisa Dirección.`,
      closeErrorText,
    )
  }

  function reopen() {
    void run(
      () =>
        api<CloseResult>(`/gradebook/${gradeBookId}/periods/${meeting.periodId}/reopen`, {
          method: 'POST',
          body: JSON.stringify({ reason: reason.trim() }),
        }),
      (res) => `Se reabrió ${meeting.name}${withTramos(res)}. El docente recibió el aviso.`,
      (err) => (err instanceof Error ? err.message : 'No se pudo reabrir'),
    )
  }

  return (
    <div className="space-y-3 px-3 pb-3 pt-1">
      <MeetingStepper stage={stage.stage} hint={stage.hint} />
      {closed ? (
        <p className="flex items-center gap-1.5 text-xs text-slate-600">
          <Lock className="h-3.5 w-3.5" aria-hidden />
          Cerrada{meeting.closedAt ? ` el ${formatEndorsementDate(meeting.closedAt)}` : ''}
          {meeting.closedLate ? ' (fuera de plazo)' : ''}. Ya no se edita.
        </p>
      ) : (
        <OpenMeeting
          meeting={meeting}
          sheet={sheet}
          canClose={canClose}
          confirming={confirming}
          busy={busy}
          onAskClose={() => setConfirming(true)}
          onCancelClose={() => setConfirming(false)}
          onClose={close}
          onPickStudent={onPickStudent}
          onOpenGroup={onOpenGroup}
        />
      )}
      <Observations review={review} />
      {closed && canReopen && (
        <Reopen
          meeting={meeting}
          open={reopening}
          reason={reason}
          busy={busy}
          onOpen={() => setReopening(true)}
          onCancel={() => setReopening(false)}
          onReason={setReason}
          onSubmit={reopen}
        />
      )}
      {message && (
        <p
          role={message.kind === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.kind === 'error' ? 'text-red-800' : 'text-emerald-800'}`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}

/**
 * El cierre de cada reunión, en un solo lugar: en qué etapa está (Cargar → Cerrar → Revisión →
 * Visada), qué falta para cerrarla y de quién, el botón para cerrarla y, después, qué le observaron.
 *
 * Reemplaza a la franja de "Cerrar" de arriba del cierre (lo que faltaba recién aparecía al tocarla,
 * y como cantidades) y al bloque suelto de observaciones. Lo que falta sale de la planilla de la
 * reunión (`blockers`, la misma cuenta que hace el cierre); cada nombre abre la carta de ese alumno.
 *
 * Administración (`gradebook.manage`) reabre una reunión cerrada, con motivo. Quien sólo lee la
 * libreta (Dirección, Adscripción) ve lo mismo, sin botones.
 */
export default function MeetingClosePanel({
  gradeBookId,
  canClose,
  refreshKey = 0,
  onChanged,
  onPickStudent,
  onOpenGroup,
}: {
  gradeBookId: string
  canClose: boolean
  /** Cambia cuando se guardó algo en la tabla o en la carta: lo que falta se vuelve a contar. */
  refreshKey?: number
  /** Se cerró o se reabrió una reunión: quien la usa recarga lo que depende del estado. */
  onChanged?: () => void
  onPickStudent?: (studentId: string) => void
  onOpenGroup?: (periodId: string) => void
}) {
  const canReopen = hasPermission(useOptionalAuth()?.me, 'gradebook.manage', 'all')
  const [meetings, setMeetings] = useState<MeetingRow[] | null>(null)
  const [reviews, setReviews] = useState<ReviewRow[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<{ data: MeetingRow[] }>(`/gradebook/${gradeBookId}/periods`)
        .then((res) => (res?.data ?? []).filter((period) => period.isMeeting))
        .catch(() => [] as MeetingRow[]),
      api<{ data: ReviewRow[] }>(`/gradebook/${gradeBookId}/endorsements`)
        .then((res) => res?.data ?? [])
        // Sin el visado el cierre sigue sirviendo: sólo no se ven las observaciones.
        .catch(() => [] as ReviewRow[]),
    ]).then(([rows, reviewRows]) => {
      if (cancelled) return
      setMeetings(rows)
      setReviews(reviewRows)
      setSelectedId((current) =>
        current && rows.some((row) => row.periodId === current) ? current : (openingMeeting(rows)?.periodId ?? null),
      )
    })
    return () => {
      cancelled = true
    }
  }, [gradeBookId, refreshKey, version])

  useEffect(() => {
    if (!selectedId) return
    let cancelled = false
    api<Sheet>(`/gradebook/${gradeBookId}/periods/${selectedId}`)
      .then((res) => {
        if (!cancelled) setSheet(res ?? null)
      })
      .catch(() => {
        if (!cancelled) setSheet(null)
      })
    return () => {
      cancelled = true
    }
  }, [gradeBookId, selectedId, refreshKey, version])

  const onDone = useCallback(() => {
    setVersion((value) => value + 1)
    onChanged?.()
  }, [onChanged])

  if (!meetings || meetings.length === 0) return null
  const current = sheet && sheet.period.id === selectedId ? sheet : null

  return (
    <section aria-labelledby="cierre-reuniones" className="rounded-lg border border-slate-200 bg-white">
      <header className="px-3 pt-3">
        <h3 id="cierre-reuniones" className="text-sm font-semibold text-slate-900">
          Reuniones y cierre
        </h3>
        <p className="text-xs text-slate-500">
          Cada reunión se cierra cuando está todo cargado; después la revisa Dirección.
        </p>
      </header>
      <ul className="mt-2 divide-y divide-slate-100 border-t border-slate-100">
        {meetings.map((meeting) => {
          const review = reviews.find((row) => row.period.id === meeting.periodId) ?? null
          const isSelected = meeting.periodId === selectedId
          const stage = meetingStage(
            {
              periodStatus: meeting.status,
              missing: isSelected && current ? current.blockers.length : null,
              closedAt: meeting.closedAt ?? null,
              reopenReason: review?.reopenReason ?? null,
              endorsement: review,
            },
            'teacher',
          )
          return (
            <li key={meeting.periodId}>
              <button
                type="button"
                aria-expanded={isSelected}
                onClick={() => setSelectedId(meeting.periodId)}
                className={`flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-sm ${
                  isSelected ? 'bg-slate-50' : 'hover:bg-slate-50'
                }`}
              >
                <span className="font-medium text-slate-900">{meeting.name}</span>
                {meeting.closesOn && meeting.status !== 'CLOSED' && (
                  <span className="text-xs text-slate-500">cierra el {dayMonth(meeting.closesOn)}</span>
                )}
                <StageChip stage={stage} />
              </button>
              {isSelected && (
                <MeetingDetail
                  gradeBookId={gradeBookId}
                  meeting={meeting}
                  sheet={current}
                  review={review}
                  stage={stage}
                  canClose={canClose}
                  canReopen={canReopen}
                  onDone={onDone}
                  onPickStudent={onPickStudent}
                  onOpenGroup={onOpenGroup}
                />
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function StageChip({ stage }: { stage: MeetingStage }) {
  return (
    <span className={`ml-auto inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${stage.className}`}>
      <span aria-hidden>{stage.symbol}</span>
      {stage.label}
    </span>
  )
}

/** Una reunión sin cerrar: qué falta, o el botón para cerrarla. */
function OpenMeeting({
  meeting,
  sheet,
  canClose,
  confirming,
  busy,
  onAskClose,
  onCancelClose,
  onClose,
  onPickStudent,
  onOpenGroup,
}: {
  meeting: MeetingRow
  sheet: Sheet | null
  canClose: boolean
  confirming: boolean
  busy: boolean
  onAskClose: () => void
  onCancelClose: () => void
  onClose: () => void
  onPickStudent?: (studentId: string) => void
  onOpenGroup?: (periodId: string) => void
}) {
  if (!sheet) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Revisando qué falta…
      </p>
    )
  }
  if (sheet.blockers.length > 0) {
    return <Missing sheet={sheet} onPickStudent={onPickStudent} onOpenGroup={onOpenGroup} />
  }
  if (!canClose) return null
  if (!confirming) {
    return (
      <button
        type="button"
        onClick={onAskClose}
        className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"
      >
        <Lock className="h-4 w-4" aria-hidden />
        Cerrar {meeting.name}
      </button>
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-teal-200 bg-teal-50/60 p-3 text-sm">
      <p className="text-slate-800">
        {meeting.kind === 'ENTREGA' ? 'Se cierran también sus tramos. ' : ''}
        Después ya no se puede editar: si hay que corregir algo, administración la reabre.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3 py-1.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-50"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
          Sí, cerrar {meeting.name}
        </button>
        <button type="button" onClick={onCancelClose} disabled={busy} className="btn-secondary text-sm">
          Cancelar
        </button>
      </div>
    </div>
  )
}

/** Reabrir una reunión cerrada, con motivo: lo lee el docente en el aviso y en este panel. */
function Reopen({
  meeting,
  open,
  reason,
  busy,
  onOpen,
  onCancel,
  onReason,
  onSubmit,
}: {
  meeting: MeetingRow
  open: boolean
  reason: string
  busy: boolean
  onOpen: () => void
  onCancel: () => void
  onReason: (value: string) => void
  onSubmit: () => void
}) {
  if (!open) {
    return (
      <button type="button" onClick={onOpen} className="btn-secondary text-sm">
        Reabrir para que corrija
      </button>
    )
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        aria-label={`Motivo para reabrir ${meeting.name}`}
        placeholder="Motivo (lo ve el docente)"
        value={reason}
        maxLength={500}
        onChange={(e) => onReason(e.target.value)}
        className="input-field h-9 w-72 text-sm"
      />
      <button
        type="button"
        disabled={busy || reason.trim().length < 3}
        onClick={onSubmit}
        className="rounded-lg bg-slate-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
      >
        Reabrir
      </button>
      <button type="button" onClick={onCancel} className="text-sm text-slate-600 hover:underline">
        Cancelar
      </button>
    </div>
  )
}
