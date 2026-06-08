(function () {
  function decodeBase64Url(value) {
    try {
      var normalized = value.replace(/-/g, '+').replace(/_/g, '/')
      while (normalized.length % 4) normalized += '='
      return atob(normalized)
    } catch (_error) {
      return ''
    }
  }

  function authReturnUrl() {
    var params = new URLSearchParams(window.location.search)
    var direct = params.get('redirect_uri')
    if (direct) return direct

    var clientData = params.get('client_data')
    if (!clientData) return ''

    try {
      var parsed = JSON.parse(decodeBase64Url(clientData))
      return parsed.ru || ''
    } catch (_error) {
      return ''
    }
  }

  function frontendOrigin() {
    var params = new URLSearchParams(window.location.search)
    var explicit = params.get('frontend_origin')
    if (explicit) {
      try {
        var explicitUrl = new URL(explicit)
        if (explicitUrl.protocol === 'http:' || explicitUrl.protocol === 'https:') {
          return explicitUrl.origin
        }
      } catch (_error) {
        /* cae al redirect_uri */
      }
    }

    var raw = authReturnUrl()
    try {
      var url = new URL(raw)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
        return url.protocol + '//' + url.hostname + ':3000'
      }
      if (url.port === '4000') {
        return url.protocol + '//' + url.hostname + ':3000'
      }
      return url.protocol + '//' + url.host
    } catch (_error) {
      return 'http://localhost:3000'
    }
  }

  function apiOrigin() {
    var raw = authReturnUrl()
    try {
      return new URL(raw).origin
    } catch (_error) {
      return 'http://localhost:4000'
    }
  }

  function themeResourceUrl(relativePath) {
    var script = document.currentScript || document.querySelector('script[src*="edutrack-login.js"]')
    if (!script || !script.src) return relativePath
    try {
      return new URL(relativePath, script.src).href
    } catch (_error) {
      return relativePath
    }
  }

  function installEduTrackFavicon() {
    var href = themeResourceUrl('../img/logo.svg')
    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function (link) {
      link.parentElement && link.parentElement.removeChild(link)
    })

    var icon = document.createElement('link')
    icon.rel = 'icon'
    icon.type = 'image/svg+xml'
    icon.href = href
    document.head.appendChild(icon)

    var shortcut = document.createElement('link')
    shortcut.rel = 'shortcut icon'
    shortcut.type = 'image/svg+xml'
    shortcut.href = href
    document.head.appendChild(shortcut)
  }

  function replaceText(selector, text) {
    var element = document.querySelector(selector)
    if (element) element.textContent = text
  }

  function isRequiredActionScreen() {
    return window.location.href.indexOf('/login-actions/required-action') >= 0 ||
      window.location.href.indexOf('CONFIGURE_TOTP') >= 0 ||
      window.location.href.indexOf('UPDATE_PASSWORD') >= 0
  }

  function screenFlags() {
    var isTotp = window.location.href.indexOf('CONFIGURE_TOTP') >= 0 || document.querySelector('#kc-totp-settings')
    var isOtpChallenge = window.location.href.indexOf('LOGIN_OTP') >= 0 ||
      document.querySelector('#otp') ||
      document.querySelector('#kc-otp-login-form')
    var isRecoveryCodeChallenge = !!document.querySelector('#kc-recovery-code-login-form') ||
      !!document.querySelector('#recoveryCodeInput')
    var isAuthenticatorSelection = !!document.querySelector('input[name="authenticationExecution"]')
    var isPasswordUpdate = window.location.href.indexOf('UPDATE_PASSWORD') >= 0 || document.querySelector('#password-new')
    var isAction = isRequiredActionScreen() || isTotp || isPasswordUpdate || isOtpChallenge || isRecoveryCodeChallenge || isAuthenticatorSelection
    return {
      isAction: isAction,
      isTotp: isTotp,
      isOtpChallenge: isOtpChallenge,
      isRecoveryCodeChallenge: isRecoveryCodeChallenge,
      isAuthenticatorSelection: isAuthenticatorSelection,
      isPasswordUpdate: isPasswordUpdate,
      isLogin: !isAction && !!document.querySelector('#kc-form-login'),
    }
  }

  function applyScreenClasses() {
    var flags = screenFlags()
    document.body.classList.add('et-auth-screen')

    if (flags.isAction) document.body.classList.add('et-required-action-screen')
    if (flags.isTotp) document.body.classList.add('et-totp-screen')
    if (flags.isOtpChallenge) document.body.classList.add('et-otp-screen')
    if (flags.isRecoveryCodeChallenge) document.body.classList.add('et-recovery-code-screen')
    if (flags.isAuthenticatorSelection) document.body.classList.add('et-authenticator-selection-screen')
    if (flags.isPasswordUpdate) document.body.classList.add('et-password-update-screen')
    if (flags.isLogin) document.body.classList.add('et-login-screen')
  }

  function replaceValue(selector, text) {
    var element = document.querySelector(selector)
    if (element) element.value = text
  }

  function replaceValues(selector, text) {
    document.querySelectorAll(selector).forEach(function (element) {
      element.value = text
    })
  }

  function replaceVisibleText(from, to) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node) {
      if (node.nodeValue && node.nodeValue.trim() === from) node.nodeValue = node.nodeValue.replace(from, to)
    })
  }

  function replaceVisibleTextContaining(from, to) {
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    var nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    nodes.forEach(function (node) {
      if (node.nodeValue && node.nodeValue.indexOf(from) >= 0) node.nodeValue = node.nodeValue.replace(from, to)
    })
  }

  function hideField(selector, defaultValue) {
    var field = document.querySelector(selector)
    if (!field) return
    if (defaultValue) field.value = defaultValue

    var group = field.closest('.pf-v5-c-form__group') || field.closest('.form-group') || field.parentElement
    if (group) group.classList.add('et-hidden-field')
  }

  function localizeVisibleText() {
    if (screenFlags().isLogin) {
      document.body.classList.add('et-login-no-page-title')
      replaceText('#kc-page-title', '')
    }
    replaceText('label[for="username"] .pf-v5-c-form__label-text', 'Correo o usuario')
    replaceText('label[for="password"] .pf-v5-c-form__label-text', 'Contraseña')
    replaceText('.pf-v5-c-check__label', 'Recordarme')
    replaceText('#kc-login', 'Ingresar')
    replaceText('.pf-v5-c-login__main-footer-band-item', 'También podés ingresar con')

    var forgot = document.querySelector('a[href*="reset-credentials"]')
    if (forgot) forgot.textContent = 'Olvidé mi contraseña'
  }

  function localizeActionScreens() {
    var flags = screenFlags()

    if (flags.isAction) {
      var username = document.querySelector('#username')
      if (username && username.value) {
        username.readOnly = true
        username.setAttribute('aria-readonly', 'true')
        username.classList.add('et-readonly-username')
      }
    }

    if (flags.isTotp) {
      replaceText('#kc-page-title', 'Configurar 2FA')
      replaceText('label[for="totp"] .pf-v5-c-form__label-text', 'Código de verificación')
      replaceText('label[for="totp"]', 'Código de verificación')
      hideField('#userLabel', 'EduTrack')
      replaceValue('#kc-form-buttons input[type="submit"]', 'Activar 2FA')
      replaceValues('input[type="submit"]', 'Activar 2FA')
      replaceVisibleText('One-time code', 'Código de verificación')
      replaceVisibleText('Device Name', '')
      replaceVisibleText('Submit', 'Activar 2FA')
      replaceVisibleText('Cancel', 'Cancelar')
      replaceVisibleText('Install one of the following applications on your mobile:', 'Instalá una app autenticadora en tu celular.')
      replaceVisibleText('Open the application and scan the barcode:', 'Abrí la aplicación y escaneá el código QR:')
      replaceVisibleText('Unable to scan?', '¿No podés escanear?')
      replaceVisibleText(
        'Enter the one-time code provided by the application and click Submit to finish the setup.',
        'Ingresá el código de verificación para terminar la configuración.',
      )
      replaceVisibleText(
        'Provide a Device Name to help you manage your OTP devices.',
        '',
      )
      replaceVisibleTextContaining(
        'Provide a Device Name to help you manage your OTP devices.',
        '',
      )
    }

    if (flags.isOtpChallenge) {
      replaceText('#kc-page-title', 'Verificación en dos pasos')
      replaceText('label[for="otp"] .pf-v5-c-form__label-text', 'Código de verificación')
      replaceText('label[for="totp"] .pf-v5-c-form__label-text', 'Código de verificación')
      replaceValue('#kc-login', 'Confirmar')
      replaceValues('input[type="submit"]', 'Confirmar')
      replaceVisibleText('One-time code', 'Código de verificación')
      replaceVisibleText('Log in', 'Confirmar')
      replaceVisibleText('Submit', 'Confirmar')
    }

    if (flags.isRecoveryCodeChallenge) {
      replaceText('#kc-page-title', 'Código de recuperación')
      replaceText('label[for="recoveryCodeInput"] .pf-v5-c-form__label-text', 'Código de recuperación')
      replaceText('label[for="recoveryCodeInput"]', 'Código de recuperación')
      replaceValue('#kc-login', 'Confirmar')
      replaceValues('input[type="submit"]', 'Confirmar')
      replaceVisibleTextContaining('Recovery code #', 'Código de recuperación')
      replaceVisibleText('Login with a recovery authentication code', 'Código de recuperación')
      replaceVisibleText('Recovery Authentication Code', 'Código de recuperación')
      replaceVisibleText('Enter a recovery authentication code from a previously generated list.', 'Usá un código de respaldo de un solo uso.')
    }

    if (flags.isAuthenticatorSelection) {
      replaceText('#kc-page-title', 'Elegí cómo verificarte')
      replaceVisibleText('Recovery Authentication Code', 'Código de recuperación')
      replaceVisibleText('Enter a recovery authentication code from a previously generated list.', 'Usá un código de respaldo de un solo uso.')
      replaceVisibleText('Authenticator Application', 'Aplicación autenticadora')
      replaceVisibleText('Enter a verification code from authenticator application.', 'Usá el código de tu app autenticadora.')
    }

    if (flags.isPasswordUpdate) {
      replaceText('#kc-page-title', 'Cambiar contraseña')
      replaceText('label[for="password-new"] .pf-v5-c-form__label-text', 'Contraseña nueva')
      replaceText('label[for="password-confirm"] .pf-v5-c-form__label-text', 'Confirmar contraseña')
      replaceValue('#kc-form-buttons input[type="submit"]', 'Guardar contraseña')
      replaceValues('input[type="submit"]', 'Guardar contraseña')
      replaceVisibleText('Submit', 'Guardar contraseña')
      replaceVisibleText('Cancel', 'Cancelar')
    }
  }

  var GOOGLE_LOGO_SVG =
    '<svg class="google" width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">' +
    '<path fill="#EA4335" d="M9 3.48c1.69 0 2.84.73 3.49 1.34l2.54-2.48C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l2.91 2.26C4.6 5.05 6.62 3.48 9 3.48z"/>' +
    '<path fill="#4285F4" d="M17.64 9.2c0-.74-.06-1.28-.19-1.84H9v3.34h4.96c-.1.83-.64 2.08-1.84 2.92l2.84 2.2c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
    '<path fill="#FBBC05" d="M3.88 10.78A5.54 5.54 0 0 1 3.58 9c0-.62.11-1.22.29-1.78L.96 4.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.92-2.26z"/>' +
    '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.84-2.2c-.76.53-1.78.9-3.12.9-2.38 0-4.4-1.57-5.12-3.74L.97 13.04C2.45 15.98 5.48 18 9 18z"/>' +
    '</svg>'

  function enhanceGoogleButton() {
    var google = document.querySelector('#social-google')
    if (!google || google.querySelector('.et-google-label')) return

    while (google.firstChild) google.removeChild(google.firstChild)

    var mark = document.createElement('span')
    mark.className = 'et-google-mark'
    mark.innerHTML = GOOGLE_LOGO_SVG

    var label = document.createElement('span')
    label.className = 'et-google-label'
    label.textContent = 'Continuar con Google'

    google.appendChild(mark)
    google.appendChild(label)
    google.setAttribute('aria-label', 'Continuar con Google')
  }

  function addRegisterLink() {
    var footer = document.querySelector('.pf-v5-c-login__main-footer')
    if (!footer || footer.querySelector('.et-register-link')) return

    var block = document.createElement('div')
    block.className = 'et-register-link'

    var text = document.createElement('span')
    text.textContent = '¿No tenés cuenta? '

    var link = document.createElement('a')
    link.href = frontendOrigin() + '/register'
    link.textContent = 'Crear usuario'

    block.appendChild(text)
    block.appendChild(link)
    footer.appendChild(block)
  }

  function attemptedUsername() {
    var attempted = document.querySelector('#kc-attempted-username')
    if (attempted && attempted.value) return attempted.value
    var username = document.querySelector('#username')
    if (username && username.value) return username.value
    return ''
  }

  function addLostTwoFactorEmailRecovery() {
    var flags = screenFlags()
    if (!(flags.isOtpChallenge || flags.isRecoveryCodeChallenge || flags.isAuthenticatorSelection)) return
    var container = document.querySelector('.pf-v5-c-login__main-body') || document.querySelector('#kc-content-wrapper')
    if (!container || container.querySelector('.et-2fa-email-recovery')) return

    var form = document.createElement('form')
    form.className = 'et-2fa-email-recovery'
    form.method = 'post'
    form.action = apiOrigin() + '/auth/account/2fa/disable-email-public'

    var title = document.createElement('div')
    title.className = 'et-2fa-email-recovery__title'
    title.textContent = '¿Perdiste el acceso a 2FA?'

    var text = document.createElement('p')
    text.textContent = 'Te podemos enviar un enlace al correo verificado para desactivar 2FA y volver a entrar.'

    var identifier = attemptedUsername()
    var input = document.createElement('input')
    input.type = identifier ? 'hidden' : 'text'
    input.name = 'identifier'
    input.value = identifier
    input.autocomplete = 'username'
    input.placeholder = 'Correo o usuario'
    input.className = 'pf-v5-c-form-control'
    if (!identifier) input.setAttribute('aria-label', 'Correo o usuario')

    var button = document.createElement('button')
    button.type = 'submit'
    button.className = 'et-2fa-email-recovery__button'
    button.textContent = 'Enviarme correo de recuperación'

    form.appendChild(title)
    form.appendChild(text)
    form.appendChild(input)
    form.appendChild(button)
    container.appendChild(form)
  }

  function dedupeAuthenticatorSelection() {
    if (!screenFlags().isAuthenticatorSelection) return
    var seen = {}
    document.querySelectorAll('li').forEach(function (item) {
      if (!item.querySelector('input[name="authenticationExecution"]')) return
      var heading = item.querySelector('h2')
      var description = item.querySelector('[class*="description"], .pf-v5-c-data-list__cell')
      var key = ((heading && heading.textContent) || '') + '|' + ((description && description.textContent) || '')
      key = key.replace(/\s+/g, ' ').trim().toLowerCase()
      if (!key) return
      if (seen[key]) {
        item.classList.add('et-duplicate-authenticator')
        return
      }
      seen[key] = true
    })
  }

  document.addEventListener('DOMContentLoaded', function () {
    installEduTrackFavicon()
    applyScreenClasses()
    localizeVisibleText()
    localizeActionScreens()
    enhanceGoogleButton()
    dedupeAuthenticatorSelection()
    addLostTwoFactorEmailRecovery()
    if (!screenFlags().isAction) addRegisterLink()
  })
})()
