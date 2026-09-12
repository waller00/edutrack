import { CheckCircle2, CircleDashed, Clock3 } from 'lucide-react'
import { TUITION_STATUS_LABELS, type TuitionStatus } from '@/lib/admin/tuition'

export default function TuitionStatusBadge({ status }: { status: TuitionStatus }) {
  const Icon = status === 'paid' ? CheckCircle2 : status === 'pending' ? Clock3 : CircleDashed
  const color = status === 'paid' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : status === 'pending'
    ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-50 text-slate-500 ring-slate-200'
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${color}`}>
    <Icon className="h-3.5 w-3.5" aria-hidden />{TUITION_STATUS_LABELS[status]}
  </span>
}
