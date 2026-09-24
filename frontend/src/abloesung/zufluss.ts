/**
 * Ablösung (LFH-647) — Live-Zufluss der Schichtliste, ohne Sprung unter dem Cursor
 * (Prüfliste Kriterium 12, Bedien-Leitlinie Festlegung 6, WCAG 3.2.5).
 *
 * Die Liste ist nach Fälligkeit geordnet, und die Ordnung legt der Server fest. Eine Schicht,
 * die eine ANDERE Person beginnt (oder die ein fremder Vollzug als Folgeschicht erzeugt),
 * landet deshalb an ihrem Fälligkeitsplatz — auch oberhalb der Karte, auf der gerade der
 * Cursor steht. Solche fremden Neuzugänge warten hinter dem Sammelbanner, bis er bedient wird.
 *
 * ANDERS ALS `Datensicht` UND DIE ETB-ZEITACHSE hängt die Schleuse hier NICHT am Fokus. Das
 * Akzeptanzkriterium („verschiebt keine sichtbare Karte, bis der Banner bedient wird") gilt
 * unbedingt, und eine Karte kann auch unter dem Mauszeiger stehen, ohne dass etwas fokussiert
 * ist. Die Liste ist klein (eine Karte je eingesetzter Einheit), ein stehendes Banner kostet
 * also kaum etwas.
 *
 * WAS SOFORT STEHT:
 * - **Eigene** Neuzugänge: die Ids aus den Antworten der eigenen Aufrufe (Beginnen,
 *   Folgeschicht eines Vollzugs, Rücknahme). `AbloesungAnzeige` trägt keinen Anleger, die
 *   Herkunft ist also nur hier bekannt. Die Id wird VOR der Invalidierung vorgemerkt; kommt
 *   der Datenstand über das Live-Ereignis schon vorher an, steht die Karte für diesen einen
 *   Moment hinter dem Banner und rückt mit der Vormerkung sofort nach.
 * - **Änderungen an vorhandenen Karten** (Einstufung, Ablöser, Rhythmus): der Inhalt kommt
 *   immer aus den frischen Daten, die Karte bleibt dieselbe.
 *
 * WAS SOFORT WEGFÄLLT: Entfallene (ein fremder Vollzug verschiebt die abgelöste Schicht nach
 * „abgelöst"). Eine nicht mehr vorhandene Karte kann man nicht zeigen — dieselbe Regel wie in
 * `Datensicht` und `etb/zeitachseModell.ts`. Sie verlässt dabei auch den gezeigten Stand:
 * bringt eine fremde Rücknahme sie zurück, ist sie wieder Zuwachs.
 *
 * NULL GEZEIGTE KARTEN HALTEN NICHTS ZURÜCK: ohne Karte steht kein Cursor über einer Karte,
 * und ein Leerzustand „Keine laufenden Schichten" neben einem Banner „1 neue Schicht" wäre
 * ein Widerspruch (dieselbe Falle, die `Datensicht` beim Einfrieren der leeren Ladeansicht
 * dokumentiert).
 */
import type { Dayjs } from 'dayjs';
import type { Abloesung } from '../api/types';
import { zaehleFaellige } from './einstufung';

export interface Zuflussstand {
  /** Ids der zuletzt gezeigten Karten; `null` vor der ersten Lieferung. */
  gezeigt: ReadonlySet<number> | null;
  /** Ids eigener Neuzugänge, die noch nicht gezeigt wurden. */
  eigene: ReadonlySet<number>;
}

export const LEERER_ZUFLUSSSTAND: Zuflussstand = { gezeigt: null, eigene: new Set() };

/** Was die Schleuse von einem Eintrag braucht: nur seine Kennung. */
interface MitId {
  id: number;
}

/**
 * Teilt die laufenden Schichten (Server-Ordnung) in gezeigte und zurückgehaltene. Generisch
 * über die Kennung — die Verpflegung (LFH-634) nimmt dieselbe Schleuse für ihre Zeitfenster.
 */
export function teileZufluss<T extends MitId>(
  laufende: readonly T[],
  stand: Zuflussstand,
): { sichtbar: T[]; zurueckgehalten: T[] } {
  const { gezeigt, eigene } = stand;
  if (gezeigt == null) return { sichtbar: [...laufende], zurueckgehalten: [] };
  const sichtbar: T[] = [];
  const zurueckgehalten: T[] = [];
  for (const s of laufende) {
    if (gezeigt.has(s.id) || eigene.has(s.id)) sichtbar.push(s);
    else zurueckgehalten.push(s);
  }
  if (sichtbar.length === 0) return { sichtbar: [...laufende], zurueckgehalten: [] };
  return { sichtbar, zurueckgehalten };
}

/**
 * Der Stand nach einem Render: `gezeigt` wird die sichtbare Menge, sichtbar gewordene eigene
 * verlassen die Vormerkung. `null`, wenn sich nichts ändert — der Aufrufer setzt den Zustand
 * im Render nach, und ohne diesen Riegel liefe er in eine Schleife.
 */
export function nachgefuehrt(stand: Zuflussstand, sichtbar: readonly MitId[]): Zuflussstand | null {
  const gezeigt = new Set(sichtbar.map((s) => s.id));
  const eigene = new Set([...stand.eigene].filter((id) => !gezeigt.has(id)));
  const gleich =
    stand.gezeigt != null &&
    stand.gezeigt.size === gezeigt.size &&
    [...gezeigt].every((id) => stand.gezeigt!.has(id)) &&
    eigene.size === stand.eigene.size;
  return gleich ? null : { gezeigt, eigene };
}

/** Banner bedient oder Ansicht gewechselt: die volle Menge wird gezeigt. */
export function freigegeben(stand: Zuflussstand, laufende: readonly MitId[]): Zuflussstand {
  return { gezeigt: new Set(laufende.map((s) => s.id)), eigene: stand.eigene };
}

/**
 * Wortlaut des Banners. Eine zurückgehaltene Schicht kann fällig sein (fremde Rücknahme
 * eines alten Vollzugs, zurückdatierter Beginn) — dann nennt das Banner sie, damit sie nicht
 * still dahinter wartet (Prüfliste Kriterium 9).
 */
export function zuflussText(zurueckgehalten: readonly Abloesung[], jetzt: Dayjs): string {
  const n = zurueckgehalten.length;
  const basis = n === 1 ? '1 neue Schicht' : `${n} neue Schichten`;
  const faellig = zaehleFaellige(zurueckgehalten, jetzt);
  return faellig > 0 ? `${basis}, davon ${faellig} fällig` : basis;
}
