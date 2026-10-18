/**
 * Verortungsauftrag von außen (LLH-1125, Spec `lagekarte-verortungsauftrag`): Ebenen-Vorrang,
 * Kennung der Rückmeldung und Rückweg — rein, damit die Regeln ohne Karte prüfbar sind. Regeln:
 * `frontend/src/pages/lagekarte/AGENTS.md`, „Verortungsauftrag“.
 */
import { registrierAnzeige } from '../../api/einsatzPerson';
import { rueckwegPfad, type PlatzierenZielTyp } from '../../routing/deeplinks';
import type { LayerSichtbar, PlatzierenPunktTyp } from './Sidebar';

/** Die Ebene, die ein Auftrag dieses Typs zeichnet. Exhaustiv: ein neuer Typ bricht den Typcheck. */
export const EBENE_DES_AUFTRAGS: Record<PlatzierenZielTyp, keyof LayerSichtbar> = {
  person: 'person',
  schaden: 'schaden',
  uhs: 'uhs',
  betreuungsstelle: 'betreuungsstelle',
  bereitstellungsraum: 'bereitstellungsraum',
};

/**
 * Die gezeichneten Ebenen: die Wahl des Schalters plus die Ebene des Auftrags (design.md D1).
 * Abgeleitet, nie gespeichert — Schalter, Schmutzig-Erkennung und Speichern lesen weiter `layer`.
 * Die Modulsperre bleibt vorgeschaltet: wer die Daten nicht laden darf, bekommt keine Marker.
 */
export function layerMitVorrang(
  layer: LayerSichtbar,
  typ: PlatzierenZielTyp | null,
): LayerSichtbar {
  if (typ == null) return layer;
  const ebene = EBENE_DES_AUFTRAGS[typ];
  return layer[ebene] ? layer : { ...layer, [ebene]: true };
}

/** Die Ebene, die nur der Vorrang zeichnet — ihre Schalterzeile trägt den Zusatz „eingeblendet“. */
export function ebeneMitVorrang(
  layer: LayerSichtbar,
  typ: PlatzierenZielTyp | null,
): keyof LayerSichtbar | null {
  if (typ == null) return null;
  const ebene = EBENE_DES_AUFTRAGS[typ];
  return layer[ebene] ? null : ebene;
}

type VerortetObjekt = { typ: PlatzierenPunktTyp | 'einsatzort'; id: number };

/**
 * Kennung für „<Kennung> verortet“ aus den Daten, die die Karte ohnehin lädt (design.md D4): eine
 * Person über ihre Registriernummer, alles übrige über die Beschriftung seines Markers — oder,
 * solange die Listen noch nicht frisch sind, seiner Zeile in „Nicht verortet“. `null`, wenn das
 * Objekt nicht geladen ist; dann steht „Objekt verortet“.
 */
export function verortetKennung(
  ziel: VerortetObjekt,
  quellen: {
    personen: readonly { id: number; registrier_nr: number }[];
    marker: readonly { typ: string; id: number; label: string }[];
    nichtVerortet: readonly { typ: string; id: number; label: string }[];
  },
): string | null {
  if (ziel.typ === 'einsatzort') return 'Einsatzort';
  if (ziel.typ === 'person') {
    const person = quellen.personen.find((p) => p.id === ziel.id);
    return person ? registrierAnzeige(person.registrier_nr) : null;
  }
  const gleich = (o: { typ: string; id: number }) => o.typ === ziel.typ && o.id === ziel.id;
  return (quellen.marker.find(gleich) ?? quellen.nichtVerortet.find(gleich))?.label ?? null;
}

function isAuftragsTyp(typ: string): typ is PlatzierenZielTyp {
  return Object.prototype.hasOwnProperty.call(EBENE_DES_AUFTRAGS, typ);
}

/**
 * Ziel von „Zurück zu …“: nur, wenn der Auftrag von der Seite des Datensatzes kam, und allein aus
 * Typ und Kennung (`rueckwegPfad`) — nie ein Pfad aus der URL.
 */
export function rueckwegZiel(
  einsatzId: number,
  ziel: VerortetObjekt & { zurueck: boolean },
): string | null {
  if (!ziel.zurueck || !isAuftragsTyp(ziel.typ)) return null;
  return rueckwegPfad(einsatzId, ziel.typ, ziel.id);
}
