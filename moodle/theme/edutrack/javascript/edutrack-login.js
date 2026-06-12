(function() {
  function themeLogoUrl() {
    if (typeof M !== 'undefined' && M.cfg && M.cfg.wwwroot) {
      var rev = M.cfg.themerev || '';
      return M.cfg.wwwroot + '/theme/image.php?theme=' + encodeURIComponent(M.cfg.theme || 'edutrack') +
        '&component=theme&rev=' + rev + '&image=logo';
    }
    return '/theme/image.php?theme=edutrack&component=theme&image=logo';
  }

  function installEduTrackFavicon() {
    var href = themeLogoUrl();
    document.querySelectorAll('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').forEach(function(link) {
      if (link.parentElement) {
        link.parentElement.removeChild(link);
      }
    });

    var icon = document.createElement('link');
    icon.rel = 'icon';
    icon.type = 'image/svg+xml';
    icon.href = href;
    document.head.appendChild(icon);

    var shortcut = document.createElement('link');
    shortcut.rel = 'shortcut icon';
    shortcut.type = 'image/svg+xml';
    shortcut.href = href;
    document.head.appendChild(shortcut);
  }

  function fixIdentityProviderButton() {
    document.querySelectorAll('.login-identityprovider-btn').forEach(function(button) {
      var logoUrl = themeLogoUrl();
      var image = button.querySelector('img');

      if (image) {
        image.src = logoUrl;
        image.alt = 'EduTrack';
        image.width = 24;
        image.height = 24;
        return;
      }

      image = document.createElement('img');
      image.src = logoUrl;
      image.alt = 'EduTrack';
      image.width = 24;
      image.height = 24;
      button.insertBefore(image, button.firstChild);
    });
  }

  var replacements = new Map([
    ['Log in to Los Olivos', 'Ingresar a Los Olivos'],
    ['Log in to the site', 'Ingresar al sitio'],
    ['Log in using your account on:', 'Ingresá con tu cuenta:'],
    ['Log in', 'Ingresar'],
    ['Lost password?', 'Olvidé mi contraseña'],
    ['Username', 'Usuario'],
    ['Password', 'Contraseña'],
    ['Access as a guest', 'Entrar como invitado'],
    ['Some courses may allow guest access', 'Algunos cursos permiten acceso como invitado'],
    ['Is this your first time here?', '¿Es tu primera vez acá?'],
    ['Hi!', 'Hola.'],
    ["For full access to courses you'll need to create yourself an account.", 'Para acceder a los cursos necesitás una cuenta.'],
    ['All you need to do is make up a username and password and use it in the form on this page!', 'Ingresá con tu usuario y contraseña.'],
    ["If someone else has already chosen your username then you'll have to try again using a different username.", 'Si el usuario ya existe, probá con otro nombre de usuario.']
  ]);

  function replaceExactText(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var nodes = [];
    var node;
    while ((node = walker.nextNode())) {
      nodes.push(node);
    }
    nodes.forEach(function(textNode) {
      var clean = textNode.nodeValue.replace(/\s+/g, ' ').trim();
      if (replacements.has(clean)) {
        textNode.nodeValue = textNode.nodeValue.replace(clean, replacements.get(clean));
      }
    });
  }

  function replaceAttributes() {
    document.querySelectorAll('input, button, a').forEach(function(element) {
      ['placeholder', 'value', 'title', 'aria-label'].forEach(function(attribute) {
        var value = element.getAttribute(attribute);
        if (value && replacements.has(value.trim())) {
          element.setAttribute(attribute, replacements.get(value.trim()));
        }
      });
    });
  }

  function closestBlock(element) {
    return element.closest('.login-divider, .login-section, .loginbox, .card, section, div') || element;
  }

  function hidePublicSignupAndGuestBlocks() {
    var headings = [
      'Is this your first time here?',
      '¿Es tu primera vez acá?',
      'Some courses may allow guest access',
      'Algunos cursos permiten acceso como invitado'
    ];

    document.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach(function(heading) {
      var text = heading.textContent.replace(/\s+/g, ' ').trim();
      if (headings.indexOf(text) !== -1) {
        closestBlock(heading).classList.add('edutrack-hide-login-extra');
      }
    });

    document.querySelectorAll('a, button').forEach(function(action) {
      var text = action.textContent.replace(/\s+/g, ' ').trim();
      if (text === 'Access as a guest' || text === 'Entrar como invitado') {
        closestBlock(action).classList.add('edutrack-hide-login-extra');
      }
    });
  }

  function addBrand() {
    var container = document.querySelector('.login-container, .loginbox');
    var heading = container && container.querySelector('h1, h2');
    if (!container || !heading || container.querySelector('.edutrack-login-brand')) {
      return;
    }

    var brand = document.createElement('div');
    brand.className = 'edutrack-login-brand';
    brand.innerHTML =
      '<img class="edutrack-login-brand-logo" src="' + themeLogoUrl() + '" alt="EduTrack" width="48" height="48" />' +
      '<strong>EduTrack</strong><span>Aula virtual Los Olivos</span>';
    heading.insertAdjacentElement('beforebegin', brand);
  }

  function applyLoginPolish() {
    if (!document.body.classList.contains('pagelayout-login')) {
      return;
    }
    replaceExactText(document.body);
    replaceAttributes();
    hidePublicSignupAndGuestBlocks();
    fixIdentityProviderButton();
    addBrand();
    document.title = document.title.replace('Log in to the site', 'Ingresar al sitio');
  }

  function applyBranding() {
    installEduTrackFavicon();
    applyLoginPolish();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyBranding);
  } else {
    applyBranding();
  }
})();
