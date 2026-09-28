import type { BetreuungVerlaufArt } from '../api/queryKeys';
import type { BelegungVerlaufEintrag, StandVerlaufEintrag } from '../api/types';
import { istNachgetragen } from '../etb/typFarben';
import { ERHEBUNG_LABEL, personenZahl } from './betreuungText';

/**
 * Reine Hilfen des Meldeverlaufs: Stand- und Belegungsmeldungen laufen auf EINE Zeilenform
 * zusammen.
 * Bewusst FEHLT jede Rechnung, welche Meldung „aktuell“ ist — das liefert der Server aus dem
 * Zeiger am Objekt; eine zweite Definition könnte unbemerkt abweichen.
 */

export interface VerlaufZeile {
  id: number;
  anzahl: number;
  /** „1 320 evakuiert (geschätzt)“ bzw. „89 untergebracht“. */
  text: string;
  zeitpunkt_at: string;
  erfasst_at: string;
  erfasst_von: string;
  aktuell: boolean;
  zurueckgenommen_at?: string | null;
  zurueckgenommen_von?: string | null;
}

export function standZeile(e: StandVerlaufEintrag): VerlaufZeile {
  return {
    id: e.id,
    anzahl: e.evakuiert,
    text: `${personenZahl(e.evakuiert)} evakuiert (${ERHEBUNG_LABEL[e.erhebung]})`,
    zeitpunkt_at: e.zeitpunkt_at,
    erfasst_at: e.erfasst_at,
    erfasst_von: e.erfasst_von,
    aktuell: e.aktuell,
    zurueckgenommen_at: e.zurueckgenommen_at,
    zurueckgenommen_von: e.zurueckgenommen_von,
  };
}

export function belegungZeile(e: BelegungVerlaufEintrag): VerlaufZeile {
  return {
    id: e.id,
    anzahl: e.belegt,
    text: `${personenZahl(e.belegt)} untergebracht`,
    zeitpunkt_at: e.zeitpunkt_at,
    erfasst_at: e.erfasst_at,
    erfasst_von: e.erfasst_von,
    aktuell: e.aktuell,
    zurueckgenommen_at: e.zurueckgenommen_at,
    zurueckgenommen_von: e.zurueckgenommen_von,
  };
}

/**
 * Nachgetragen: der Zeitpunkt liegt mindestens 60 s vor der Erfassung — `istNachgetragen` aus
 * dem ETB, das der ETB-Eintrag derselben Meldung für sein ⧖ nutzt.
 */
export function istNachgetragenMeldung(z: Pick<VerlaufZeile, 'zeitpunkt_at' | 'erfasst_at'>) {
  return istNachgetragen(z.zeitpunkt_at, z.erfasst_at);
}

/** Meta-Wort an genau der aktuellen Meldung — der zweite Kanal neben der Reihenfolge. */
export function aktuellWort(art: BetreuungVerlaufArt): string {
  return art === 'bezirk' ? 'aktueller Stand' : 'aktuelle Belegung';
}

/**
 * Zugänglicher Name des Auslösers „Zurücknehmen“: Anzahl und Uhrzeit als Zeilenkennung, sonst
 * n gleichnamige Knöpfe. `zeit` kommt formatiert vom Aufrufer.
 */
export function ruecknahmeName(z: Pick<VerlaufZeile, 'anzahl'>, zeit: string): string {
  return `Meldung ${personenZahl(z.anzahl)} von ${zeit} zurücknehmen`;
}

/**
 * Zweiter Satz der Rückfrage: ob die Meldung den Stand trägt, aber KEINE vorhergesagte neue
 * Zahl — die bestimmt der Server; eine Vorhersage wäre eine zweite Definition von „aktuell“.
 */
export function rueckfrageHinweis(art: BetreuungVerlaufArt, aktuell: boolean): string {
  const was = art === 'bezirk' ? 'aktuelle Stand' : 'aktuelle Belegung';
  if (aktuell) {
    // Nicht „danach gilt die vorherige Meldung“: ist es die einzige, gibt es keine.
    return art === 'bezirk'
      ? `Das ist der ${was}. Er wird danach aus den übrigen Meldungen bestimmt.`
      : `Das ist die ${was}. Sie wird danach aus den übrigen Meldungen bestimmt.`;
  }
  return `${art === 'bezirk' ? 'Der' : 'Die'} ${was} ändert sich dadurch nicht.`;
}
