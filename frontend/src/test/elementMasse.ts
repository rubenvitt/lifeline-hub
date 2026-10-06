/**
 * Layout-Maße für jsdom: dort rechnet niemand Layout, `clientWidth`, `scrollWidth` und
 * `scrollLeft` sind überall 0. Wer eine Entscheidung aus gemessenen Breiten prüft (etwa die
 * Drei-Spalten-Form des UHS-Grundrisses, LFH-970), setzt sie hier je Test-Marke (`data-testid`).
 * Alle übrigen Elemente behalten jsdoms Werte.
 *
 * Eigenes Modul (Muster `./viewport`): `setup.ts` setzt im globalen `afterEach`
 * {@link setzeMasseZurueck} zurück.
 */

type Mass = 'clientWidth' | 'offsetWidth' | 'scrollWidth' | 'scrollLeft';

const werte = new Map<string, Partial<Record<Mass, number>>>();
const installiert = new Map<Mass, PropertyDescriptor>();

function installiere(mass: Mass): void {
  if (installiert.has(mass)) return;
  const traeger = mass === 'offsetWidth' ? HTMLElement.prototype : Element.prototype;
  const echt = Object.getOwnPropertyDescriptor(traeger, mass);
  if (!echt?.get) throw new Error(`jsdom kennt ${mass} nicht als Getter`);
  installiert.set(mass, echt);
  Object.defineProperty(traeger, mass, {
    ...echt,
    get(this: Element) {
      const gesetzt = werte.get(this.getAttribute('data-testid') ?? '')?.[mass];
      return gesetzt ?? echt.get!.call(this);
    },
  });
}

/** Setzt Maße der Elemente mit dieser Test-Marke; ein späterer Aufruf ergänzt bzw. überschreibt. */
export function setzeMasse(testId: string, masse: Partial<Record<Mass, number>>): void {
  for (const mass of Object.keys(masse) as Mass[]) installiere(mass);
  werte.set(testId, { ...werte.get(testId), ...masse });
}

/** Alle gesetzten Maße weg, jsdoms Getter zurück. */
export function setzeMasseZurueck(): void {
  werte.clear();
  for (const [mass, echt] of installiert) {
    const traeger = mass === 'offsetWidth' ? HTMLElement.prototype : Element.prototype;
    Object.defineProperty(traeger, mass, echt);
  }
  installiert.clear();
}
