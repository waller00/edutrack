import { expect, test } from '@playwright/test'

test('muestra la pantalla de login (estado sin sesión Keycloak)', async ({ page }) => {
  await page.goto('/login?loggedOut=1')

  await expect(page.getByRole('heading', { name: 'Sesión cerrada' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ingresar' })).toBeVisible()
  await expect(page.getByRole('main').getByRole('link', { name: 'Registrarse' })).toBeVisible()
})

test('redirige al login cuando no hay sesion', async ({ page }) => {
  await page.goto('/')
  await page.waitForURL(/\/login/, { timeout: 15_000 })
})

test('backend responde healthcheck', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:4000/health')

  expect(response.ok()).toBeTruthy()
  expect(await response.json()).toEqual({ ok: true })
})
