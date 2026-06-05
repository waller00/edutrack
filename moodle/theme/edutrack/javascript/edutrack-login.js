(function() {
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
    brand.innerHTML = '<strong>EduTrack</strong><span>Aula virtual Los Olivos</span>';
    heading.insertAdjacentElement('beforebegin', brand);
  }

  function applyLoginPolish() {
    if (!document.body.classList.contains('pagelayout-login')) {
      return;
    }
    replaceExactText(document.body);
    replaceAttributes();
    hidePublicSignupAndGuestBlocks();
    addBrand();
    document.title = document.title.replace('Log in to the site', 'Ingresar al sitio');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyLoginPolish);
  } else {
    applyLoginPolish();
  }
})();
