import type { InfotelefonAnruf } from '../api/types';

/**
 * Zufluss-Schleuse der Anruf-Zeitachse (LFH-554), nach dem Muster der ETB-Zeitachse
 * (`etb/zeitachseModell.ts`): Solange der Fokus in der Liste liegt, ist der gezeigte Stand
 * eingefroren (seit LLH-732 der geladene Ausschnitt, nicht die Vollliste). Neue Anrufe ANDERER
 * Plätze werden gezählt statt eingeschoben und erst auf „anzeigen“ eingefügt; auf diesem Gerät
 * erfasste stehen sofort (Bedien-Leitlinie Festlegung 6, WCAG 3.2.5). Das Gerät zählt, nicht das
 * Konto (LLH-1977, wie das ETB seit LLH-1833): derselbe Benutzer auf einem Zweitgerät erfasst aus
 * Sicht dieser Liste fremd, sein Anruf wartet hinter dem Banner.
 */
export interface Einfrierstand {
  ids: ReadonlySet<number>;
  /** Höchste gezeigte Kennung: nur jüngere Anrufe können zurückgehalten werden. */
  wassermarke: number;
}

/** Friert den gezeigten Stand ein; ohne Anruf gibt es nichts zu schützen. */
export function einfrieren(anrufe: readonly InfotelefonAnruf[]): Einfrierstand | null {
  if (anrufe.length === 0) return null;
  return {
    ids: new Set(anrufe.map((a) => a.id)),
    wassermarke: Math.max(...anrufe.map((a) => a.id)),
  };
}

/**
 * Nimmt nachgeladene Anrufe in den eingefrorenen Stand auf (LLH-732, LLH-1886): „Ältere laden“
 * oder „Neuere laden“ holt eine Seite, während der Fokus in der Liste liegt. Die Wassermarke
 * bleibt, sonst gäbe sie neue fremde Anrufe frei. Ohne die Aufnahme hielte die Schleuse einen
 * Nachtrag (alter Eingang, hohe Kennung) aus der geholten Seite als „neuen Anruf“ zurück.
 */
export function extendEinfrierstand(
  gefroren: Einfrierstand | null,
  ids: Iterable<number>,
): Einfrierstand | null {
  if (gefroren == null) return null;
  return { ...gefroren, ids: new Set([...gefroren.ids, ...ids]) };
}

const KEINE_IDS: ReadonlySet<number> = new Set();

/**
 * `hierErfasst`: Kennungen der Anrufe, die die Erfassung auf diesem Gerät zurückbekam. Das
 * Informationstelefon erfasst nicht ohne Netz, die Kennung steht also mit der Antwort fest; eine
 * `client_id` wie im ETB braucht es dafür nicht.
 */
export function teileZufluss(
  anrufe: readonly InfotelefonAnruf[],
  gefroren: Einfrierstand | null,
  hierErfasst: ReadonlySet<number> = KEINE_IDS,
): { sichtbar: InfotelefonAnruf[]; zurueckgehalten: number } {
  if (gefroren == null) return { sichtbar: [...anrufe], zurueckgehalten: 0 };
  const sichtbar: InfotelefonAnruf[] = [];
  let zurueckgehalten = 0;
  for (const a of anrufe) {
    const zurueck =
      !gefroren.ids.has(a.id) &&
      a.id > gefroren.wassermarke &&
      !hierErfasst.has(a.id);
    if (zurueck) zurueckgehalten += 1;
    else sichtbar.push(a);
  }
  return { sichtbar, zurueckgehalten };
}

export function zuflussText(anzahl: number): string {
  return anzahl === 1 ? '1 neuer Anruf' : `${anzahl} neue Anrufe`;
}
