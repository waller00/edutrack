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
    var raw = authReturnUrl()
    try {
      var url = new URL(raw)
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
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

  function localizeVisibleText() {
    replaceText('#kc-page-title', 'Ingresar a EduTrack')
    replaceText('label[for="username"] .pf-v5-c-form__label-text', 'Correo o usuario')
    replaceText('label[for="password"] .pf-v5-c-form__label-text', 'Contraseña')
    replaceText('.pf-v5-c-check__label', 'Recordarme')
    replaceText('#kc-login', 'Ingresar')
    replaceText('.pf-v5-c-login__main-footer-band-item', 'También podés ingresar con')

    var forgot = document.querySelector('a[href*="reset-credentials"]')
    if (forgot) forgot.textContent = 'Olvidé mi contraseña'
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
    text.textContent = 'No tenés cuenta? '

    var link = document.createElement('a')
    link.href = frontendOrigin() + '/register'
    link.textContent = 'Crear usuario'

    block.appendChild(text)
    block.appendChild(link)
    footer.appendChild(block)
  }

  document.addEventListener('DOMContentLoaded', function () {
    localizeVisibleText()
    enhanceGoogleButton()
    addRegisterLink()
  })
})()
