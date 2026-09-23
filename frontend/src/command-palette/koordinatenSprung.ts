// frontend/src/command-palette/koordinatenSprung.ts
import { forward as mgrsVorwaerts } from 'mgrs';
import { TbMapPin } from 'react-icons/tb';
import { formatiere, parse, type LatLon } from '../anzeige/koordinaten';
import type { Koordinatenformat } from '../api/types';
import { lagekartePfad } from '../routing/deeplinks';
import type { Befehl } from './typen';

/**
 * Der Koordinatensprung der Sprungpalette (LFH-619): wer eine Koordinate tippt, bekommt ganz
 * oben „Auf Lagekarte zeigen" — ein Enter, und die Karte fliegt die Stelle an.
 *
 * KEIN PRÄFIX, SONDERN DIE FORM (Entscheidung zu LFH-619). Der Neuentwurf zeigt `# Koordinate`,
 * aber `#` ist seit LFH-391 · C3 das ETB-Präfix, begründet mit der laufenden Nummer, die im
 * Tagebuch ohnehin hinter `#` steht. Eine Koordinate braucht das Zeichen nicht: sie ist an
 * ihrer Form so eindeutig zu erkennen wie eine gedruckte Kennung an `zahlAusSuche`
 * (`datensaetze.ts`). Ein Suchbegriff, eine Nummer oder ein Funkrufname hat diese Form nie.
 *
 * ERKANNT WIRD JEDE FORM, NICHT NUR DAS EINGESTELLTE FORMAT. Wer auf MGRS steht und eine
 * Dezimalangabe vom Leitstellenfax abtippt, meint trotzdem eine Stelle. Die Einstellung
 * entscheidet nur, wie die Zeile den Punkt BESCHRIFTET.
 *
 * Die Formen sind bewusst eng: zwei ganze Zahlen („12 34") sind keine Koordinate, sondern eine
 * Hausnummer, eine Stärke oder ein halber Funkrufname, und „12.30 13.45" ist eine
 * Uhrzeitspanne. Dezimalgrad verlangt deshalb mindestens DREI Nachkommastellen (≙ rund
 * 100 m) in BEIDEN Werten.
 *
 * MGRS BRAUCHT DEN RÜCKWEG (Review-Befund zu LFH-619, gemessen an mgrs 2.2.0): eine
 * Fahrzeugkennung wie „1 HLF 20" oder eine Uhrzeit wie „12 Uhr 30" hat genau die Form
 * „Zone · Band · Quadrat · Ziffern", und `toPoint` prüft nicht, ob das 100-km-Quadrat zur
 * Zone passt — es rechnet sie in Punkte im Südpazifik um. Eine echte Angabe ergibt beim
 * Zurückrechnen dieselbe Zeichenkette, eine erfundene nicht („1HLF20" → „2JNL…").
 *
 * Rein und exportiert: kein Hook, kein Netz. Die Rechteprüfung („darf ich die Lagekarte
 * sehen?") liegt beim Aufrufer, der die Overrides kennt.
 */

/** Dezimalgrad mit Punkt: Trenner Komma, Semikolon oder Leerraum. */
const DEZ_PUNKT = /^(-?\d{1,2}\.\d{3,})\s*[,;\s]\s*(-?\d{1,3}\.\d{3,})$/;
/** Dezimalgrad mit Komma: das Komma ist schon vergeben, Trenner nur Semikolon oder Leerraum. */
const DEZ_KOMMA = /^(-?\d{1,2},\d{3,})\s*(?:;|\s)\s*(-?\d{1,3},\d{3,})$/;
/** MGRS: Zone, Band, 100-km-Quadrat, dann eine gerade Zahl von Ziffern (2–10). */
const MGRS = /^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z]{2})\s*(\d+)(?:\s+(\d+))?$/i;
/** UTM: Zone, Band, Rechtswert, Hochwert — anders als MGRS ohne 100-km-Quadrat. */
const UTM = /^\d{1,2}\s*[C-X]\s+\d{5,7}\s+\d{6,8}$/i;
/** Gauß-Krüger: je sieben Ziffern Rechts- und Hochwert, die Buchstaben R/H sind freiwillig. */
const GK = /^R?\s*\d{7}\s+H?\s*\d{7}$/i;

function imBereich(p: LatLon): LatLon | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  if (p.lat < -90 || p.lat > 90 || p.lon < -180 || p.lon > 180) return null;
  return p;
}

function versuche(text: string, system: Koordinatenformat): LatLon | null {
  try {
    return imBereich(parse(text, system));
  } catch {
    return null;
  }
}

/** Liest eine getippte Koordinate an ihrer Form; `null`, wenn die Eingabe keine ist. */
export function erkenneKoordinate(eingabe: string): LatLon | null {
  const text = eingabe.trim();
  if (!text) return null;

  const punkt = DEZ_PUNKT.exec(text);
  if (punkt) return imBereich({ lat: Number(punkt[1]), lon: Number(punkt[2]) });

  const komma = DEZ_KOMMA.exec(text);
  if (komma) {
    const zahl = (s: string) => Number(s.replace(',', '.'));
    return imBereich({ lat: zahl(komma[1]), lon: zahl(komma[2]) });
  }

  const mgrs = MGRS.exec(text);
  if (mgrs) {
    const ziffern = (mgrs[4] ?? '') + (mgrs[5] ?? '');
    // Ohne gerade Ziffernzahl gibt es keine Aufteilung in Rechts- und Hochwert.
    if (ziffern.length < 2 || ziffern.length > 10 || ziffern.length % 2 !== 0) return null;
    const punkt = versuche(text, 'mgrs');
    if (!punkt) return null;
    const eingabe = `${Number(mgrs[1])}${mgrs[2]}${mgrs[3]}${ziffern}`.toUpperCase();
    let zurueck: string;
    try {
      zurueck = mgrsVorwaerts([punkt.lon, punkt.lat], ziffern.length / 2);
    } catch {
      return null;
    }
    return zurueck === eingabe ? punkt : null;
  }

  if (UTM.test(text)) return versuche(text, 'utm');
  if (GK.test(text)) return versuche(text, 'gk');
  // Grad/Minuten/Sekunden: das Gradzeichen trägt ausser einer Koordinate nichts.
  if (text.includes('°')) return versuche(text, 'dms');
  return null;
}

/** Fünf Nachkommastellen ≙ rund 1 m — dieselbe Rundung wie `lagekartePfad`. */
function kurz(x: number): string {
  return String(Number(x.toFixed(5)));
}

/**
 * Die Zeile „Auf Lagekarte zeigen · <Punkt>" für einen erkannten Punkt.
 *
 * Gruppe `koordinate`, nicht `datensaetze`: der Treffer hat keinen Datensatz und keinen
 * Modulschlüssel, und `sichtbareDatensaetze` filtert über genau diesen. Er geht auch nicht ins
 * Gedächtnis (`GRUPPE_MERKBAR`): eine einmal getippte Stelle ist kein wiederkehrender Befehl.
 *
 * Die id trägt den gerundeten Punkt. Die Auswahl der Palette hängt an der Befehls-id — eine
 * feste id liesse beim Weitertippen die Markierung an einer Zeile kleben, die inzwischen
 * einen anderen Punkt meint.
 */
export function koordinatenBefehl({
  einsatzId,
  punkt,
  format,
  navigate,
}: {
  einsatzId: number;
  punkt: LatLon;
  format: Koordinatenformat;
  navigate: (pfad: string) => void;
}): Befehl {
  return {
    id: `koordinate:${kurz(punkt.lat)},${kurz(punkt.lon)}`,
    gruppe: 'koordinate',
    label: `Auf Lagekarte zeigen · ${formatiere(punkt.lat, punkt.lon, format)}`,
    kontext: 'Koordinate',
    icon: TbMapPin,
    ausfuehren: () => navigate(lagekartePfad(einsatzId, { zentrum: punkt })),
  };
}
