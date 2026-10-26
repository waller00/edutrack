import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

/**
 * Tema `edutrack` de la pantalla de ingreso de Keycloak (`keycloak/themes/edutrack/login`).
 *
 * Cloudflare guarda 30 días los recursos del tema por URL. Si el CSS o el JS cambian y el `?v=` de
 * `theme.properties` no, los usuarios siguen recibiendo el archivo viejo: pasó con "Olvidé mi
 * contraseña", que siguió llevando a la recuperación de Keycloak (sin correo) en vez de a la de
 * EduTrack. Por eso el `?v=` es el hash del contenido y este test lo exige.
 */

// Con jsdom, `import.meta.url` no es una ruta de archivo: se parte de la carpeta del test.
const THEME = path.resolve(__dirname, '../../../../../keycloak/themes/edutrack/login')

/** Como queda en el servidor (Linux): sin los CRLF que agrega git en Windows. */
function read(relative: string): string {
  return readFileSync(path.join(THEME, relative), 'utf8').replace(/\r\n/g, '\n')
}

const css = read('resources/css/edutrack.css')
const script = read('resources/js/edutrack-login.js')
const expectedVersion = createHash('sha256').update(css).update(script).digest('hex').slice(0, 10)

describe('versión de los recursos del tema', () => {
  it('el ?v= del CSS y del JS es el hash de su contenido', () => {
    const properties = read('theme.properties')
    const hint = `Cambiaron edutrack.css o edutrack-login.js: poné ?v=${expectedVersion} en theme.properties`
    expect(properties, hint).toContain(`css/edutrack.css?v=${expectedVersion}`)
    expect(properties, hint).toContain(`js/edutrack-login.js?v=${expectedVersion}`)
  })
})

const FRONT = 'https://edutrack-uy.com'
const AUTH_QUERY = `?client_id=edutrack-web&frontend_origin=${encodeURIComponent(FRONT)}`

const LOGIN_FORM = `
  <form id="kc-form-login" action="#" method="post">
    <div class="pf-v5-c-form__group">
      <label for="username"><span class="pf-v5-c-form__label-text">Username or email</span></label>
      <input id="username" name="username" value="">
    </div>
    <div class="pf-v5-c-form__group">
      <label for="password"><span class="pf-v5-c-form__label-text">Password</span></label>
      <input id="password" name="password" type="password">
    </div>
    <a href="/realms/edutrack/login-actions/reset-credentials?client_id=edutrack-web">Forgot Password?</a>
    <input id="kc-login" type="submit" value="Sign In">
  </form>`

const LOGIN_PAGE = `
  <h1 id="kc-page-title">Sign in to your account</h1>
  <div class="pf-v5-c-login__main-body">${LOGIN_FORM}</div>
  <div class="pf-v5-c-login__main-footer">
    <div class="pf-v5-c-login__main-footer-band"><div class="pf-v5-c-login__main-footer-band-item">Or sign in with</div></div>
    <div id="kc-social-providers"><a id="social-google" href="/realms/edutrack/broker/google/login">Google</a></div>
  </div>`

/** "La cuenta ya existe": el primer ingreso con Google de alguien que ya tiene cuenta. */
const CONFIRM_LINK_PAGE = `
  <h1 id="kc-page-title">Account already exists</h1>
  <div class="pf-v5-c-login__main-body">
    <form id="kc-register-form" action="#" method="post">
      <button type="submit" id="updateProfile" name="submitAction" value="updateProfile">Review profile</button>
      <button type="submit" id="linkAccount" name="submitAction" value="linkAccount">Add to existing account</button>
    </form>
  </div>
  <div class="pf-v5-c-login__main-footer"></div>`

/** Carga el JS del tema sobre una página y corre lo que hace al terminar de cargar. */
function runTheme(html: string, url: string, typedUsername = '') {
  globalThis.history.replaceState({}, '', url)
  document.body.innerHTML = html
  const username = document.querySelector<HTMLInputElement>('#username')
  if (username) username.value = typedUsername

  const onLoad: EventListener[] = []
  const original = document.addEventListener.bind(document)
  document.addEventListener = ((type: string, listener: EventListener) => {
    if (type === 'DOMContentLoaded') onLoad.push(listener)
    else original(type, listener)
  }) as typeof document.addEventListener
  try {
    new Function(script)()
  } finally {
    document.addEventListener = original
  }
  for (const listener of onLoad) listener(new Event('DOMContentLoaded'))
}

const forgotLink = () => document.querySelector<HTMLAnchorElement>('a[href*="forgot"], a[href*="reset-credentials"]')

afterEach(() => {
  document.body.innerHTML = ''
})

describe('pantalla de ingreso', () => {
  it('"Olvidé mi contraseña" lleva a la recuperación de EduTrack, con el correo que ya se escribió', () => {
    runTheme(LOGIN_PAGE, `/realms/edutrack/protocol/openid-connect/auth${AUTH_QUERY}`, 'ana@example.com')

    const link = forgotLink()
    expect(link?.textContent).toBe('Olvidé mi contraseña')
    expect(link?.href).toBe(`${FRONT}/forgot?email=ana%40example.com`)
  })

  it('sin correo escrito, va a la recuperación sin parámetros', () => {
    runTheme(LOGIN_PAGE, `/realms/edutrack/protocol/openid-connect/auth${AUTH_QUERY}`)

    expect(forgotLink()?.href).toBe(`${FRONT}/forgot`)
  })

  it('le dice a quien se registró con Google cómo entrar y cómo crear una contraseña', () => {
    runTheme(LOGIN_PAGE, `/realms/edutrack/protocol/openid-connect/auth${AUTH_QUERY}`)

    const hint = document.querySelector('.et-login-hint')
    expect(hint?.textContent).toContain('¿Te registraste con Google?')
    expect(hint?.textContent).toContain('«Olvidé mi contraseña»')
    expect(document.querySelector('.et-register-link a')?.getAttribute('href')).toBe(`${FRONT}/register`)
  })
})

describe('primer ingreso con Google de quien ya tiene cuenta', () => {
  // Como en producción: las pantallas `login-actions` no traen `frontend_origin`, sino `client_data`
  // con la URL de vuelta (el callback de la API), de donde el tema saca el origen del front.
  const clientData = Buffer.from(JSON.stringify({ ru: 'https://api.edutrack-uy.com/auth/callback', rt: 'code' })).toString('base64url')
  const BROKER_URL = `/realms/edutrack/login-actions/first-broker-login?client_id=edutrack-web&tab_id=t1&client_data=${clientData}`

  it('sólo deja vincular Google a la cuenta: "Revisar perfil" creaba una segunda cuenta', () => {
    runTheme(CONFIRM_LINK_PAGE, BROKER_URL)

    const review = document.querySelector<HTMLButtonElement>('#updateProfile')
    expect(review?.style.display).toBe('none')
    expect(review?.disabled).toBe(true)
    const link = document.querySelector<HTMLButtonElement>('#linkAccount')
    expect(link?.style.display).toBe('')
    expect(link?.disabled).toBe(false)
  })

  it('ni "Crear usuario" ni el aviso de Google: ya tiene cuenta', () => {
    runTheme(CONFIRM_LINK_PAGE, BROKER_URL)

    expect(document.querySelector('.et-register-link')).toBeNull()
    expect(document.querySelector('.et-login-hint')).toBeNull()
  })

  it('al pedir la contraseña para vincular, "Olvidé mi contraseña" también va a EduTrack', () => {
    runTheme(`<div class="pf-v5-c-login__main-body">${LOGIN_FORM}</div><div class="pf-v5-c-login__main-footer"></div>`, BROKER_URL)

    expect(forgotLink()?.href).toBe(`${FRONT}/forgot`)
    expect(document.querySelector('.et-login-hint')).toBeNull()
    expect(document.querySelector('.et-register-link')).toBeNull()
  })
})
