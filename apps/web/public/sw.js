// Web Push service worker — receives push payloads and shows notifications.
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: event.data?.text() ?? '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'AUCN Hub', {
      body: data.body || '',
      icon: '/icon.png',
      data: { url: data.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
