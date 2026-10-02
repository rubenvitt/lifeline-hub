/**
 * Live-Zufluss der Anhänge eines Erfassungsobjekts ohne Sprung unter dem Cursor (LFH-760, für
 * Schaden und Person über `ObjektAnhaenge`; Bedien-Leitlinie Festlegung 6, CLS ≤ 0,1, WCAG 3.2.5;
 * Prüfliste LFH-21, Kriterium 12).
 *
 * Die Liste steht neueste zuerst: eine Ablage aus einer anderen Sitzung landete oben und schöbe
 * die Zeilen darunter. Fremde Neuzugänge warten deshalb hinter dem Sammelbanner, bis „anzeigen“
 * sie freigibt. Wie bei der Ablösung (`abloesung/zufluss.ts`) hängt die Schleuse nicht am Fokus:
 * eine Zeile kann auch unter dem Mauszeiger stehen, und die Liste ist klein.
 *
 * - Sofort stehen eigene Ablagen dieser Sitzung (Ids aus der Antwort, VOR der Invalidierung
 *   vorgemerkt) und der Inhalt gezeigter Zeilen.
 * - Sofort weg sind entfernte Dateien.
 * - Die Folge der gezeigten bleibt die des Servers: eine Ablage ändert ihre Zeit nie, also ordnet
 *   der Server gezeigte Zeilen nicht um.
 * - Null gezeigte Zeilen halten nichts zurück: ein Leerzustand neben „1 neue Datei“ wäre ein
 *   Widerspruch.
 */

export interface AnhangZufluss {
  /** Ids der gezeigten Dateien; `null` vor der ersten Lieferung. */
  gezeigt: ReadonlySet<number> | null;
  /** Ids eigener Ablagen, die noch nicht gezeigt wurden. */
  eigene: ReadonlySet<number>;
}

export const OFFENER_ZUFLUSS: AnhangZufluss = { gezeigt: null, eigene: new Set() };

interface MitId {
  id: number;
}

export function teileZufluss<T extends MitId>(
  liste: readonly T[],
  stand: AnhangZufluss,
): { sichtbar: T[]; zurueckgehalten: T[] } {
  const { gezeigt, eigene } = stand;
  if (gezeigt == null) return { sichtbar: [...liste], zurueckgehalten: [] };
  const sichtbar: T[] = [];
  const zurueckgehalten: T[] = [];
  for (const a of liste) {
    if (gezeigt.has(a.id) || eigene.has(a.id)) sichtbar.push(a);
    else zurueckgehalten.push(a);
  }
  if (sichtbar.length === 0) return { sichtbar: [...liste], zurueckgehalten: [] };
  return { sichtbar, zurueckgehalten };
}

/**
 * Der Stand nach einem Render: `gezeigt` wird die sichtbare Menge, gezeigte eigene verlassen die
 * Vormerkung. `null`, wenn sich nichts ändert — der Aufrufer setzt den Zustand im Render nach und
 * liefe sonst in eine Schleife.
 */
export function nachgefuehrt(
  stand: AnhangZufluss,
  sichtbar: readonly MitId[],
): AnhangZufluss | null {
  const gezeigt = new Set(sichtbar.map((a) => a.id));
  const eigene = new Set([...stand.eigene].filter((id) => !gezeigt.has(id)));
  const alt = stand.gezeigt;
  const gleich =
    alt != null &&
    alt.size === gezeigt.size &&
    [...gezeigt].every((id) => alt.has(id)) &&
    eigene.size === stand.eigene.size;
  return gleich ? null : { gezeigt, eigene };
}

/** Banner bedient: die ganze Liste wird gezeigt. */
export function freigegeben(stand: AnhangZufluss, liste: readonly MitId[]): AnhangZufluss {
  return { gezeigt: new Set(liste.map((a) => a.id)), eigene: stand.eigene };
}

/** Eine eigene Ablage dieser Sitzung steht sofort, auch bevor die Liste sie liefert. */
export function vorgemerkt(stand: AnhangZufluss, id: number): AnhangZufluss {
  return { ...stand, eigene: new Set([...stand.eigene, id]) };
}

export function zuflussText(anzahl: number): string {
  return anzahl === 1 ? '1 neue Datei' : `${anzahl} neue Dateien`;
}
