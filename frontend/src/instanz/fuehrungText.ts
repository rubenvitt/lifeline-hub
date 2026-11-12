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
  /** Bei `notuebernahmeMitBeweis` die eigene Unterschrift als Beweis anbieten: nur wer
   *  `darfFuehrungUnterschreiben` (Admin der Einsatz-Org, LLH-1676, Spec `instanz-fuehrung`).
   *  Sonst bleibt der Code des Gegenübers. */
  unterschrift: boolean;
  /** Eine Übernahme gegen diese Instanz wartet auf Bestätigen oder Widersprechen. */
  entscheiden: boolean;
  /** Gegenüber vor Ort, mit denen die Führung hier wechseln würde, es aber nicht darf
   *  (LLH-1497): der Grund steht im Paneel. */
  vorOrt: string[];
}

/** Grund, warum zu einer Gegenstelle vor Ort keine Führung wechselt (wörtlich wie die 409). */
export function vorOrtHinweis(name: string): string {
  return `${name} ist vor Ort gekoppelt: Führungswechsel dorthin kommt später.`;
}

export function fuehrungMoeglich(
  f: FuehrungAnzeige,
  { darfUnterschreiben = false }: { darfUnterschreiben?: boolean } = {},
): FuehrungMoeglich {
  // Einen verwahrten Einsatz führt nur noch diese Instanz (LLH-1647).
  const frei = f.fuehrend && !f.offen && !f.verwahrt;
  const liegtHier = f.einsatz_id != null;
  // Über eine Direktkopplung vor Ort wechselt die Führung nicht (LLH-1497).
  const standard = f.gegenueber.filter((g) => g.art === 'standard');
  const fuehrerVorOrt = f.gegenueber.find(
    (g) => g.kennung === f.fuehrer_kennung && g.art === 'vor_ort',
  );
  const wechselZumFuehrer = !f.fuehrend && fuehrerVorOrt == null;
  const vorOrt = frei
    ? f.gegenueber.filter((g) => g.art === 'vor_ort').map((g) => g.name)
    : fuehrerVorOrt && !f.fuehrend
      ? [fuehrerVorOrt.name]
      : [];
  const mitBeweis = liegtHier && wechselZumFuehrer && f.fuehrer_richtung === 'wird_gemeldet';
  return {
    uebergeben: frei ? standard : [],
    perCode: frei ? standard.filter((g) => g.richtung === 'meldet_sich') : [],
    anfragen: wechselZumFuehrer && f.fuehrer_richtung === 'meldet_sich' && !f.anfrage_offen,
    notuebernahme: liegtHier && wechselZumFuehrer && f.fuehrer_richtung === 'meldet_sich',
    notuebernahmeMitBeweis: mitBeweis,
    unterschrift: mitBeweis && darfUnterschreiben,
    entscheiden: f.offen != null,
    vorOrt,
  };
}
