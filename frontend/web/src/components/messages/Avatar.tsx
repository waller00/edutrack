import { initialsOf } from '@/lib/messages/conversations'

/** Círculo con iniciales: los usuarios no tienen foto. Mismo verde que la cuenta del encabezado. */
export default function Avatar({ name, size = 'md' }: Readonly<{ name: string; size?: 'sm' | 'md' }>) {
  const dims = size === 'sm' ? 'h-8 w-8 text-xs' : 'h-10 w-10 text-sm'
  return (
    <span
      aria-hidden
      className={`${dims} inline-flex shrink-0 items-center justify-center rounded-full bg-emerald-100 font-semibold text-emerald-700`}
    >
      {initialsOf(name)}
    </span>
  )
}
