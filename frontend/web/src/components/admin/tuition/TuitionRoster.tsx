import { ArrowUpRight } from 'lucide-react'
import { formatTuitionAmount, formatTuitionDate, tuitionStatus, type TuitionStudent } from '@/lib/admin/tuition'
import TuitionStatusBadge from './TuitionStatusBadge'

export default function TuitionRoster({ students, year, month, onOpen }: {
  students: TuitionStudent[]
  year: number
  month: number
  onOpen: (student: TuitionStudent, register: boolean) => void
}) {
  return <>
    <div className="hidden overflow-x-auto md:block">
      <table className="w-full text-left text-sm">
        <thead className="border-y border-slate-100 bg-slate-50/80 text-xs text-slate-500">
          <tr>{['Estudiante', 'Curso', 'Estado del mes', 'Importe', 'Fecha de pago', ''].map((name, index) => <th key={index} scope="col" className="whitespace-nowrap px-5 py-3 font-medium">{name || <span className="sr-only">Acciones</span>}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {students.map((student) => {
            const row = student.tuitionMonths.find((item) => item.year === year && item.month === month)
            return <tr key={student.id} className="transition hover:bg-slate-50/60">
              <td className="px-5 py-4">
                <button type="button" onClick={() => onOpen(student, false)} className="text-left font-semibold text-slate-900 hover:text-emerald-700 hover:underline">{student.lastName}, {student.firstName}</button>
                <p className="mt-0.5 text-xs text-slate-400">{student.documentId || 'Sin documento'}</p>
              </td>
              <td className="px-5 py-4 text-slate-500">{student.course?.name || 'Sin curso'}</td>
              <td className="px-5 py-4"><TuitionStatusBadge status={tuitionStatus(row)} /></td>
              <td className={`whitespace-nowrap px-5 py-4 tabular-nums ${row?.amountCents == null ? 'text-xs text-slate-400' : 'font-medium text-slate-800'}`}>{formatTuitionAmount(row?.amountCents)}</td>
              <td className="whitespace-nowrap px-5 py-4 text-slate-500">{formatTuitionDate(row?.paidAt)}</td>
              <td className="px-5 py-4 text-right"><button type="button" onClick={() => onOpen(student, !row?.paid)} aria-label={`${row?.paid ? 'Ver detalle' : 'Registrar pago'} de ${student.firstName} ${student.lastName}`} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-semibold text-emerald-700 hover:bg-emerald-50">{row?.paid ? 'Ver detalle' : 'Registrar pago'}<ArrowUpRight className="h-4 w-4" aria-hidden /></button></td>
            </tr>
          })}
        </tbody>
      </table>
    </div>
    <ul className="divide-y divide-slate-100 border-t border-slate-100 md:hidden">
      {students.map((student) => {
        const row = student.tuitionMonths.find((item) => item.year === year && item.month === month)
        return <li key={student.id} className="space-y-3 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0"><button type="button" onClick={() => onOpen(student, false)} className="text-left font-semibold text-slate-900">{student.lastName}, {student.firstName}</button><p className="text-xs text-slate-500">{student.course?.name || 'Sin curso'} · {student.documentId || 'Sin documento'}</p></div>
            <TuitionStatusBadge status={tuitionStatus(row)} />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><p className="text-sm font-medium text-slate-700">{formatTuitionAmount(row?.amountCents)}</p>{row?.paidAt && <p className="text-xs text-slate-500">Pagado el {formatTuitionDate(row.paidAt)}</p>}</div>
            <button type="button" onClick={() => onOpen(student, !row?.paid)} aria-label={`${row?.paid ? 'Ver detalle' : 'Registrar pago'} de ${student.firstName} ${student.lastName}`} className="btn-secondary text-sm">{row?.paid ? 'Ver detalle' : 'Registrar pago'}<ArrowUpRight className="h-4 w-4" aria-hidden /></button>
          </div>
        </li>
      })}
    </ul>
  </>
}
