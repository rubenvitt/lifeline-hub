import type {
  EinsatzFuehrung,
  FuehrungAnzeige,
  FuehrungOffen,
  FuehrungWechselArt,
} from '../api/types';

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

/**
 * Titel einer offenen Übernahme in Hinweisband und Paneel. Im Konflikt (LLH-1669) nennt der Hub
 * eine andere ELW als Führer: Die eigene Führung hat dort nicht gegriffen. „Notübernahme“ sagt der
 * Titel nur, wenn die eigene Führung eine war (`art` der eigenen Akte).
 */
export function offeneUebernahmeTitel(
  o: Pick<FuehrungOffen, 'von' | 'konflikt'>,
  art: FuehrungWechselArt,
): string {
  if (!o.konflikt) return `Führung übernommen von ${o.von}`;
  return art === 'notuebernahme'
    ? `Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ${o.von}`
    : `Die Führung liegt am Hub bei ${o.von}, nicht hier`;
}

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
  /** Gegenüber, an die per Code abgegeben werden kann: als meldende Seite einer Standardkopplung
   *  oder an jede Gegenstelle vor Ort (LLH-1678). */
  perCode: FuehrungAnzeige['gegenueber'];
  /** Die Führung beim Gegenüber erbitten (meldende Seite oder vor Ort, das Gegenüber führt). */
  anfragen: boolean;
  /** Notübernahme ohne Beweis gegen die erreichte Seite einer Standardkopplung. Nur mit dem
   *  Einsatz hier als Spiegel (LLH-1641): ohne ihn hätte diese Instanz nichts zum Weiterführen. */
  notuebernahme: boolean;
  /** Notübernahme mit Unterschrift oder Code: gegen die meldende Seite und vor Ort immer
   *  (LLH-1678, Spec `instanz-fuehrung`). */
  notuebernahmeMitBeweis: boolean;
  /** Bei `notuebernahmeMitBeweis` die eigene Unterschrift als Beweis anbieten: nur wer
   *  `darfFuehrungUnterschreiben` (Admin der Einsatz-Org, LLH-1676, Spec `instanz-fuehrung`).
   *  Sonst bleibt der Code des Gegenübers. */
  unterschrift: boolean;
  /** Die Kopplung zur führenden Instanz ist beendet, der Einsatz liegt hier als Spiegel: ein
   *  Mensch holt die Führung mit Grund zurück (LLH-1850, Spec `instanz-fuehrung`). */
  zurueckholen: boolean;
  /** Eine Übernahme gegen diese Instanz wartet auf Bestätigen oder Widersprechen. */
  entscheiden: boolean;
  /** Eine Gegenstelle vor Ort bittet um die Führung; die Einsatzleitung entscheidet (LLH-1678). */
  anfrageEingang: FuehrungAnzeige['anfrage_eingang'] | null;
  /** Gründe, warum die Führung zu einer Gegenstelle nicht wechselt, wo sie es sonst würde
   *  (Gegenstelle vor Ort vor Protokoll 4, wörtlich wie die 409). */
  gesperrt: string[];
}

/** Die Kopplung zur führenden Instanz ist beendet (LLH-1850): Paneel „Führung“ und Hinweisband. */
export function kopplungBeendetText(name: string): string {
  return `Kopplung zu ${name} beendet`;
}

/** Grund, warum zu einer Gegenstelle vor Ort keine Führung wechselt (wörtlich wie die 409). */
export function updateHinweis(name: string): string {
  return `${name} braucht ein Update für den Führungswechsel vor Ort.`;
}

/** Titel einer Anfrage vor Ort an dieser Instanz. */
export function anfrageEingangTitel(name: string): string {
  return `${name} bittet um die Führung`;
}

export function fuehrungMoeglich(
  f: FuehrungAnzeige,
  { darfUnterschreiben = false }: { darfUnterschreiben?: boolean } = {},
): FuehrungMoeglich {
  // Einen verwahrten Einsatz führt nur noch diese Instanz (LLH-1647).
  const frei = f.fuehrend && !f.offen && !f.verwahrt;
  const liegtHier = f.einsatz_id != null;
  // Die Regel je Gegenüber kommt vom Server (LLH-1678, design.md D1): `nach_richtung` an einer
  // Standardkopplung, `gleichrangig` vor Ort, `gesperrt` vor Ort mit älterer Gegenstelle.
  const grund = (g: FuehrungAnzeige['gegenueber'][number]) =>
    g.wechsel_grund ?? updateHinweis(g.name);
  const tragend = f.gegenueber.filter((g) => g.wechsel !== 'gesperrt');
  const fuehrer = f.gegenueber.find((g) => g.kennung === f.fuehrer_kennung);
  const zumFuehrerGesperrt = fuehrer?.wechsel === 'gesperrt';
  const gleichrangig = fuehrer?.wechsel === 'gleichrangig';
  const wechselZumFuehrer = !f.fuehrend && !zumFuehrerGesperrt;
  const gesperrt = frei
    ? f.gegenueber.filter((g) => g.wechsel === 'gesperrt').map(grund)
    : fuehrer && zumFuehrerGesperrt && !f.fuehrend
      ? [grund(fuehrer)]
      : [];
  const mitBeweis =
    liegtHier && wechselZumFuehrer && (gleichrangig || f.fuehrer_richtung === 'wird_gemeldet');
  return {
    uebergeben: frei ? tragend : [],
    perCode: frei
      ? tragend.filter((g) => g.wechsel === 'gleichrangig' || g.richtung === 'meldet_sich')
      : [],
    anfragen:
      wechselZumFuehrer &&
      (gleichrangig || f.fuehrer_richtung === 'meldet_sich') &&
      !f.anfrage_offen,
    notuebernahme:
      liegtHier && wechselZumFuehrer && !gleichrangig && f.fuehrer_richtung === 'meldet_sich',
    notuebernahmeMitBeweis: mitBeweis,
    unterschrift: mitBeweis && darfUnterschreiben,
    zurueckholen: !f.fuehrend && liegtHier && f.fuehrer_beendet_at != null,
    entscheiden: f.offen != null,
    anfrageEingang: frei ? (f.anfrage_eingang ?? null) : null,
    gesperrt,
  };
}
