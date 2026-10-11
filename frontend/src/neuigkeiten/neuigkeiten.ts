import { kanalVon, type ChangelogEintrag, type Kanal } from '../../scripts/changelog-zerlegen.mjs';

/**
 * Reine Auswahl für die Neuigkeiten (Spec `neuigkeiten`). Die Liste ist die CHANGELOG-Reihenfolge,
 * also neueste zuerst. Alle Funktionen nehmen sie als Argument, damit sie ohne Build testbar sind.
 */

export type KanalFilter = Kanal | 'alle';

/** Position einer Version in der Liste, `-1` wenn sie nicht im Archiv steht. */
function position(liste: readonly ChangelogEintrag[], version: string | null | undefined): number {
  if (!version) return -1;
  return liste.findIndex((e) => e.version === version);
}

/**
 * Einträge des laufenden Kanals, die über dem Lesestand liegen. Ist der Lesestand unbekannt, gibt
 * es nichts zu drängen: die Liste bleibt leer.
 */
export function ungelesene(
  liste: readonly ChangelogEintrag[],
  laufend: string,
  gelesenBis: string | null | undefined,
): ChangelogEintrag[] {
  const kanal = kanalVon(laufend);
  const ende = position(liste, gelesenBis);
  if (ende < 0) return [];
  return liste.slice(0, ende).filter((e) => e.kanal === kanal);
}

/**
 * Einträge des laufenden Kanals zwischen der laufenden und der zuletzt gestarteten Version.
 * Ohne Versionswechsel ist die Liste leer. Steht die zuletzt gestartete Version nicht im
 * Archiv, zeigt der Abschnitt nur die laufende Version: der Zwischenstand ist unbekannt.
 */
export function seitLetzterVersion(
  liste: readonly ChangelogEintrag[],
  laufend: string,
  zuletztGestartet: string | null | undefined,
): ChangelogEintrag[] {
  if (!zuletztGestartet) return [];
  const start = position(liste, laufend);
  if (start < 0) return [];
  const kanal = liste[start].kanal;
  const ende = position(liste, zuletztGestartet);
  if (ende < 0) return [liste[start]];
  return liste.slice(start, ende).filter((e) => e.kanal === kanal);
}

/** Filter für die Archivliste. */
export function nachKanal(
  liste: readonly ChangelogEintrag[],
  filter: KanalFilter,
): ChangelogEintrag[] {
  if (filter === 'alle') return [...liste];
  return liste.filter((e) => e.kanal === filter);
}

/** Ab dieser Länge zeigt ein stabiler Eintrag zuerst eine Vorschau (Spec `neuigkeiten`). */
export const VORSCHAU_GRENZE = 20000;

/**
 * Die ersten Abschnitte eines Textes innerhalb der Zeichen-Grenze. Geschnitten wird an einer
 * Abschnittsüberschrift (`### …`), nie mitten in einem Abschnitt. Passt nicht einmal der erste
 * Abschnitt, wird an einer Zeilengrenze gekürzt.
 */
export function vorschau(text: string, grenze: number): { text: string; gekuerzt: boolean } {
  if (text.length <= grenze) return { text, gekuerzt: false };

  const abschnitte = text.split(/\n(?=### )/);
  const passend: string[] = [];
  let laenge = 0;
  for (const abschnitt of abschnitte) {
    if (laenge + abschnitt.length + 1 > grenze) break;
    passend.push(abschnitt);
    laenge += abschnitt.length + 1;
  }
  if (passend.length > 0) {
    return { text: passend.join('\n').trimEnd(), gekuerzt: true };
  }

  const zeilen: string[] = [];
  let zeilenLaenge = 0;
  for (const zeile of text.split('\n')) {
    if (zeilenLaenge + zeile.length + 1 > grenze) break;
    zeilen.push(zeile);
    zeilenLaenge += zeile.length + 1;
  }
  return { text: zeilen.join('\n').trimEnd(), gekuerzt: true };
}
