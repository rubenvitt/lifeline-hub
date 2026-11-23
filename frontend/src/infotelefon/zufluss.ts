import { anrufOrdnung } from '../api/infotelefon';
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
type Stelle = Pick<InfotelefonAnruf, 'id' | 'eingang_at'>;

export interface Einfrierstand {
  ids: ReadonlySet<number>;
  /** Höchste gezeigte Kennung: nur jüngere Anrufe können zurückgehalten werden. */
  wassermarke: number;
  /**
   * Bereich des gezeigten Stands in der Ordnung des Servers (LLH-2066): jüngster und ältester
   * gezeigter Anruf. Was außerhalb nachrückt, kam nicht neu herein, sondern wurde verschoben.
   */
  oben: Stelle;
  unten: Stelle;
}

const stelle = (a: Stelle): Stelle => ({ id: a.id, eingang_at: a.eingang_at });
const juenger = (a: Stelle, b: Stelle) => (anrufOrdnung(a, b) < 0 ? a : b);
const aelter = (a: Stelle, b: Stelle) => (anrufOrdnung(a, b) > 0 ? a : b);

/** Friert den gezeigten Stand ein; ohne Anruf gibt es nichts zu schützen. */
export function einfrieren(anrufe: readonly InfotelefonAnruf[]): Einfrierstand | null {
  if (anrufe.length === 0) return null;
  return {
    ids: new Set(anrufe.map((a) => a.id)),
    wassermarke: Math.max(...anrufe.map((a) => a.id)),
    oben: stelle(anrufe.reduce<Stelle>(juenger, anrufe[0])),
    unten: stelle(anrufe.reduce<Stelle>(aelter, anrufe[0])),
  };
}

/**
 * Nimmt nachgeladene Anrufe in den eingefrorenen Stand auf (LLH-732, LLH-1886): „Ältere laden“
 * oder „Neuere laden“ holt eine Seite, während der Fokus in der Liste liegt. Die Wassermarke
 * bleibt, sonst gäbe sie neue fremde Anrufe frei. Ohne die Aufnahme hielte die Schleuse einen
 * Nachtrag (alter Eingang, hohe Kennung) aus der geholten Seite als „neuen Anruf“ zurück. Der
 * Bereich wächst mit (LLH-2066): ein fremder Nachtrag in die geholte Seite zählt danach.
 */
export function extendEinfrierstand(
  gefroren: Einfrierstand | null,
  anrufe: readonly InfotelefonAnruf[],
): Einfrierstand | null {
  if (gefroren == null) return null;
  return {
    ...gefroren,
    ids: new Set([...gefroren.ids, ...anrufe.map((a) => a.id)]),
    oben: stelle(anrufe.reduce<Stelle>(juenger, gefroren.oben)),
    unten: stelle(anrufe.reduce<Stelle>(aelter, gefroren.unten)),
  };
}

const KEINE_IDS: ReadonlySet<number> = new Set();

/**
 * Ein Anruf außerhalb des gezeigten Bereichs ist nachgerückt, nicht neu hereingekommen (LLH-2066):
 * Fällt im Fenster einer heraus („offene Rückrufe“: erledigt), lädt das Neuladen am Rand einen
 * von außerhalb nach. Unter dem ältesten gezeigten Anruf gilt das immer, denn ein neuer Anruf
 * kommt dort nicht ins Fenster, ohne dass einer herausfällt. Über dem jüngsten nur ohne Kopf im
 * Fenster; mit Kopf kommen dort die neuen Anrufe an.
 */
function nachgerueckt(a: Stelle, gefroren: Einfrierstand, kopfImFenster: boolean): boolean {
  if (anrufOrdnung(a, gefroren.unten) > 0) return true;
  return !kopfImFenster && anrufOrdnung(a, gefroren.oben) < 0;
}

/**
 * `hierErfasst`: Kennungen der Anrufe, die die Erfassung auf diesem Gerät zurückbekam. Das
 * Informationstelefon erfasst nicht ohne Netz, die Kennung steht also mit der Antwort fest; eine
 * `client_id` wie im ETB braucht es dafür nicht. `kopfImFenster`: die neueste Seite ist geladen.
 */
export function teileZufluss(
  anrufe: readonly InfotelefonAnruf[],
  gefroren: Einfrierstand | null,
  hierErfasst: ReadonlySet<number> = KEINE_IDS,
  kopfImFenster = true,
): { sichtbar: InfotelefonAnruf[]; zurueckgehalten: number } {
  if (gefroren == null) return { sichtbar: [...anrufe], zurueckgehalten: 0 };
  const sichtbar: InfotelefonAnruf[] = [];
  let zurueckgehalten = 0;
  for (const a of anrufe) {
    const zurueck =
      !gefroren.ids.has(a.id) &&
      a.id > gefroren.wassermarke &&
      !hierErfasst.has(a.id) &&
      !nachgerueckt(a, gefroren, kopfImFenster);
    if (zurueck) zurueckgehalten += 1;
    else sichtbar.push(a);
  }
  return { sichtbar, zurueckgehalten };
}

export function zuflussText(anzahl: number): string {
  return anzahl === 1 ? '1 neuer Anruf' : `${anzahl} neue Anrufe`;
}
