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

/**
 * Web Push bei geschlossenem Tab (LLH-1223, Spec `web-push`). Die Nutzlast ist das Live-Ereignis
 * `benachrichtigung` und trägt nur Kennungen; den Text holt der Worker beim eigenen Server, mit
 * der Sitzung dieses Browsers. Ohne Antwort (Server vom Gerät aus nicht erreichbar, Sitzung
 * abgelaufen) zeigt er den Titel der Stufe: ein Alarm darf nicht verloren gehen.
 *
 * Der `tag` ist derselbe wie bei der OS-Meldung der Seite (`useBenachrichtigungen.ts`,
 * `<einsatz>-b-<id>`): ein verdeckter Tab und ein Push ergeben eine Meldung, nicht zwei. Hat die
 * App einen fokussierten Tab, zeigt der schon den Toast; die Meldung geht dann sofort wieder zu
 * (Chrome und Safari verlangen zu jedem Push eine sichtbare Meldung). Ebenso, wenn die
 * Benachrichtigung schon quittiert ist, etwa am Laptop, bevor der Push das Handy erreichte.
 */
const PUSH_TEXT_FRIST_MS = 5000;

self.addEventListener('push', (ereignis) => {
  let daten;
  try {
    daten = ereignis.data ? ereignis.data.json() : null;
  } catch {
    return;
  }
  if (!daten || typeof daten.benachrichtigung_id !== 'number' || daten.quittiert) return;
  ereignis.waitUntil(pushZeigen(daten));
});

/** JSON einer eigenen Route mit der Sitzung dieses Browsers; `null` bei jedem Fehler. */
async function holeJson(pfad, signal) {
  try {
    const antwort = await fetch(pfad, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      signal,
    });
    return antwort.ok ? await antwort.json() : null;
  } catch {
    return null;
  }
}

/**
 * Inhalt der Meldung in der Push-Meldung (LLH-1369, Spec `web-push`, „Inhalt der Meldung nur auf
 * Wunsch“). Nur wenn die Nutzlast `inhalt: true` trägt: das setzt der Server allein für ein Abo,
 * auf dem die Person „Mit Absender und Wortlaut“ eingeschaltet hat. Absender und Wortlaut reisen
 * nie im Push, der Worker holt die Meldung wie der Tab (`GET …/meldungen/{id}`).
 *
 * Titelwörter, Bezüge und Kürzung sind dieselben wie im Tab (`src/alarm/meldungInhalt.ts`,
 * LLH-1052); `alarmSw.test.ts` vergleicht beide Ausgaben.
 */
const INHALT_TITEL = {
  sofortmeldung: 'Sofortmeldung',
  sofortmeldung_eskaliert: 'Bestätigung ausstehend',
  meldung: 'Neue Meldung',
};
const MELDUNG_BEZUG = { meldung: null, lage_uebernahme: 'In die Lage übernommen' };
const WORTLAUT_ANFANG_MAX = 120;
const AUSLASSUNG = ' …';

function inhaltTitelWort(art, bezugTyp) {
  if (!Object.prototype.hasOwnProperty.call(MELDUNG_BEZUG, bezugTyp)) return null;
  if (!Object.prototype.hasOwnProperty.call(INHALT_TITEL, art)) return null;
  return MELDUNG_BEZUG[bezugTyp] || INHALT_TITEL[art];
}

function wortlautAnfang(text) {
  const flach = text.replace(/\s+/g, ' ').trim();
  const zeichen = Array.from(flach);
  if (zeichen.length <= WORTLAUT_ANFANG_MAX) return flach;
  const budget = WORTLAUT_ANFANG_MAX - Array.from(AUSLASSUNG).length;
  let schnitt = zeichen.slice(0, budget).join('');
  const wortende = zeichen[budget] === ' ' ? schnitt.length : schnitt.lastIndexOf(' ');
  if (wortende > schnitt.length / 2) schnitt = schnitt.slice(0, wortende);
  return `${schnitt.replace(/[\s,;:.–-]+$/u, '')}${AUSLASSUNG}`;
}

async function pushInhalt(d, signal) {
  const wort = d.inhalt === true ? inhaltTitelWort(d.art, d.bezug_typ) : null;
  if (!wort || typeof d.einsatz_id !== 'number' || typeof d.bezug_id !== 'number') return null;
  const m = await holeJson(`/api/einsaetze/${d.einsatz_id}/meldungen/${d.bezug_id}`, signal);
  if (!m) return null;
  const absender = typeof m.absender === 'string' ? m.absender.trim() : '';
  const wortlaut = typeof m.inhalt === 'string' ? m.inhalt.trim() : '';
  return {
    titel: absender ? `${wort} · ${absender}` : null,
    anfang: wortlaut ? wortlautAnfang(wortlaut) : null,
  };
}

async function pushZeigen(d) {
  // Text und Inhalt parallel, mit einer gemeinsamen Frist: ein hängender Abruf hält keinen Alarm auf.
  const abbruch = new AbortController();
  const frist = setTimeout(() => abbruch.abort(), PUSH_TEXT_FRIST_MS);
  let text;
  let inhalt;
  try {
    [text, inhalt] = await Promise.all([
      holeJson(`/api/benachrichtigungen/${d.benachrichtigung_id}`, abbruch.signal),
      pushInhalt(d, abbruch.signal),
    ]);
  } finally {
    clearTimeout(frist);
  }
  const titel =
    (inhalt && inhalt.titel) ||
    (text && text.titel) ||
    (d.stufe === 'alarm' ? 'Alarm' : 'Neue Benachrichtigung');
  const pfad = (text && text.pfad) || `/einsaetze/${d.einsatz_id}`;
  const tag = `${d.einsatz_id}-b-${d.benachrichtigung_id}`;
  const optionen = {
    tag,
    requireInteraction: d.stufe === 'alarm',
    data: {
      art: 'lfh-alarm',
      id: `push-${d.benachrichtigung_id}`,
      benachrichtigung_id: d.benachrichtigung_id,
      ziel: new URL(pfad, self.registration.scope).href,
    },
  };
  const body = (inhalt && inhalt.anfang) || (text && text.detail);
  if (body) optionen.body = body;
  await self.registration.showNotification(titel, optionen);
  const tabs = await self.clients.matchAll({ type: 'window' });
  if ((text && text.quittiert_at) || tabs.some((t) => t.focused)) {
    for (const n of await self.registration.getNotifications({ tag })) n.close();
  }
}
