/**
 * Demo-Stammdaten in den Dispositions-Auswahllisten (LFH-733; Regel in `frontend/AGENTS.md`,
 * Bedien-Leitlinie; Herleitung in `openspec/changes/lfh-733-demo-stammdaten-kennzeichnen/design.md`
 * D1/D5).
 *
 * Demo-Stammdaten werden **gekennzeichnet, nie ausgeblendet**: Wer einen Funkrufnamen im
 * Katalog „in Dienst“ sieht, findet ihn auch in der Auswahl. Das Wort „Demo“ steht im
 * Wortlaut der Option, nicht in einem `optionRender`. So findet die Suche des `Select`-Wrappers
 * (`optionFilterProp: 'label'`) es, das geschlossene Feld zeigt es nach der Wahl, und ein
 * Screenreader liest es mit. Die Farbe trägt nichts (WCAG 1.4.1).
 *
 * Markierte Einträge stehen hinten, damit ein Demo-Eintrag nicht als erster Treffer in die
 * Hand fällt. Die Reihenfolge des Servers bleibt in beiden Gruppen erhalten.
 */

/** Zusatz am Wortlaut einer markierten Option. */
export const DEMO_ZUSATZ = ' · Demo';

export interface DispositionsOption {
  value: number;
  label: string;
}

/**
 * Baut die Optionen einer Stammdaten-Auswahl: `label` liefert den bisherigen Wortlaut, markierte
 * Zeilen (`demo: true`) bekommen {@link DEMO_ZUSATZ} und wandern stabil ans Ende. Ein fehlendes
 * `demo` (Antwort aus einem älteren Cache) zählt als „ohne Marke“.
 */
export function dispositionsOptionen<T extends { id: number; demo?: boolean }>(
  zeilen: readonly T[],
  label: (zeile: T) => string,
): DispositionsOption[] {
  const ohne: DispositionsOption[] = [];
  const mit: DispositionsOption[] = [];
  for (const zeile of zeilen) {
    if (zeile.demo === true) mit.push({ value: zeile.id, label: `${label(zeile)}${DEMO_ZUSATZ}` });
    else ohne.push({ value: zeile.id, label: label(zeile) });
  }
  return [...ohne, ...mit];
}
