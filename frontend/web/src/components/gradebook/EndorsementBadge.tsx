import {
  ENDORSEMENT_STATUS_LABELS,
  ENDORSEMENT_STATUS_STYLES,
  type EndorsementStatus,
} from '@/lib/gradebook/endorsements'

/** Estado de visado con símbolo y texto, además del color (RNF 7.2). */
export default function EndorsementBadge({ status, title }: { status: EndorsementStatus; title?: string }) {
  const style = ENDORSEMENT_STATUS_STYLES[status] ?? ENDORSEMENT_STATUS_STYLES.PENDING
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${style.className}`} title={title}>
      <span aria-hidden>{style.symbol}</span>
      {ENDORSEMENT_STATUS_LABELS[status] ?? status}
    </span>
  )
}
