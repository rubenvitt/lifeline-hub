/**
 * Wächter „Die Schreibweise der Stärke erklärt sich“ (LLH-1825, `frontend/AGENTS.md`, „Kürzel sind
 * eingeführt oder erklärt“): die sichtbare Schreibweise „F/UF/M//Σ“ steht in Komponenten nur über
 * `anzeige/KuerzelErklaerung.tsx` (`StaerkeSchreibweise`), damit sie sich auch auf Touch erklärt.
 *
 * ── Warum ───────────────────────────────────────────────────────────────────────
 * Bis November 2026 erklärte sich die Stärke nur per `title`: auf dem Tablet erschien nichts, ein
 * Antippen der Zeile navigierte weg (UI/UX-Analyse vom 12.11.2026).
 *
 * ── Was er sieht ────────────────────────────────────────────────────────────────
 * In jeder `.tsx` außer Tests jede Zeile mit `STAERKE_SCHREIBWEISE` oder dem Literal „F/UF/M//Σ“,
 * die keine Importzeile und kein Kommentar ist. Erlaubt sind der Baustein selbst und `AUSNAHMEN`
 * (Pfad → Grund). Reine Texte in `.ts` (Export, Kopiertext, Kartenleiste) sieht er nicht.
 */
import { describe, expect, it } from 'vitest';

const dateien = import.meta.glob('/src/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const tsDateien = import.meta.glob('/src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const BAUSTEIN = '/src/anzeige/KuerzelErklaerung.tsx';

/** In `.ts`: ein Etikett (`label`, `title`, `bezeichnung`, `etikett`) mit der nackten Schreibweise. */
export function etikettTreffer(inhalt: string): string[] {
  return inhalt
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) =>
      /\b(?:label|title|bezeichnung|etikett):\s*[`'"][^`'"]*(?:\$\{STAERKE_SCHREIBWEISE\}|F\/UF\/M\/\/Σ)/.test(
        zeile,
      ),
    );
}

/** Stellen, an denen die Schreibweise Text bleibt, mit Grund. */
const AUSNAHMEN: Record<string, string> = {
  '/src/pages/fuehrung/UeberblickPage.tsx':
    'Die Abschnittszeile ist ganz ein Link (kein Knopf im Link); die Legende steht über den Zeilen.',
  '/src/stammdaten/EinheitVorlageDetailPage.tsx':
    'Formularetikett ist ein `<label>`; ein Knopf darin ist ungültiges HTML (Review B6).',
  '/src/geraet/LagemonitorPage.tsx':
    'Großbild ohne Bedienung (Lagemonitor, `geraet/AGENTS.md`); es gibt nichts anzutippen.',
};

export function treffer(inhalt: string): string[] {
  return (
    inhalt
      .split('\n')
      .map((zeile) => zeile.trim())
      .filter((zeile) => /STAERKE_SCHREIBWEISE|F\/UF\/M\/\/Σ/.test(zeile))
      .filter((zeile) => !/^import\b/.test(zeile) && !/^(\/\/|\*|\/\*|\{\/\*)/.test(zeile))
      .filter((zeile) => !/^[A-Z_, ]*STAERKE_SCHREIBWEISE[A-Z_, ]*,?$/.test(zeile))
      // Der Klartext einer Spalte für Spaltenschalter und Kopfbreite (`etikett`) ist kein
      // sichtbares Etikett der Fläche; dort steht der Titel mit dem Baustein (Review B3).
      .filter((zeile) => !/^etikett:/.test(zeile))
  );
}

const quellen = Object.entries(dateien).filter(
  ([pfad]) => !/\.test\.tsx$/.test(pfad) && !pfad.startsWith('/src/test/') && pfad !== BAUSTEIN,
);

describe('Die Schreibweise der Stärke erklärt sich (LLH-1825)', () => {
  it('steht in Komponenten nur über StaerkeSchreibweise', () => {
    const verstoesse = quellen
      .filter(([pfad]) => !(pfad in AUSNAHMEN))
      .flatMap(([pfad, inhalt]) => treffer(inhalt).map((zeile) => `${pfad}: ${zeile}`));
    expect(verstoesse).toEqual([]);
  });

  // Review B9: ein Etikett, das in einer `.ts` gebaut und von einer Komponente gezeigt wird
  // (Lagekarte `RasterFeld`), trägt das Kürzel in einem eigenen Feld (`labelKuerzel`).
  it('baut in .ts kein Etikett mit der nackten Schreibweise', () => {
    const verstoesse = Object.entries(tsDateien)
      .filter(([pfad]) => !/\.test\.ts$/.test(pfad) && !pfad.startsWith('/src/test/'))
      .flatMap(([pfad, inhalt]) => etikettTreffer(inhalt).map((zeile) => `${pfad}: ${zeile}`));
    expect(verstoesse).toEqual([]);
  });

  it('jede Ausnahme hat noch einen Treffer', () => {
    const tot = Object.keys(AUSNAHMEN).filter((pfad) => treffer(dateien[pfad] ?? '').length === 0);
    expect(tot).toEqual([]);
  });

  it('erkennt eine nackte Schreibweise (Gegenprobe)', () => {
    expect(treffer('<span>Stärke {STAERKE_SCHREIBWEISE}</span>')).toHaveLength(1);
    expect(treffer("title: 'Stärke F/UF/M//Σ',")).toHaveLength(1);
    expect(treffer("import { STAERKE_SCHREIBWEISE } from './staerke';")).toEqual([]);
    expect(treffer('  STAERKE_SCHREIBWEISE,')).toEqual([]);
    expect(treffer('// die Schreibweise STAERKE_SCHREIBWEISE steht einmal')).toEqual([]);
    expect(treffer('<StaerkeSchreibweise />')).toEqual([]);
    expect(treffer("etikett: 'Stärke F/UF/M//Σ',")).toEqual([]);
    expect(etikettTreffer('{ label: `Stärke ${STAERKE_SCHREIBWEISE}`, wert: x },')).toHaveLength(1);
    expect(etikettTreffer("  title: 'Stärke F/UF/M//Σ',")).toHaveLength(1);
    expect(etikettTreffer('zeilen.push(`Stärke (${STAERKE_SCHREIBWEISE}): ${t}`);')).toEqual([]);
  });
});
