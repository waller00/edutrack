import { describe, expect, it } from 'vitest'
import {
  cursorOf,
  groupByDay,
  initialsOf,
  lastConfirmed,
  mergeMessages,
  previewOf,
  splitSections,
  type ConversationListItem,
  type MessageItem,
} from './conversations'

const item = (id: string, overrides: Partial<ConversationListItem> = {}): ConversationListItem => ({
  id,
  starred: false,
  unread: 0,
  lastMessageAt: '2026-10-21T13:00:00.000Z',
  other: { id: `u-${id}`, name: 'Ana García', roleLabel: 'Docente' },
  lastMessage: { preview: 'Hola', mine: false, createdAt: '2026-10-21T13:00:00.000Z' },
  ...overrides,
})

const msg = (id: string, createdAt: string, extra: Partial<MessageItem> = {}): MessageItem => ({
  id,
  body: id,
  createdAt,
  mine: false,
  ...extra,
})

describe('lib/messages', () => {
  it('separa Destacados de Privado sin cambiar el orden', () => {
    const sections = splitSections([item('a'), item('b', { starred: true }), item('c')])
    expect(sections.starred.map((c) => c.id)).toEqual(['b'])
    expect(sections.private.map((c) => c.id)).toEqual(['a', 'c'])
  })

  it('la vista previa dice "Tú:" en lo propio y avisa si todavía no hay mensajes', () => {
    expect(previewOf(item('a'))).toBe('Hola')
    expect(previewOf(item('a', { lastMessage: { preview: 'Listo', mine: true, createdAt: '' } }))).toBe('Tú: Listo')
    expect(previewOf(item('a', { lastMessage: null }))).toBe('Sin mensajes todavía')
  })

  it('arma las iniciales del círculo', () => {
    expect(initialsOf('Leopoldo Giménez')).toBe('LG')
    expect(initialsOf('Ana María de los Santos')).toBe('AS')
    expect(initialsOf('Dirección')).toBe('DI')
    expect(initialsOf('   ')).toBe('?')
  })

  it('el cursor es "fecha|id" y el polling parte del último confirmado', () => {
    const list = [msg('m1', '2026-10-21T13:00:00.000Z'), msg('tmp', '2026-10-21T13:01:00.000Z', { pending: true })]
    expect(cursorOf(list[0])).toBe('2026-10-21T13:00:00.000Z|m1')
    expect(lastConfirmed(list)?.id).toBe('m1')
    expect(lastConfirmed([msg('t', 'x', { pending: true })])).toBeNull()
  })

  it('suma lo nuevo sin repetir y en orden cronológico', () => {
    const current = [msg('m2', '2026-10-21T13:02:00.000Z'), msg('m1', '2026-10-21T13:01:00.000Z')]
    const merged = mergeMessages(current, [msg('m3', '2026-10-21T13:03:00.000Z'), msg('m2', '2026-10-21T13:02:00.000Z', { body: 'editado' })])
    expect(merged.map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(merged[1].body).toBe('editado')
    const tie = mergeMessages([], [msg('b', '2026-10-21T13:00:00.000Z'), msg('a', '2026-10-21T13:00:00.000Z')])
    expect(tie.map((m) => m.id)).toEqual(['a', 'b'])
  })

  it('agrupa por día en hora de Uruguay', () => {
    const now = new Date('2026-10-21T15:00:00.000Z')
    const groups = groupByDay(
      [
        msg('a', '2026-10-20T12:00:00.000Z'),
        msg('b', '2026-10-21T12:00:00.000Z'),
        msg('c', '2026-10-21T14:00:00.000Z'),
      ],
      now,
    )
    expect(groups.map((g) => [g.label, g.items.map((m) => m.id)])).toEqual([
      ['Ayer', ['a']],
      ['Hoy', ['b', 'c']],
    ])
  })
})
