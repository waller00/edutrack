import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AuthMe } from '@/contexts/AuthContext'
import { BUILTIN_PROFILE_ROLES, DEFAULT_PROFILE_PERMISSIONS } from '../../../../../backend/src/identity/profile-permissions-defaults'
import { APP_MODULES } from './modules'
import { onboardingSteps } from './onboarding'
import { RELATED_SPOT, SCREEN_SPOTS } from './onboarding-spots'

const SRC = resolve(__dirname, '../..')

/** El código de las pantallas, sin los tests (que inventan anclas para probar). */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.tsx$/.test(entry.name) && !/\.test\.tsx$/.test(entry.name) ? [readFileSync(path, 'utf8')] : []
  })
}

const code = sources(SRC).join('\n')
/** `data-tour="x"` en el JSX y `tour="x"` en `ScrollRegion`. */
const anchors = new Set([...code.matchAll(/\b(?:data-)?tour="([^"]+)"/g)].map((match) => match[1]))

function profile(role: (typeof BUILTIN_PROFILE_ROLES)[number]): AuthMe {
  return { id: role, role, permissions: DEFAULT_PROFILE_PERMISSIONS[role].filter((p) => p.enabled) }
}

describe('anclas del onboarding', () => {
  it('cada globo apunta a un control que existe en el código', () => {
    const targets = [...Object.values(SCREEN_SPOTS).flat().map((spot) => spot!.target), RELATED_SPOT.target]
    const missing = targets.filter((target) => !anchors.has(target))
    expect(missing).toEqual([])
  })

  it('el menú marca cada sección con su id, y los globos del menú apuntan a secciones que existen', () => {
    expect(code).toContain('data-tour={`nav:${item.id}`}')
    const ids = new Set(APP_MODULES.map((entry) => entry.id))
    for (const role of BUILTIN_PROFILE_ROLES) {
      for (const step of onboardingSteps(profile(role))) {
        for (const spot of step.spots.filter((s) => s.target.startsWith('nav:'))) {
          expect(ids.has(spot.target.slice(4) as never), spot.target).toBe(true)
        }
      }
    }
  })

  it.each(BUILTIN_PROFILE_ROLES)('cada paso de %s señala al menos dos controles de su pantalla', (role) => {
    for (const step of onboardingSteps(profile(role))) {
      const own = step.spots.filter((spot) => !spot.target.startsWith('nav:') && spot.target !== RELATED_SPOT.target)
      expect(own.length, step.module.id).toBeGreaterThanOrEqual(2)
    }
  })
})
