import type { KarteMarker, MarkerTyp } from './marker';
import type { PersonenZugriff } from './personenEbene';
import type { BetreuungZugriff } from './betreuungEbene';
import { OBJEKTART } from './leistenDaten';

/**
 * Objektsuche der Kartenleiste (LFH-716; Herleitung `openspec/changes/
 * lfh-716-lagekarte-markersuche-zeichenpicker/design.md`, D1/D2). Rein, damit die
 * Modulsperre ohne Rendern als Paar prüfbar ist.
 */

/**
 * Die Menge, die die Suche überhaupt sieht.
 *
 * **Die Sperre hängt am Typ, nicht an der Herkunft.** `alleVerortet` trägt Betreuungsstellen
 * heute schon nur bei freiem Modul (`useLagekarteDaten`, `stellenRoh`), geprüft wird hier
 * trotzdem: „kein Name ohne Recht" soll nicht an einem Nebeneffekt der Datenquelle hängen.
 *
 * **Betroffene nur bei eingeschalteter Ebene.** Ein Treffer wählt über `onMarkerWaehlen` aus,
 * und das findet nur, was die Karte zeichnet (`waehlbar`). Ein Treffer, der die Ebene selbst
 * einschaltete, änderte eine einsatzweit geteilte Ansicht.
 */
export function suchbareMarker(a: {
  /** `alleVerortet` — ohne Betroffene. */
  verortet: KarteMarker[];
  /** `personenVerortet` — die Betroffenen, getrennt geführt (LFH-648). */
  personen: KarteMarker[];
  personenZugriff: PersonenZugriff;
  personenEbeneAn: boolean;
  betreuungZugriff: BetreuungZugriff;
}): KarteMarker[] {
  const personenFrei = a.personenZugriff === 'frei' && a.personenEbeneAn;
  const betreuungFrei = a.betreuungZugriff === 'frei';
  const erlaubt = (x: KarteMarker) =>
    x.typ === 'person' ? personenFrei : x.typ === 'betreuungsstelle' ? betreuungFrei : true;
  return [...a.verortet, ...(personenFrei ? a.personen : [])].filter(erlaubt);
}

/**
 * Reihenfolge bei Gleichstand der Trefferzahl.
 *
 * Ausgeschrieben statt aus `Object.keys(OBJEKTART)` abgeleitet: die Schlüsselreihenfolge eines
 * Objektliterals ist keine erklärte Absicht und drehte sich beim nächsten Umsortieren still
 * mit. Dass beide dieselbe Menge tragen, prüft ein Test in beide Richtungen.
 */
export const TYP_REIHENFOLGE: readonly MarkerTyp[] = [
  'einsatzort',
  'schaden',
  'uhs',
  'betreuungsstelle',
  'einheit',
  'fahrzeug',
  'fuehrung',
  'abschnitt',
  'lagemeldung',
  'freies_zeichen',
  'person',
];

export interface MarkerGruppe {
  typ: MarkerTyp;
  label: string;
  treffer: KarteMarker[];
}

/**
 * Gruppiert die Treffer eines Suchbegriffs nach Objektart. Gesucht wird in Beschriftung und
 * Objektart.
 *
 * Leere Gruppen fallen weg. Sortiert wird nach Trefferzahl absteigend, bei Gleichstand nach
 * {@link TYP_REIHENFOLGE} — ausdrücklich zweistufig: bei gleicher Zahl entschiede sonst die
 * Eingabereihenfolge, und die hängt an der Ladereihenfolge der Module.
 */
export function gruppiereTreffer(marker: KarteMarker[], suche: string): MarkerGruppe[] {
  const begriff = suche.trim().toLocaleLowerCase();
  const nachTyp = new Map<MarkerTyp, KarteMarker[]>();
  for (const x of marker) {
    // Beschriftung ODER Objektart: ein unbenanntes Zeichen heißt überall „(freies Zeichen)",
    // gefunden wird es über „takt"; „fahrzeug" listet alle Fahrzeuge (Browserprobe LFH-716).
    const text = `${x.label} ${OBJEKTART[x.typ]}`.toLocaleLowerCase();
    if (begriff !== '' && !text.includes(begriff)) continue;
    const bisher = nachTyp.get(x.typ);
    if (bisher) bisher.push(x);
    else nachTyp.set(x.typ, [x]);
  }
  const rang = (typ: MarkerTyp) => TYP_REIHENFOLGE.indexOf(typ);
  return [...nachTyp.entries()]
    .map(([typ, treffer]) => ({ typ, label: OBJEKTART[typ], treffer }))
    .sort((a, b) => b.treffer.length - a.treffer.length || rang(a.typ) - rang(b.typ));
}
