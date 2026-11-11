import type { EinsatzFuehrung, FuehrungAnzeige, FuehrungWechselArt } from '../api/types';

/**
 * Texte der Führung je Einsatz (LLH-1491, Spec `instanz-fuehrung`). Reine Funktionen, damit Chip,
 * Hinweisband, Paneel und die Seite „Instanzkopplung“ dieselben Wörter tragen.
 */

/** Wie die geltende Führung zustande kam, für Verlauf und Stand. */
export const FUEHRUNG_ART_TEXT: Record<FuehrungWechselArt, string> = {
  angelegt: 'Angelegt',
  uebergabe: 'Übergabe',
  anfrage: 'Übernahme auf Anfrage',
  notuebernahme: 'Notübernahme',
  code_abgabe: 'Abgabe per Code',
  bestaetigt: 'Notübernahme bestätigt',
  widerspruch: 'Widerspruch',
  verworfen: 'Übernahme verworfen',
  verwahrung: 'Verwahrung',
};

/** Kurzform in Listen: „Führung: hier · Epoche 1“ oder „Führung: Hub Nord · Epoche 3“. */
export function fuehrungKurz(f: Pick<EinsatzFuehrung, 'fuehrend' | 'bei' | 'epoche'>): string {
  return `Führung: ${f.fuehrend ? 'hier' : f.bei} · Epoche ${f.epoche}`;
}

/** Chip im Einsatzkopf, wenn eine andere Instanz führt: „Führung: Hub Nord“. */
export function fuehrungBeiKurz(bei: string): string {
  return `Führung: ${bei}`;
}

/** Was an einer Akte zu bedienen ist, aus Sicht dieser Instanz. */
export interface FuehrungMoeglich {
  /** Gegenüber, an die übergeben werden kann (nur wenn diese Instanz führt, nichts offen ist). */
  uebergeben: FuehrungAnzeige['gegenueber'];
  /** Gegenüber, an die per Code abgegeben werden kann (nur die erreichte Seite). */
  perCode: FuehrungAnzeige['gegenueber'];
  /** Die Führung beim Gegenüber erbitten (meldende Seite, das Gegenüber führt). */
  anfragen: boolean;
  /** Notübernahme ohne Beweis gegen die erreichte Seite. Nur mit dem Einsatz hier als Spiegel
   *  (LLH-1641): ohne ihn hätte diese Instanz nichts zum Weiterführen. */
  notuebernahme: boolean;
  /** Notübernahme gegen die meldende Seite: mit Unterschrift oder Code. */
  notuebernahmeMitBeweis: boolean;
  /** Eine Übernahme gegen diese Instanz wartet auf Bestätigen oder Widersprechen. */
  entscheiden: boolean;
}

export function fuehrungMoeglich(f: FuehrungAnzeige): FuehrungMoeglich {
  // Einen verwahrten Einsatz führt nur noch diese Instanz (LLH-1647).
  const frei = f.fuehrend && !f.offen && !f.verwahrt;
  const liegtHier = f.einsatz_id != null;
  return {
    uebergeben: frei ? f.gegenueber : [],
    perCode: frei ? f.gegenueber.filter((g) => g.richtung === 'meldet_sich') : [],
    anfragen: !f.fuehrend && f.fuehrer_richtung === 'meldet_sich' && !f.anfrage_offen,
    notuebernahme: liegtHier && !f.fuehrend && f.fuehrer_richtung === 'meldet_sich',
    notuebernahmeMitBeweis: liegtHier && !f.fuehrend && f.fuehrer_richtung === 'wird_gemeldet',
    entscheiden: f.offen != null,
  };
}
