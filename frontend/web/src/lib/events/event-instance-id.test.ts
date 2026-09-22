import { describe, expect, it } from 'vitest'
import { isExpandedInstanceId, resolveRealEventId } from './event-instance-id'

const UUID = '11111111-1111-4111-8111-111111111111'

describe('resolveRealEventId', () => {
  it('un evento único devuelve su propio id', () => {
    expect(resolveRealEventId({ id: UUID })).toBe(UUID)
  })

  it('una ocurrencia de serie devuelve el uuid de la serie', () => {
    expect(resolveRealEventId({ id: `${UUID}_2026-05-11`, originalEventId: UUID })).toBe(UUID)
  })

  it('cae al corte del sufijo si la respuesta no trae originalEventId', () => {
    expect(resolveRealEventId({ id: `${UUID}_2026-05-11` })).toBe(UUID)
  })

  it('originalEventId nulo no rompe el corte', () => {
    expect(resolveRealEventId({ id: `${UUID}_2026-05-11`, originalEventId: null })).toBe(UUID)
  })

  it('nunca devuelve el id compuesto, que la API rechazaría como uuid inválido', () => {
    const resolved = resolveRealEventId({ id: `${UUID}_2026-05-11`, originalEventId: UUID })
    expect(resolved).not.toContain('_')
  })

  it('no recorta un id que solo contiene guiones bajos sin fecha', () => {
    expect(resolveRealEventId({ id: 'evento_raro' })).toBe('evento_raro')
  })
})

describe('isExpandedInstanceId', () => {
  it('reconoce el sufijo de día civil', () => {
    expect(isExpandedInstanceId(`${UUID}_2026-05-11`)).toBe(true)
  })

  it('un uuid pelado no es una instancia', () => {
    expect(isExpandedInstanceId(UUID)).toBe(false)
  })

  it('un sufijo con formato de fecha incompleto no cuenta', () => {
    expect(isExpandedInstanceId(`${UUID}_2026-05`)).toBe(false)
  })
})
