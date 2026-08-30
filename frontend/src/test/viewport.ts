/**
 * Breitenbewusster Medienabfrage-Stub für jsdom (LFH-329 · B1/H24).
 *
 * jsdom bringt `window.matchMedia` nicht mit. Der Vorgänger-Stub in `setup.ts` lieferte
 * für JEDE Abfrage `matches: false` — für antds Breakpoint-Beobachter heißt das eine
 * vollständige All-false-Karte, also „schmaler als xs" in jedem einzelnen Testlauf. Jede
 * Behauptung über responsives Verhalten wäre damit eine Attrappe gewesen, und die
 * Layout-Suiten wären beim ersten Konsumenten des Viewport-Hooks auf den Schmal-Zweig
 * gekippt — aus einem Grund, der mit ihrer Änderung nichts zu tun hat.
 *
 * Dieser Stub wertet stattdessen `min-width`/`max-width` gegen eine modulweite Breite aus
 * (Default {@link VIEWPORT_STANDARD}) und die Zeigerart gegen einen zweiten Schalter.
 * Jede andere Abfrage bleibt bewusst falsch: `prefers-color-scheme` und
 * `prefers-reduced-motion` dürfen sich nicht verschieben, sonst kippen Theme- und
 * Animationszweige quer durch die Suite.
 *
 * Eigenes Modul statt Code in `setup.ts` — nach dem Muster von `./server`: die setupFile
 * bindet es nur ein, Testdateien importieren dieselbe Instanz und steuern sie über die
 * Setter. `setup.ts` setzt im globalen `afterEach` {@link setzeViewportZurueck} zurück,
 * damit eine gesetzte Breite nicht in den nächsten Test leckt (der Stub hängt per
 * `Object.defineProperty` am window, kein Spy holt ihn zurück).
 */

/**
 * Default-Breite jedes Testlaufs: 1024 px, der Fükw-/Führungs-Kontext.
 *
 * Liegt über antds `md` (768) UND über `lg` (992), ist also auf beiden Achsen „breit",
 * und deckt sich mit jsdoms nativem `window.innerWidth` — Stub und jsdom laufen damit
 * nicht auseinander.
 */
export const VIEWPORT_STANDARD = 1024;

type Hoerer = (ereignis: MediaQueryListEvent) => void;

const BREITEN_MUSTER = /\((min|max)-width:\s*([0-9.]+)px\)/;
const ZEIGER_GROB = '(pointer: coarse)';

let breite = VIEWPORT_STANDARD;
let zeigerGrob = false;
let erfasst: string[] = [];
const hoerer = new Map<string, Set<Hoerer>>();

/** Vereinheitlicht Leerraum, damit `(pointer:coarse)` und `(pointer: coarse)` derselbe Schlüssel sind. */
function normiert(abfrage: string): string {
  return abfrage.replace(/\s+/g, ' ').trim();
}

/** Wertet eine Medienabfrage gegen den aktuellen Stub-Zustand aus. */
function trifftZu(abfrage: string): boolean {
  const treffer = BREITEN_MUSTER.exec(abfrage);
  if (treffer) {
    const schwelle = Number.parseFloat(treffer[2]);
    return treffer[1] === 'min' ? breite >= schwelle : breite <= schwelle;
  }
  if (normiert(abfrage) === ZEIGER_GROB) return zeigerGrob;
  return false;
}

function haenge(abfrage: string, funktion: Hoerer): void {
  const schluessel = normiert(abfrage);
  const menge = hoerer.get(schluessel) ?? new Set<Hoerer>();
  menge.add(funktion);
  hoerer.set(schluessel, menge);
}

function haengeAb(abfrage: string, funktion: Hoerer): void {
  hoerer.get(normiert(abfrage))?.delete(funktion);
}

/**
 * Baut eine Stub-Implementierung der Medienabfrage-Funktion.
 *
 * `matches` ist ein Getter, liest also bei jedem Zugriff den aktuellen Zustand — ein
 * einmal gehaltenes Ergebnisobjekt veraltet dadurch nicht. Die zurückgegebene Struktur
 * trägt alle sieben Bauteile (`media`, `onchange`, `addListener`, `removeListener`,
 * `addEventListener`, `removeEventListener`, `dispatchEvent`), weil `ThemeModeProvider`
 * und antds Beobachter darauf An-/Abmelden aufrufen: fehlt eines, wirft nicht ein Test,
 * sondern jeder Render der Provider-Kette.
 */
export function baueMatchMedia(): (abfrage: string) => MediaQueryList {
  return (abfrage: string) => {
    erfasst.push(abfrage);
    const stub = {
      get matches() {
        return trifftZu(abfrage);
      },
      media: abfrage,
      onchange: null,
      addListener: (funktion: Hoerer) => haenge(abfrage, funktion),
      removeListener: (funktion: Hoerer) => haengeAb(abfrage, funktion),
      addEventListener: (typ: string, funktion: Hoerer) => {
        if (typ === 'change') haenge(abfrage, funktion);
      },
      removeEventListener: (typ: string, funktion: Hoerer) => {
        if (typ === 'change') haengeAb(abfrage, funktion);
      },
      dispatchEvent: () => false,
    };
    return stub as unknown as MediaQueryList;
  };
}

/** Installiert den Stub global am `window` (aus `setup.ts` heraus, einmal je Testdatei). */
export function installiereMatchMedia(): void {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: baueMatchMedia(),
  });
}

/**
 * Setzt die Viewport-Breite für alle folgenden Abfragen.
 *
 * VOR dem Render aufrufen: antds Beobachter ruft seinen Zuhörer beim Abonnieren synchron
 * auf und liest dabei nur `matches` — eine nachträglich gesetzte Breite ohne gefeuertes
 * Ereignis erreicht ihn nicht mehr.
 */
export function setzeViewportBreite(breiteInPx: number): void {
  breite = breiteInPx;
}

/** Setzt die Zeigerart (grob = Berührung), ohne ein Änderungsereignis zu feuern. */
export function setzeZeigerGrob(grob: boolean): void {
  zeigerGrob = grob;
}

/**
 * Setzt die Zeigerart UND feuert das Änderungsereignis an alle angemeldeten Zuhörer —
 * der Weg, auf dem ein Test einen Gerätewechsel zur Laufzeit nachstellt.
 *
 * Gibt die Anzahl der benachrichtigten Zuhörer zurück. Das ist kein Beiwerk: nur damit
 * lässt sich belegen, dass ein Aufräum-Effekt seinen Zuhörer wirklich abgemeldet hat
 * (nach `unmount` muss die Zahl 0 sein) — ein bloß ausbleibender Zustandswechsel wäre
 * auch bei einem nie angemeldeten Zuhörer zu sehen.
 */
export function sendeZeigerAenderung(grob: boolean): number {
  zeigerGrob = grob;
  const ereignis = { matches: grob, media: ZEIGER_GROB } as MediaQueryListEvent;
  const betroffen = [...(hoerer.get(ZEIGER_GROB) ?? [])];
  for (const funktion of betroffen) funktion(ereignis);
  return betroffen.length;
}

/**
 * Setzt die Breite UND feuert das Änderungsereignis an alle Breiten-Zuhörer — der Weg, auf
 * dem ein Test einen Fensterwechsel ZUR LAUFZEIT nachstellt (Pendant zu
 * {@link sendeZeigerAenderung}).
 *
 * {@link setzeViewportBreite} allein reicht dafür nicht: antds Beobachter
 * (`_util/responsiveObserver.js`) liest `matches` nur beim Anmelden und danach ausschließlich
 * im `change`-Zuhörer — eine nachträglich gesetzte Breite ohne Ereignis erreicht eine bereits
 * gerenderte Komponente nie, und der Test bliebe trivial grün.
 *
 * Gibt die Anzahl der benachrichtigten Zuhörer zurück, aus demselben Grund wie oben: nur so
 * ist belegbar, dass überhaupt jemand zugehört hat.
 */
export function sendeBreitenAenderung(breiteInPx: number): number {
  breite = breiteInPx;
  let benachrichtigt = 0;
  for (const [abfrage, menge] of hoerer) {
    if (!BREITEN_MUSTER.test(abfrage)) continue;
    const ereignis = { matches: trifftZu(abfrage), media: abfrage } as MediaQueryListEvent;
    for (const funktion of [...menge]) {
      funktion(ereignis);
      benachrichtigt += 1;
    }
  }
  return benachrichtigt;
}

/**
 * Alle bisher abgefragten Medienabfragen, in Abfragereihenfolge.
 *
 * Die Liste ist INNERHALB eines Tests kumulativ (erst `setzeViewportZurueck` im globalen
 * `afterEach` leert sie): jeder Render registriert antds sieben Breiten-Abfragen erneut.
 * Stabil sind deshalb nur `toContain`/`not.toContain` — Behauptungen über die Länge oder
 * über einen festen Index sind es nicht.
 */
export function erfassteQueries(): string[] {
  return [...erfasst];
}

/** Räumt Breite, Zeigerart, Mitschrift und Zuhörer auf den Ausgangszustand zurück. */
export function setzeViewportZurueck(): void {
  breite = VIEWPORT_STANDARD;
  zeigerGrob = false;
  erfasst = [];
  hoerer.clear();
}
