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
    self.registration.showNotification(data.title || 'Edutrack', {
      body: data.body || '',
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      data: { url: data.url || '/' },
      tag: 'edutrack-push',
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/'
  const absolute = new URL(url, self.location.origin).href
  event.waitUntil(self.clients.openWindow(absolute))
})
