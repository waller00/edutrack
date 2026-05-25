type ChipProps = { label: string; tone: 'ok' | 'warn' | 'muted' | 'info' }

function Chip({ label, tone }: ChipProps) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-100 text-emerald-800'
      : tone === 'warn'
        ? 'bg-amber-100 text-amber-900'
        : tone === 'info'
          ? 'bg-sky-100 text-sky-900'
          : 'bg-gray-100 text-gray-600'
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{label}</span>
}

export function CatalogStatusChip({ active }: { active: boolean }) {
  return <Chip label={active ? 'Activo en catálogo' : 'Inactivo en catálogo'} tone={active ? 'ok' : 'muted'} />
}

export function OfferingStatusChip({ offered, hasOffering }: { offered: boolean; hasOffering: boolean }) {
  if (!hasOffering) return <Chip label="No ofertado en ciclo" tone="warn" />
  return <Chip label={offered ? 'Ofertado en ciclo' : 'Oferta inactiva en ciclo'} tone={offered ? 'ok' : 'warn'} />
}

export function FilterVisibilityChip({ visible }: { visible: boolean }) {
  return <Chip label={visible ? 'Visible en filtros' : 'Oculto en filtros'} tone={visible ? 'info' : 'muted'} />
}

export function SubjectStatusChip({ active, assignmentActive }: { active: boolean; assignmentActive?: boolean | null }) {
  const on = assignmentActive ?? active
  return <Chip label={on ? 'Activa' : 'Inactiva'} tone={on ? 'ok' : 'muted'} />
}
