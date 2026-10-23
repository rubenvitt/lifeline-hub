import type { TableColumnType } from 'antd';

/**
 * Bausteine für Sortieren und Filtern einer `KatalogTabelle` im Spaltenkopf (LLH-1096, Spec
 * `tabellen-sortieren-filtern`). `Datensicht` braucht sie nicht: dort trägt `sortWert` den
 * Vergleich, und Leerwerte stehen schon hinten. antds `sorter` dagegen vergleicht roh und kehrt
 * das Ergebnis für „absteigend“ nur um; ein leerer Träger stünde dann absteigend vorn.
 */

type Richtung = TableColumnType<object>['sortOrder'];

function leer(wert: unknown): boolean {
  return wert == null || wert === '';
}

/** Leerwerte in beiden Richtungen hinten: antd kehrt für „absteigend“ das Vorzeichen um. */
function leerHinten(aLeer: boolean, bLeer: boolean, richtung: Richtung | undefined): number {
  if (aLeer === bLeer) return 0;
  const hinten = aLeer ? 1 : -1;
  return richtung === 'descend' ? -hinten : hinten;
}

/**
 * Vergleich über einen Text für antds `sorter`: sprachbewusst (`de`, „Öttinger“ bei O) und mit
 * Zahlen in ihrer Folge („Florian 2“ vor „Florian 10“). Leerwerte stehen hinten.
 */
export function nachText<T>(wert: (zeile: T) => string | null | undefined) {
  return (a: T, b: T, richtung?: Richtung): number => {
    const x = wert(a);
    const y = wert(b);
    if (leer(x) || leer(y)) return leerHinten(leer(x), leer(y), richtung);
    return x!.localeCompare(y!, 'de', { numeric: true });
  };
}

/** Vergleich über eine Zahl für antds `sorter`; Leerwerte stehen hinten. */
export function nachZahl<T>(wert: (zeile: T) => number | null | undefined) {
  return (a: T, b: T, richtung?: Richtung): number => {
    const x = wert(a);
    const y = wert(b);
    if (x == null || y == null) return leerHinten(x == null, y == null, richtung);
    return x - y;
  };
}

/**
 * Filterwerte aus den geladenen Zeilen (Träger, Kategorie, Netz): jeder vorkommende Wert einmal,
 * nach `de` geordnet, Leerwerte nicht. Eine solche Spalte steht beim Aufbau der Seite noch nicht
 * fest und gehört deshalb in `ausDaten` des Listengedächtnisses (`components/listenGedaechtnis.ts`).
 */
export function werteAus<T>(
  zeilen: readonly T[],
  wert: (zeile: T) => string | null | undefined | readonly (string | null | undefined)[],
): { text: string; value: string }[] {
  const menge = new Set<string>();
  for (const z of zeilen) {
    const roh = wert(z);
    for (const w of Array.isArray(roh) ? roh : [roh]) if (!leer(w)) menge.add(w as string);
  }
  return [...menge]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    .map((w) => ({ text: w, value: w }));
}
