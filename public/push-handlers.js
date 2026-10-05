self.addEventListener('push', event => {
  let data;
  try { data = event.data.json(); } catch { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || 'Spoolside order update', {
    body: data.body || 'Open Spoolside for the latest orders.',
    icon: '/icon-192.png', badge: '/icon-192.png', tag: data.tag || 'spoolside-order',
    data: {url: '/?view=orders'}
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const url = new URL('/?view=orders', self.location.origin).href;
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const existing = windows.find(c => new URL(c.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
