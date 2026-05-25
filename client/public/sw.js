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

    // Alarm-lifecycle visual hints: cleared events are silent + non-vibrating
    // so they don't interrupt the user the same way a raise does.
    const payload = data.data || {};
    const evt = payload.eventType || 'raise';
    const isCleared = evt === 'cleared';

    // Add an owner-type emoji to the body so the user can tell Group vs Site
    // at a glance even after the long title gets ellipsized by the OS shade.
    const ownerEmoji = payload.ownerType === 'GROUP' ? '🏢'
                     : payload.ownerType === 'SITE'  ? '🏭'
                     : '';
    const bodyText = ownerEmoji && payload.cName
        ? `${ownerEmoji} ${payload.cName}\n${data.body || ''}`
        : (data.body || '');

    const options = {
        body: bodyText,
        icon: data.icon || '/icon.svg',
        badge: data.badge || '/icon.svg',
        tag: data.tag || undefined,          // collapse duplicates by tag
        renotify: !isCleared,                // re-alert user on raise/escalate
        silent: isCleared,                   // cleared = no sound
        requireInteraction: evt === 'raise', // raises stay visible until dismissed
        vibrate: isCleared ? undefined : [120, 60, 120],
        data: payload,
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
