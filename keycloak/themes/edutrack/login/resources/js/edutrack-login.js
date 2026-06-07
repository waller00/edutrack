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
    var isPasswordUpdate = window.location.href.indexOf('UPDATE_PASSWORD') >= 0 || document.querySelector('#password-new')
    var isAction = isRequiredActionScreen() || isTotp || isPasswordUpdate || isOtpChallenge
    return {
      isAction: isAction,
      isTotp: isTotp,
      isOtpChallenge: isOtpChallenge,
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

  function enhanceGoogleButton() {
    var google = document.querySelector('#social-google')
    if (!google || google.querySelector('.et-google-label')) return

    var label = document.createElement('span')
    label.className = 'et-google-label'
    label.textContent = 'Continuar con Google'
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

  document.addEventListener('DOMContentLoaded', function () {
    applyScreenClasses()
    localizeVisibleText()
    localizeActionScreens()
    enhanceGoogleButton()
    if (!screenFlags().isAction) addRegisterLink()
  })
})()
