/* eslint-disable no-undef */
/**
 * Service worker para Web Push (Edutrack).
 * Debe vivir en la raíz del sitio (`/sw.js`).
 */
self.addEventListener('push', (event) => {
  let data = { title: 'Edutrack', body: '', url: '/' }
  try {
    if (event.data) {
      const parsed = event.data.json()
      data = { ...data, ...parsed }
    }
  } catch {
    try {
      const t = event.data && event.data.text()
      if (t) data.body = t
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(data.title || 'Edutrack', {
        body: data.body || '',
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        data: { url: data.url || '/' },
        // Cada aviso trae su etiqueta: con una sola fija, cada push pisaba al anterior.
        tag: data.tag || `edutrack-${Date.now()}`,
      }),
      // Las pestañas abiertas actualizan la campana enseguida, sin esperar su próxima consulta.
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        clients.forEach((client) => client.postMessage({ type: 'edutrack:push' }))
      }),
    ]),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const absolute = new URL(url, self.location.origin).href
  // Si EduTrack ya está abierto, se usa esa pestaña en vez de abrir otra.
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const open = clients.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        // `navigate` sólo anda en pestañas que controla este worker: si no, se abre una nueva.
        return open
          .focus()
          .then((focused) => focused.navigate(absolute))
          .catch(() => self.clients.openWindow(absolute))
      }
      return self.clients.openWindow(absolute)
    }),
  )
})
