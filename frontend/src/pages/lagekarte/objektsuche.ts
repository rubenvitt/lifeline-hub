import type { KarteMarker, MarkerTyp } from './marker';
import type { PersonenZugriff } from './personenEbene';
import type { BetreuungZugriff } from './betreuungEbene';
import type { BrZugriff } from './brEbene';
import type { TierZugriff } from './tierEbene';
import { OBJEKTART } from './leistenDaten';

/**
 * Objektsuche der Kartenleiste (Herleitung:
 * `openspec/changes/archive/2026-09-29-lfh-716-lagekarte-markersuche-zeichenpicker/design.md`). Rein, damit die
 * Modulsperre ohne Rendern als Paar prüfbar ist.
 */

/**
 * Die Menge, die die Suche sieht.
 *
 * Die Sperre hängt am Typ, nicht an der Herkunft: `alleVerortet` trägt Betreuungsstellen nur bei
 * freiem Modul, geprüft wird trotzdem — „kein Name ohne Recht" soll nicht an einem Nebeneffekt der
 * Datenquelle hängen.
 *
 * Betroffene nur bei eingeschalteter Ebene: ein Treffer wählt über `onMarkerWaehlen` aus, und das
 * findet nur, was die Karte zeichnet. Ein Treffer, der die Ebene einschaltete, änderte die
 * einsatzweit geteilte Ansicht.
 */
export function suchbareMarker(a: {
  /** `alleVerortet` — ohne Betroffene. */
  verortet: KarteMarker[];
  /** `personenVerortet` — die Betroffenen, getrennt geführt. */
  personen: KarteMarker[];
  personenZugriff: PersonenZugriff;
  personenEbeneAn: boolean;
  betreuungZugriff: BetreuungZugriff;
  /** Ebene „Bereitstellungsräume" (LLH-1107). */
  brZugriff: BrZugriff;
  /** Ebene „Tiere" (LLH-1123). */
  tierZugriff: TierZugriff;
}): KarteMarker[] {
  const personenFrei = a.personenZugriff === 'frei' && a.personenEbeneAn;
  const betreuungFrei = a.betreuungZugriff === 'frei';
  const brFrei = a.brZugriff === 'frei';
  const tierFrei = a.tierZugriff === 'frei';
  const erlaubt = (x: KarteMarker) =>
    x.typ === 'person'
      ? personenFrei
      : x.typ === 'betreuungsstelle'
        ? betreuungFrei
        : x.typ === 'bereitstellungsraum'
          ? brFrei
          : x.typ === 'tier'
            ? tierFrei
            : true;
  return [...a.verortet, ...(personenFrei ? a.personen : [])].filter(erlaubt);
}

/**
 * Reihenfolge bei Gleichstand der Trefferzahl — ausgeschrieben, weil die Schlüsselreihenfolge von
 * `OBJEKTART` keine erklärte Absicht ist. Dass beide dieselbe Menge tragen, prüft ein Test.
 */
export const TYP_REIHENFOLGE: readonly MarkerTyp[] = [
  'einsatzort',
  'fuehrungsstelle',
  'schaden',
  'uhs',
  'betreuungsstelle',
  'bereitstellungsraum',
  'tier',
  'einheit',
  'fahrzeug',
  'fuehrung',
  'abschnitt',
  'lagemeldung',
  'freies_zeichen',
  'person',
];

interface MarkerGruppe {
  typ: MarkerTyp;
  label: string;
  treffer: KarteMarker[];
}

/**
 * Gruppiert die Treffer nach Objektart; gesucht wird in Beschriftung und Objektart. Leere Gruppen
 * fallen weg. Sortiert nach Trefferzahl absteigend, bei Gleichstand nach {@link TYP_REIHENFOLGE} —
 * sonst entschiede die Ladereihenfolge der Module.
 */
export function gruppiereTreffer(marker: KarteMarker[], suche: string): MarkerGruppe[] {
  const begriff = suche.trim().toLocaleLowerCase();
  const nachTyp = new Map<MarkerTyp, KarteMarker[]>();
  for (const x of marker) {
    // Beschriftung oder Objektart: ein unbenanntes Zeichen wird über „takt" gefunden, „fahrzeug"
    // listet alle Fahrzeuge.
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
