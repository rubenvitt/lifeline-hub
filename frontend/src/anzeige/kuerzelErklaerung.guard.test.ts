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

const BAUSTEIN = '/src/anzeige/KuerzelErklaerung.tsx';

/** Stellen, an denen die Schreibweise Text bleibt, mit Grund. */
const AUSNAHMEN: Record<string, string> = {
  '/src/pages/fuehrung/UeberblickPage.tsx':
    'Die Abschnittszeile ist ganz ein Link (kein Knopf im Link); die Legende steht im Kopf des Paneels.',
  '/src/geraet/LagemonitorPage.tsx':
    'Großbild ohne Bedienung (Lagemonitor, `geraet/AGENTS.md`); es gibt nichts anzutippen.',
};

export function treffer(inhalt: string): string[] {
  return inhalt
    .split('\n')
    .map((zeile) => zeile.trim())
    .filter((zeile) => /STAERKE_SCHREIBWEISE|F\/UF\/M\/\/Σ/.test(zeile))
    .filter((zeile) => !/^import\b/.test(zeile) && !/^(\/\/|\*|\/\*|\{\/\*)/.test(zeile))
    .filter((zeile) => !/^[A-Z_, ]*STAERKE_SCHREIBWEISE[A-Z_, ]*,?$/.test(zeile));
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
  });
});
