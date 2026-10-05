/**
 * Desktop-Benachrichtigung — NUR wenn der Tab im Hintergrund ist und die Permission erteilt
 * wurde. API fehlt oder Permission verweigert → No-op (der In-App-Toast trägt).
 *
 * Offene Meldungen führt das Modul selbst (LFH-951): eine OS-Meldung, die niemand anklickt,
 * bliebe sonst im Benachrichtigungs-Center stehen, auch wenn ihr Alarm in der App längst
 * quittiert ist. Wer die Toasts abräumt, räumt über {@link schliesseDesktopAlarm} bzw.
 * {@link schliesseAlleDesktopAlarme} auch diese ab.
 */
function verfuegbar(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/**
 * Chromium auf Android kennt `Notification`, wirft aber beim Konstruktor („Use
 * ServiceWorkerRegistration.showNotification()"). Dort gibt es keinen Weg für eine Meldung aus der
 * Seite, also meldet die Kopfleiste „nicht verfügbar" statt „erlaubt" (LFH-950).
 */
function istAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/**
 * Die `Notification`-Klasse, deren Konstruktor geworfen hat. An die Klasse gebunden statt an ein
 * Flag: ein anderer Browserkontext (oder ein Test-Stub) beginnt wieder unvorbelastet.
 */
let wirftBeiKonstruktor: unknown = null;

export function desktopPermission(): NotificationPermission | 'unsupported' {
  if (!verfuegbar() || istAndroid() || Notification === wirftBeiKonstruktor) return 'unsupported';
  return Notification.permission;
}

/** Fragt die Permission an (nur sinnvoll aus einer User-Geste). Callback erhält das Ergebnis. */
export function fordereDesktopPermission(beiErgebnis?: (p: NotificationPermission) => void): void {
  if (verfuegbar() && Notification.permission === 'default') {
    void Notification.requestPermission().then((p) => beiErgebnis?.(p));
  }
}

/** Alle offenen Meldungen dieses Tabs; Meldungen ohne `tag` liegen ebenso darin. */
const offen = new Set<Notification>();

/** Anzahl der offenen Meldungen — für Tests. */
export function offeneDesktopAlarme(): number {
  return offen.size;
}

/**
 * Zeigt eine Desktop-Notification, wenn Tab im Hintergrund + Permission granted. `tag` ist der
 * fachliche Schlüssel des Alarms: eine zweite Meldung zum selben Bezug ersetzt die erste.
 * Gibt die Meldung zurück, oder `null`, wenn keine entstand.
 */
export function zeigeDesktopAlarm(
  titel: string,
  opts: { koerper?: string; beiKlick?: () => void; tag?: string } = {},
): Notification | null {
  try {
    if (desktopPermission() !== 'granted') return null;
    if (!document.hidden) return null;
    if (opts.tag) schliesseDesktopAlarm(opts.tag);
    const n = new Notification(
      titel,
      opts.tag ? { body: opts.koerper, tag: opts.tag } : { body: opts.koerper },
    );
    offen.add(n);
    n.onclose = () => {
      offen.delete(n);
    };
    n.onclick = () => {
      window.focus();
      opts.beiKlick?.();
      n.close();
    };
    return n;
  } catch (fehler) {
    // Notification-API blockiert/unavailable → still. Ein TypeError heißt: es gibt den
    // Konstruktor nicht (Android), die Kopfleiste darf nicht weiter „erlaubt" melden.
    if (fehler instanceof TypeError && verfuegbar()) wirftBeiKonstruktor = Notification;
    return null;
  }
}

/** Schließt die offene Meldung mit diesem `tag`, falls es sie gibt. */
export function schliesseDesktopAlarm(tag: string): void {
  for (const n of [...offen]) {
    if (n.tag === tag) {
      offen.delete(n);
      n.close();
    }
  }
}

/**
 * Schließt genau diese Meldung. Für Aufrufer, die erst später schließen (etwa nach der
 * Ausblendung eines Toasts): ein `tag` träfe dann womöglich schon eine neuere Meldung zum
 * selben Bezug.
 */
export function schliesseDesktopMeldung(n: Notification): void {
  if (!offen.delete(n)) return;
  n.close();
}

/** Schließt alle offenen Meldungen dieses Tabs. */
export function schliesseAlleDesktopAlarme(): void {
  const alle = [...offen];
  offen.clear();
  for (const n of alle) n.close();
}
