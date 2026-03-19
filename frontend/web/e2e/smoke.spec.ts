import { expect, test } from '@playwright/test'

test('muestra la pantalla de login', async ({ page }) => {
  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'Iniciar Sesión' })).toBeVisible()
  await expect(page.getByPlaceholder('Ingresa tu email o usuario')).toBeVisible()
  await expect(page.getByPlaceholder('Ingresa tu contraseña')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible()
})

test('redirige al login cuando no hay sesion', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveURL(/\/login$/)
})

test('backend responde healthcheck', async ({ request }) => {
  const response = await request.get('http://127.0.0.1:4000/health')

  expect(response.ok()).toBeTruthy()
  expect(await response.json()).toEqual({ ok: true })
})
