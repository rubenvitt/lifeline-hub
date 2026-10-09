/**
 * Alarm-Meldungen im Service Worker (LFH-1062). Der von Workbox erzeugte `sw.js` lädt diese Datei
 * per `importScripts` (`vite.config.ts`, `workbox.importScripts`).
 *
 * Wo der `Notification`-Konstruktor fehlt (Chrome auf Android), zeigt `src/alarm/desktopAlarm.ts`
 * Meldungen über `showNotification`. Ein Klick darauf landet hier statt in der Seite: Meldung
 * schließen, den Tab der Meldung nach vorn holen und ihm den Klick melden; die Seite führt dann
 * zur Quelle. Gibt es den Tab nicht mehr, öffnet ein neuer die Quelle.
 */
self.addEventListener('notificationclick', (ereignis) => {
  const daten = ereignis.notification.data;
  if (!daten || daten.art !== 'lfh-alarm') return;
  ereignis.notification.close();
  ereignis.waitUntil(
    (async () => {
      // Nur gesteuerte Tabs: eine Seite außerhalb der App (`/lizenzen/`) hört nicht zu.
      const tabs = await self.clients.matchAll({ type: 'window' });
      if (tabs.length === 0) {
        await self.clients.openWindow(daten.ziel || daten.seite);
        return;
      }
      const tab = tabs.find((t) => t.url === daten.seite) || tabs[0];
      try {
        await tab.focus();
      } catch {
        // Fokus verweigert: die Meldung des Klicks geht trotzdem raus.
      }
      // Jedem Tab: die Meldungs-ID kennt nur der, der sie gezeigt hat. Kennt sie keiner mehr
      // (Tab neu geladen), führt der nach vorn geholte selbst zur Quelle.
      for (const t of tabs) {
        t.postMessage(
          t === tab
            ? { typ: 'lfh-alarm-klick', id: daten.id, ziel: daten.ziel, gewaehlt: true }
            : { typ: 'lfh-alarm-klick', id: daten.id },
        );
      }
    })(),
  );
});

// Nachfrage der Seite: ein Worker ohne diese Datei antwortet nicht, und die Seite meldet dann
// „nicht verfügbar“ statt einer Meldung, deren Klick nichts täte.
self.addEventListener('message', (ereignis) => {
  if (ereignis.data && ereignis.data.typ === 'lfh-alarm-nachfrage' && ereignis.source) {
    ereignis.source.postMessage({ typ: 'lfh-alarm-antwort' });
  }
});
