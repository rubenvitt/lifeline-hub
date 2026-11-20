/**
 * Sitzungssperre (LLH-1770): Solange die Sitzung im Betrieb unterbrochen ist und der Dialog
 * „Sitzung beendet“ offen steht, warten Leseanfragen hier, statt mit 401 zu scheitern. Sonst
 * stünden die Abfragen der verdeckten Seite im Fehlerzustand, und eine Seite mit Fehlerzweig
 * baute das offene Formular ab, das die Unterbrechung gerade erhalten soll.
 *
 * Gesetzt und gelöst nur vom `AuthProvider`; gelesen von `apiGet` (`api/client.ts`). Ohne React,
 * damit `api/client.ts` es ohne Kreisimport erreicht.
 */

let warten: Promise<boolean> | null = null;
let loesen: ((wiederhergestellt: boolean) => void) | null = null;

/** Sperrt; eine zweite Sperre behält das laufende Versprechen. */
export function sitzungSperren(): void {
  if (warten) return;
  warten = new Promise<boolean>((resolve) => {
    loesen = resolve;
  });
}

/** Löst die Sperre: `wiederhergestellt` lässt die Wartenden wiederholen, `beendet` scheitern. */
export function sitzungEntsperren(ergebnis: 'wiederhergestellt' | 'beendet'): void {
  const l = loesen;
  warten = null;
  loesen = null;
  l?.(ergebnis === 'wiederhergestellt');
}

/** Das Versprechen der laufenden Sperre, ohne Sperre `null`. */
export function warteAufSitzung(): Promise<boolean> | null {
  return warten;
}

export function istSitzungGesperrt(): boolean {
  return warten !== null;
}
