'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Check, Loader2, X } from 'lucide-react'
import { api } from '@/lib/api/client'
import { MONTH_NAMES, TUITION_STATUS_LABELS, formatTuitionAmount, parseTuitionAmount, todayYmd, tuitionStatus, type TuitionMonth, type TuitionStatus, type TuitionStudent } from '@/lib/admin/tuition'
import TuitionStatusBadge from './TuitionStatusBadge'

type Draft = { status: TuitionStatus; amount: string; date: string; notes: string }
function draftFor(row?: TuitionMonth, registerPayment = false): Draft {
  return {
    status: registerPayment ? 'paid' : tuitionStatus(row),
    amount: row?.amountCents == null ? '' : String(row.amountCents / 100),
    date: row?.paidAt?.slice(0, 10) || todayYmd(), notes: row?.notes || '',
  }
}

export default function TuitionStudentPanel({ student, year, initialMonth, registerPayment, onSaved, onClose }: {
  student: TuitionStudent
  year: number
  initialMonth: number
  registerPayment: boolean
  onSaved: () => void
  onClose: () => void
}) {
  const [months, setMonths] = useState(student.tuitionMonths)
  const [month, setMonth] = useState(initialMonth)
  const initial = draftFor(months.find((row) => row.month === initialMonth && row.year === year), registerPayment)
  const [draft, setDraft] = useState(initial)
  const [baseline, setBaseline] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [discardAction, setDiscardAction] = useState<number | 'close' | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline)
  const row = months.find((item) => item.year === year && item.month === month)
  const paidCount = months.filter((item) => item.year === year && item.paid).length
  const pendingCount = months.filter((item) => item.year === year && !item.paid).length
  const requestCloseRef = useRef(() => {})
  requestCloseRef.current = () => {
    if (saving) return
    if (dirty) setDiscardAction('close')
    else onClose()
  }

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') requestCloseRef.current()
      if (event.key !== 'Tab') return
      const elements = panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href]')
      if (!elements?.length) return
      const first = elements[0], last = elements[elements.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = overflow
      window.removeEventListener('keydown', onKey)
      previous?.focus()
    }
  }, [])

  function selectMonth(next: number) {
    const nextDraft = draftFor(months.find((item) => item.year === year && item.month === next))
    setMonth(next); setDraft(nextDraft); setBaseline(nextDraft)
    setError(''); setNotice(''); setDiscardAction(null)
  }
  function patch(value: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...value })); setError(''); setNotice(''); setDiscardAction(null)
  }
  async function save() {
    setError(''); setNotice('')
    try {
      const amountCents = draft.status === 'none' ? null : parseTuitionAmount(draft.amount)
      if (draft.status === 'paid' && !draft.date) throw new Error('Indicá la fecha del pago.')
      setSaving(true)
      const result = await api<{ month: TuitionMonth | null }>(`/admin/tuition/${student.id}/${year}/${month}`, {
        method: 'PUT', body: JSON.stringify({
          status: draft.status, amountCents,
          paidAt: draft.status === 'paid' ? draft.date : null,
          notes: draft.status === 'none' ? null : draft.notes.trim() || null,
        }),
      })
      setMonths((current) => [...current.filter((item) => !(item.year === year && item.month === month)), ...(result.month ? [result.month] : [])])
      const saved = draftFor(result.month ?? undefined)
      setDraft(saved); setBaseline(saved); setDiscardAction(null)
      setNotice(`${MONTH_NAMES[month - 1]} guardado correctamente.`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo guardar la mensualidad.')
    } finally { setSaving(false) }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/40 backdrop-blur-sm">
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="tuition-panel-title" className="flex h-[100dvh] w-full max-w-2xl flex-col bg-white shadow-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-emerald-700">Cuenta del estudiante · {year}</p>
            <h2 id="tuition-panel-title" className="text-xl font-bold text-slate-950">{student.lastName}, {student.firstName}</h2>
            <p className="mt-1 text-sm text-slate-500">{student.course?.name || 'Sin curso en este año'}{student.documentId ? ` · ${student.documentId}` : ''}</p>
          </div>
          <button ref={closeRef} type="button" disabled={saving} onClick={() => requestCloseRef.current()} aria-label="Cerrar cuenta del estudiante" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 disabled:opacity-50"><X className="h-5 w-5" aria-hidden /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
          <section aria-label={`Resumen anual ${year}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays className="h-4 w-4 text-slate-400" aria-hidden />Vista anual</h3>
              <p className="text-xs text-slate-500">{paidCount} pagados · {pendingCount} pendientes · {12 - paidCount - pendingCount} sin registrar</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {MONTH_NAMES.map((name, index) => {
                const item = months.find((entry) => entry.year === year && entry.month === index + 1)
                const status = tuitionStatus(item)
                const selected = month === index + 1
                return <button type="button" key={name} disabled={saving} aria-pressed={selected} aria-label={`${name}: ${TUITION_STATUS_LABELS[status]}`} onClick={() => {
                  if (selected) return
                  if (dirty) setDiscardAction(index + 1)
                  else selectMonth(index + 1)
                }} className={`rounded-xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${selected ? 'border-emerald-600 bg-emerald-50 ring-1 ring-emerald-600' : 'border-slate-200 hover:border-slate-400'}`}>
                  <span className="block text-sm font-semibold text-slate-800">{name}</span>
                  <span className={`mt-1 flex items-center gap-1 text-xs ${status === 'paid' ? 'text-emerald-700' : status === 'pending' ? 'text-amber-700' : 'text-slate-400'}`}>
                    {status === 'paid' && <Check className="h-3 w-3" aria-hidden />}{TUITION_STATUS_LABELS[status]}
                  </span>
                </button>
              })}
            </div>
          </section>

          {discardAction !== null && <div role="alert" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p>Tenés cambios sin guardar en {MONTH_NAMES[month - 1]}. Podés guardarlos o descartarlos para continuar.</p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button type="button" onClick={() => setDiscardAction(null)} className="font-semibold underline">Seguir editando</button>
              <button type="button" onClick={() => discardAction === 'close' ? onClose() : selectMonth(discardAction)} className="font-semibold underline">Descartar cambios</button>
            </div>
          </div>}

          <form id="tuition-payment-form" className="mt-7 space-y-5" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-6">
              <div><h3 className="text-lg font-bold text-slate-900">{MONTH_NAMES[month - 1]} {year}</h3><p className="text-xs text-slate-500">{row ? `Importe registrado: ${formatTuitionAmount(row.amountCents)}` : 'Este mes todavía no tiene una cuota registrada.'}</p></div>
              <TuitionStatusBadge status={tuitionStatus(row)} />
            </div>
            <fieldset disabled={saving} className="space-y-5">
              <div>
                <p id="tuition-status-label" className="mb-2 text-sm font-medium text-slate-700">Estado de la mensualidad</p>
                <div role="radiogroup" aria-labelledby="tuition-status-label" className="grid grid-cols-3 gap-2">
                  {(['paid', 'pending', 'none'] as const).map((status) => <label key={status} className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-1.5 py-3 text-xs font-medium sm:text-sm ${draft.status === status ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 text-slate-600'}`}>
                    <input type="radio" name="payment-status" value={status} checked={draft.status === status} onChange={() => patch({ status })} className="h-3.5 w-3.5 accent-emerald-600" />{TUITION_STATUS_LABELS[status]}
                  </label>)}
                </div>
              </div>
              {draft.status === 'none' ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{row ? 'Al guardar se quitarán el estado, el importe, la fecha y las notas de este mes.' : 'Sin registrar significa que no se cargó una cuota. No se cuenta como deuda pendiente.'}</p> : <>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium text-slate-700">Importe (UYU)
                    <input type="text" inputMode="decimal" className="input-field mt-1.5 w-full" placeholder="Ej. 3500,00" value={draft.amount} onChange={(event) => patch({ amount: event.target.value })} />
                    <span className="mt-1 block text-xs font-normal text-slate-500">Opcional. Dejalo vacío si no tenés el importe.</span>
                  </label>
                  {draft.status === 'paid' && <label className="block text-sm font-medium text-slate-700">Fecha de pago
                    <input type="date" required className="input-field mt-1.5 w-full" value={draft.date} onChange={(event) => patch({ date: event.target.value })} />
                  </label>}
                </div>
                <label className="block text-sm font-medium text-slate-700">Notas <span className="font-normal text-slate-400">(opcional)</span>
                  <textarea rows={3} maxLength={2000} className="input-field mt-1.5 w-full" placeholder="Referencia del pago o una aclaración…" value={draft.notes} onChange={(event) => patch({ notes: event.target.value })} />
                </label>
              </>}
            </fieldset>
            {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"><Check className="h-4 w-4" aria-hidden />{notice}</p>}
          </form>
        </div>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-7">
          <button type="button" disabled={saving} onClick={() => requestCloseRef.current()} className="btn-secondary text-sm">Cerrar</button>
          <button type="submit" form="tuition-payment-form" disabled={saving || (!row && draft.status === 'none')} className="btn-primary text-sm disabled:cursor-not-allowed disabled:opacity-50">
            {saving ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden />Guardando…</> : draft.status === 'paid' && !row?.paid ? 'Registrar pago' : 'Guardar cambios'}
          </button>
        </footer>
      </div>
    </div>, document.body,
  )
}
