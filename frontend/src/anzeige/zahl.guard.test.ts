/**
 * Zahlen-Guard (LLH-1146): Dezimalzahlen erscheinen mit Komma.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * `toFixed` schreibt immer einen Punkt; „1.20 km“ liest eine Einsatzkraft als 1.200. Anzeigen
 * formatieren deshalb über den Zahlenkern `anzeige/zahl.ts`, Eingaben nehmen `DezimalFeld`
 * (Komma in der Anzeige, Komma und Punkt bei der Eingabe).
 *
 * ── Was dieser Guard NICHT sieht ────────────────────────────────────────────────
 * Er sucht Text, keine Typen: ein `toLocaleString('en')` oder ein `String(1.5)` im JSX fällt
 * nicht auf. Die Liste {@link MIT_PUNKT} nennt jede bewertete Stelle, an der der Punkt richtig
 * ist (Koordinaten, Wire- und URL-Werte); eine neue Stelle ist eine Entscheidung, ob der Wert
 * gelesen (dann Zahlenkern) oder maschinell weitergegeben wird.
 */
import { describe, expect, it } from 'vitest';

// Das Glob bleibt HIER, sonst landete bei einem versehentlichen Produktiv-Import der Quelltext im
// App-Bundle.
const dateien = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const quellen = Object.entries(dateien).filter(
  ([pfad]) => !/\.test\.tsx?$/.test(pfad) && !pfad.startsWith('/src/test/'),
);

/** Stellen, an denen `toFixed` richtig ist: der Punkt ist dort Format, keine Lesart. */
const MIT_PUNKT = new Set([
  '/src/anzeige/koordinaten.ts', // WGS84 dezimal „52.37580, 9.73201“ (Koordinatenformat)
  '/src/anzeige/ortCache.ts', // Cache-Schlüssel aus gerundeten Koordinaten
  '/src/command-palette/koordinatenSprung.ts', // Koordinate in die Sprung-URL
  '/src/routing/deeplinks.ts', // Koordinate im Deeplink
  '/src/personen/koordinate.ts', // Fundort „lat/lon“, Koordinatenschreibweise
  '/src/personen/Personendaten.tsx', // dieselbe Schreibweise in der Inline-Angabe
  '/src/pages/BetreuungsstelleDetailPage.tsx', // Standort als WGS84-Koordinate
]);

/** Der Baustein selbst darf `decimalSeparator`, `precision` und Bruchschritte setzen. */
const DEZIMAL_BAUSTEIN = '/src/components/DezimalFeld.tsx';

function nutztToFixed(inhalt: string): boolean {
  return /\.toFixed\(/.test(inhalt);
}

/** Jede `<InputNumber …/>`-Stelle, die eine Dezimalzahl annimmt (Bruchschritt, Stellen, Trenner). */
function dezimaleInputNumbers(inhalt: string): string[] {
  const treffer: string[] = [];
  for (const m of inhalt.matchAll(/<InputNumber\b/g)) {
    const rest = inhalt.slice(m.index);
    const ende = rest.search(/\/>|<\/InputNumber>/);
    const props = ende < 0 ? rest : rest.slice(0, ende);
    if (
      /decimalSeparator/.test(props) ||
      /precision=\{\s*[1-9]/.test(props) ||
      /step=\{\s*\d*\.\d/.test(props)
    ) {
      treffer.push(props.split('\n')[0]);
    }
  }
  return treffer;
}

describe('Dezimalzahlen mit Komma (LLH-1146)', () => {
  it('nutzt toFixed nur an den bewerteten Stellen mit Punkt', () => {
    const nutzer = quellen
      .filter(([, inhalt]) => nutztToFixed(inhalt))
      .map(([pfad]) => pfad)
      .sort();
    expect(nutzer).toEqual([...MIT_PUNKT].sort());
  });

  it('nimmt Dezimalzahlen nur über DezimalFeld an', () => {
    const stellen = quellen
      .filter(([pfad]) => pfad !== DEZIMAL_BAUSTEIN && pfad.endsWith('.tsx'))
      .flatMap(([pfad, inhalt]) => dezimaleInputNumbers(inhalt).map(() => pfad));
    expect(stellen).toEqual([]);
  });

  it('erkennt ein neues toFixed und ein Dezimal-InputNumber (Gegenprobe)', () => {
    expect(nutztToFixed('const t = `${(m / 1000).toFixed(2)} km`;')).toBe(true);
    expect(nutztToFixed('zahlText(m / 1000, { stellen: 2 })')).toBe(false);
    expect(dezimaleInputNumbers('<InputNumber min={0} step={0.5} />')).toHaveLength(1);
    expect(dezimaleInputNumbers('<InputNumber\n  precision={2}\n/>')).toHaveLength(1);
    expect(dezimaleInputNumbers('<InputNumber decimalSeparator="," />')).toHaveLength(1);
    expect(dezimaleInputNumbers('<InputNumber min={1} step={5} precision={0} />')).toEqual([]);
  });
});
