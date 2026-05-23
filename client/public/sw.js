// SmartEE Service Worker — receives Web Push events and shows OS notifications.
// Lives in /public so it is served at the root scope (/sw.js).

self.addEventListener('push', (event) => {
    if (!event.data) return;

    let data;
    try {
        data = event.data.json();
    } catch (_) {
        data = { title: 'SmartEE', body: event.data.text() };
    }

    const title = data.title || 'SmartEE — Energy Monitoring';
    const options = {
        body: data.body || '',
        icon: data.icon || '/icon.svg',
        badge: data.badge || '/icon.svg',
        tag: data.tag || undefined,      // collapse duplicates by tag (e.g. log id)
        data: data.data || {},           // carried through to notificationclick
    };

    event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();

    // Where to go when the user clicks the notification.
    const targetUrl = (event.notification.data && event.notification.data.url) || '/notify-log';

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            // Focus an already-open tab if we have one, else open a new window.
            for (const client of clientList) {
                if ('focus' in client) {
                    client.navigate(targetUrl);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(targetUrl);
        })
    );
});
