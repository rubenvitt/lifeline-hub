/**
 * Breitenbewusster Medienabfrage-Stub für jsdom.
 *
 * jsdom bringt `window.matchMedia` nicht mit. Ein Stub mit `matches: false` für alles hieße
 * für antd „schmaler als xs" in jedem Testlauf — jede Behauptung über responsives Verhalten
 * wäre eine Attrappe. Dieser Stub wertet `min-width`/`max-width` gegen eine modulweite Breite
 * aus (Default {@link VIEWPORT_STANDARD}) und die Zeigerart gegen einen zweiten Schalter. Jede
 * andere Abfrage bleibt bewusst falsch (`prefers-color-scheme`, `prefers-reduced-motion`).
 *
 * Eigenes Modul (Muster `./server`): Testdateien steuern dieselbe Instanz über die Setter;
 * `setup.ts` setzt im globalen `afterEach` {@link setzeViewportZurueck} zurück.
 */

/**
 * Default-Breite jedes Testlaufs: 1024 px, der Fükw-/Führungs-Kontext — über `md` UND `lg`,
 * und gleich jsdoms `window.innerWidth`.
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
 * `matches` ist ein Getter, ein gehaltenes Ergebnisobjekt veraltet also nicht. Alle sieben
 * Bauteile (`media`, `onchange`, `addListener`, `removeListener`, `addEventListener`,
 * `removeEventListener`, `dispatchEvent`) sind da, sonst wirft jeder Render der Provider-Kette.
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
 * VOR dem Render aufrufen: antds Beobachter liest `matches` nur beim Abonnieren.
 */
export function setzeViewportBreite(breiteInPx: number): void {
  breite = breiteInPx;
}

/** Setzt die Zeigerart (grob = Berührung), ohne ein Änderungsereignis zu feuern. */
export function setzeZeigerGrob(grob: boolean): void {
  zeigerGrob = grob;
}

/**
 * Setzt die Zeigerart UND feuert das Änderungsereignis — ein Gerätewechsel zur Laufzeit.
 * Gibt die Zahl der benachrichtigten Zuhörer zurück; nur so lässt sich belegen, dass ein
 * Aufräum-Effekt seinen Zuhörer abgemeldet hat (nach `unmount` 0).
 */
export function sendeZeigerAenderung(grob: boolean): number {
  zeigerGrob = grob;
  const ereignis = { matches: grob, media: ZEIGER_GROB } as MediaQueryListEvent;
  const betroffen = [...(hoerer.get(ZEIGER_GROB) ?? [])];
  for (const funktion of betroffen) funktion(ereignis);
  return betroffen.length;
}

/**
 * Setzt die Breite UND feuert das Änderungsereignis — ein Fensterwechsel zur Laufzeit.
 * {@link setzeViewportBreite} allein erreicht eine schon gerenderte Komponente nie: antds
 * Beobachter liest `matches` danach nur im `change`-Zuhörer. Gibt die Zahl der
 * benachrichtigten Zuhörer zurück.
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
 * Innerhalb eines Tests kumulativ (jeder Render registriert antds Abfragen erneut) — stabil
 * sind nur `toContain`/`not.toContain`, keine Länge oder festen Indizes.
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
