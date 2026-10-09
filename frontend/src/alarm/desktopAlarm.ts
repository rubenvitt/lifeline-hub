/**
 * Desktop-Benachrichtigung — NUR wenn der Tab im Hintergrund ist und die Permission erteilt
 * wurde. API fehlt oder Permission verweigert → No-op (der In-App-Toast trägt).
 *
 * Offene Meldungen führt das Modul selbst (LFH-951): eine OS-Meldung, die niemand anklickt,
 * bliebe sonst im Benachrichtigungs-Center stehen, auch wenn ihr Alarm in der App längst
 * quittiert ist. Wer die Toasts abräumt, räumt über {@link schliesseDesktopAlarm} bzw.
 * {@link schliesseAlleDesktopAlarme} auch diese ab.
 *
 * Zwei Wege zur Meldung (LFH-1062): der `Notification`-Konstruktor, und wo es den nicht gibt
 * (Android), `ServiceWorkerRegistration.showNotification()`. Den Klick auf eine Meldung des
 * zweiten Wegs empfängt der Service Worker (`public/alarm-sw.js`); er holt den Tab nach vorn und
 * meldet den Klick hierher zurück.
 */
function verfuegbar(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Chromium auf Android kennt `Notification`, wirft aber beim Konstruktor („Use
 * ServiceWorkerRegistration.showNotification()"). Dort geht eine Meldung nur über den Service
 * Worker; ohne ihn meldet die Kopfleiste „nicht verfügbar" statt „erlaubt" (LFH-950).
 */
function istAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * Die `Notification`-Klasse, deren Konstruktor geworfen hat. An die Klasse gebunden statt an ein
 * Flag: ein anderer Browserkontext (oder ein Test-Stub) beginnt wieder unvorbelastet.
 */
let wirftBeiKonstruktor: unknown = null;

function konstruktorNutzbar(): boolean {
  return !istAndroid() && Notification !== wirftBeiKonstruktor;
}

/**
 * Ein Service Worker steuert diese Seite UND kennt die Alarm-Meldungen. Ohne ihn
 * (Entwicklungsserver, allererster Aufruf vor dem ersten Neuladen) gibt es den zweiten Weg nicht.
 * Ein Worker aus der Zeit vor `alarm-sw.js` steuert die Seite, bis das App-Update angenommen ist
 * (`registerType: 'prompt'`); sein Klick täte nichts. Deshalb zählt erst die Antwort auf eine
 * Nachfrage, gebunden an den Worker, der geantwortet hat.
 */
function serviceWorkerDa(): boolean {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
  const worker = navigator.serviceWorker.controller;
  if (worker == null) return false;
  if (worker === bestaetigt) return true;
  if (worker !== angefragt) {
    angefragt = worker;
    hoereAufServiceWorker();
    worker.postMessage({ typ: NACHFRAGE });
  }
  return false;
}

/** Der steuernde Worker, der auf die Nachfrage geantwortet hat, und der zuletzt gefragte. */
let bestaetigt: ServiceWorker | null = null;
let angefragt: ServiceWorker | null = null;

/**
 * Feuert auf `window`, sobald sich {@link desktopPermission} ohne Zutun der Seite ändert (der
 * Service Worker hat geantwortet). Die Kopfleiste liest den Zustand dann neu.
 */
export const DESKTOP_ZUSTAND_EVENT = 'lfh:desktop-zustand';

export function desktopPermission(): NotificationPermission | 'unsupported' {
  if (!verfuegbar()) return 'unsupported';
  if (!konstruktorNutzbar() && !serviceWorkerDa()) return 'unsupported';
  return Notification.permission;
}

/** Fragt die Permission an (nur sinnvoll aus einer User-Geste). Callback erhält das Ergebnis. */
export function fordereDesktopPermission(beiErgebnis?: (p: NotificationPermission) => void): void {
  if (verfuegbar() && Notification.permission === 'default') {
    void Notification.requestPermission().then((p) => beiErgebnis?.(p));
  }
}

/** Eine angezeigte Meldung, gleich auf welchem Weg sie entstand. */
export interface DesktopMeldung {
  readonly tag: string | undefined;
  /** Schließt die Meldung; ein zweiter Aufruf tut nichts. */
  schliessen(): void;
}

/** Alle offenen Meldungen dieses Tabs; Meldungen ohne `tag` liegen ebenso darin. */
const offen = new Set<DesktopMeldung>();

/** Anzahl der offenen Meldungen — für Tests. */
export function offeneDesktopAlarme(): number {
  return offen.size;
}

type AlarmOptionen = {
  koerper?: string;
  beiKlick?: () => void;
  tag?: string;
  /** Pfad der Quelle. Der Service Worker öffnet ihn, wenn es den Tab nicht mehr gibt. */
  ziel?: string;
};

/**
 * Zeigt eine Desktop-Notification, wenn Tab im Hintergrund + Permission granted. `tag` ist der
 * fachliche Schlüssel des Alarms: eine zweite Meldung zum selben Bezug ersetzt die erste.
 * Gibt die Meldung zurück, oder `null`, wenn keine entstand.
 */
export function zeigeDesktopAlarm(titel: string, opts: AlarmOptionen = {}): DesktopMeldung | null {
  try {
    if (desktopPermission() !== 'granted') return null;
    if (!document.hidden) return null;
    if (opts.tag) schliesseDesktopAlarm(opts.tag);
    if (konstruktorNutzbar()) {
      try {
        return zeigeUeberKonstruktor(titel, opts);
      } catch (fehler) {
        // Ein TypeError heißt: es gibt den Konstruktor nicht (Android), die Kopfleiste darf nicht
        // weiter „erlaubt" melden — es sei denn, der Service Worker springt ein (LFH-1062).
        if (!(fehler instanceof TypeError)) return null;
        wirftBeiKonstruktor = Notification;
        if (!serviceWorkerDa()) return null;
      }
    }
    return zeigeUeberServiceWorker(titel, opts);
  } catch {
    // Notification-API blockiert/unavailable → still.
    return null;
  }
}

function zeigeUeberKonstruktor(titel: string, opts: AlarmOptionen): DesktopMeldung {
  const n = new Notification(
    titel,
    opts.tag ? { body: opts.koerper, tag: opts.tag } : { body: opts.koerper },
  );
  const meldung: DesktopMeldung = { tag: opts.tag, schliessen: () => n.close() };
  offen.add(meldung);
  n.onclose = () => {
    offen.delete(meldung);
  };
  n.onclick = () => {
    window.focus();
    opts.beiKlick?.();
    n.close();
  };
  return meldung;
}

// ── Zweiter Weg: über den Service Worker (LFH-1062) ─────────────────────────────────────

/** Kennzeichnet Meldungen dieses Moduls; der Service Worker fasst nur sie an. */
const MELDUNGS_ART = 'lfh-alarm';
/** Nachrichten zwischen Seite und `public/alarm-sw.js`; dort gleichlautend. */
const KLICK_NACHRICHT = 'lfh-alarm-klick';
const NACHFRAGE = 'lfh-alarm-nachfrage';
const ANTWORT = 'lfh-alarm-antwort';

/** Präfix der Meldungs-IDs: unterscheidet die Meldungen mehrerer Tabs desselben Geräts. */
const TAB_KENNUNG = Math.random().toString(36).slice(2, 10);
let laufnummer = 0;

/**
 * Je Meldungs-ID die Meldung und was ein Klick auf sie auslöst. Ein Eintrag überlebt das
 * Schließen: der Service Worker holt den Tab nach vorn, BEVOR er den Klick meldet, und der nun
 * sichtbare Tab räumt seine Meldungen ab (LFH-951). Begrenzt auf die jüngsten Einträge.
 */
const klicks = new Map<string, { meldung: DesktopMeldung; beiKlick?: () => void }>();
const KLICKS_HOECHSTENS = 50;

/**
 * Schritte im Service Worker laufen nacheinander: das Schließen der älteren Meldung zum selben
 * `tag` ist durch, bevor die neue erscheint (sonst ersetzte sie die alte still, ohne Signal),
 * und ein Schließen kurz nach dem Zeigen trifft die Meldung erst, wenn sie da ist.
 */
let kette: Promise<unknown> = Promise.resolve();

/**
 * Wie lange ein Schritt auf die Registrierung wartet. `ready` löst nie auf, wenn sie verschwand,
 * während der Worker die Seite noch steuert; die Kette stünde sonst für immer.
 */
const REGISTRIERUNG_FRIST_MS = 10_000;

function registrierung(): Promise<ServiceWorkerRegistration> {
  return new Promise((aufloesen, ablehnen) => {
    const frist = setTimeout(
      () => ablehnen(new Error('Service Worker nicht bereit')),
      REGISTRIERUNG_FRIST_MS,
    );
    navigator.serviceWorker.ready.then(
      (reg) => {
        clearTimeout(frist);
        aufloesen(reg);
      },
      (fehler: unknown) => {
        clearTimeout(frist);
        ablehnen(fehler);
      },
    );
  });
}

function imServiceWorker(schritt: (reg: ServiceWorkerRegistration) => Promise<unknown>): void {
  kette = kette
    .then(registrierung)
    .then(schritt)
    .catch(() => undefined);
}

/** Lädt die Quelle als ganze Seite; ein Objekt, damit Tests den Seitenwechsel abfangen. */
export const zielNavigation = { oeffne: (url: string) => window.location.assign(url) };

/** Der Container, an dem der Zuhörer hängt (an das Objekt gebunden wie oben). */
let hoertAuf: ServiceWorkerContainer | null = null;

function hoereAufServiceWorker(): void {
  const container = navigator.serviceWorker;
  if (hoertAuf === container) return;
  hoertAuf = container;
  container.addEventListener('message', (ev: MessageEvent) => {
    const daten = ev.data as {
      typ?: unknown;
      id?: unknown;
      ziel?: unknown;
      gewaehlt?: unknown;
    } | null;
    if (daten?.typ === ANTWORT) {
      if (bestaetigt === container.controller) return;
      bestaetigt = container.controller;
      window.dispatchEvent(new Event(DESKTOP_ZUSTAND_EVENT));
      return;
    }
    if (daten?.typ !== KLICK_NACHRICHT || typeof daten.id !== 'string') return;
    const eintrag = klicks.get(daten.id);
    if (eintrag) {
      // Der Service Worker hat die Meldung schon geschlossen und den Tab nach vorn geholt.
      klicks.delete(daten.id);
      offen.delete(eintrag.meldung);
      eintrag.beiKlick?.();
      return;
    }
    // Die Meldung stammt aus einem früheren Laden dieses Tabs (Android verwirft Tabs im
    // Hintergrund) oder aus einem geschlossenen: der nach vorn geholte Tab führt selbst zur Quelle.
    if (daten.gewaehlt === true && typeof daten.ziel === 'string') {
      zielNavigation.oeffne(daten.ziel);
    }
  });
}

function zeigeUeberServiceWorker(titel: string, opts: AlarmOptionen): DesktopMeldung {
  hoereAufServiceWorker();
  const id = `${TAB_KENNUNG}-${++laufnummer}`;
  const daten = {
    art: MELDUNGS_ART,
    id,
    seite: window.location.href,
    ...(opts.ziel ? { ziel: new URL(opts.ziel, window.location.href).href } : {}),
  };
  let geschlossen = false;
  const meldung: DesktopMeldung = {
    tag: opts.tag,
    schliessen: () => {
      if (geschlossen) return;
      geschlossen = true;
      // Nach der ID, nicht nach dem `tag`: zum selben Bezug kann schon die neuere Meldung stehen.
      imServiceWorker(async (reg) => {
        const liste = await reg.getNotifications(opts.tag ? { tag: opts.tag } : undefined);
        for (const n of liste) {
          if ((n.data as { id?: unknown } | null)?.id === id) n.close();
        }
      });
    },
  };
  offen.add(meldung);
  klicks.set(id, { meldung, beiKlick: opts.beiKlick });
  if (klicks.size > KLICKS_HOECHSTENS) klicks.delete(klicks.keys().next().value!);
  imServiceWorker((reg) =>
    reg
      .showNotification(
        titel,
        opts.tag
          ? { body: opts.koerper, tag: opts.tag, data: daten }
          : { body: opts.koerper, data: daten },
      )
      .catch((fehler: unknown) => {
        offen.delete(meldung);
        klicks.delete(id);
        throw fehler;
      }),
  );
  return meldung;
}

/** Schließt die offene Meldung mit diesem `tag`, falls es sie gibt. */
export function schliesseDesktopAlarm(tag: string): void {
  for (const n of [...offen]) {
    if (n.tag === tag) {
      offen.delete(n);
      n.schliessen();
    }
  }
}

/**
 * Schließt genau diese Meldung. Für Aufrufer, die erst später schließen (etwa nach der
 * Ausblendung eines Toasts): ein `tag` träfe dann womöglich schon eine neuere Meldung zum
 * selben Bezug.
 */
export function schliesseDesktopMeldung(n: DesktopMeldung): void {
  if (!offen.delete(n)) return;
  n.schliessen();
}

/** Schließt alle offenen Meldungen dieses Tabs. */
export function schliesseAlleDesktopAlarme(): void {
  const alle = [...offen];
  offen.clear();
  for (const n of alle) n.schliessen();
}
