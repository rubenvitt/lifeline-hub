// LFH-265 (Teil A, Frontend): Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

export type FachebeneStatus = S['FachebeneStatus'];

/** GeoJSON FeatureCollection (lose typisiert — Geometrie ist Quell-abhängig).
 *  Rust: `GeoJsonFeatureCollection`, der Schema-Anker für `FachebeneAntwort.features`.
 *
 *  BEWUSSTE UNSCHÄRFE gegenüber der alten Handrolle (LFH-265): `type` ist hier `string`, nicht
 *  das Literal `'FeatureCollection'`/`'Feature'`, und `geometry` ist optional statt required-null.
 *  Das ist die dokumentierte Backend-Entscheidung („bewusst FLACH gehalten", siehe Doc-Kommentar
 *  an `GeoJsonGeometrie`) — Literal-Enums hätten zwei weitere ToSchema-Enums samt Wire-Pins
 *  gekostet. Konsumenten sind davon nicht betroffen: die MapLibre-Übergaben in `fachebenenLayer.ts`
 *  casten ohnehin (`as never`), weil MapLibre eigene GeoJSON-Typen mitbringt. */
export type FeatureCollection = S['GeoJsonFeatureCollection'];

/** Rust: `FachebeneAntwort`. `stand` ist seit LFH-265 ABSENT statt present-null. */
export type FachebeneAntwort = S['FachebeneAntwort'];

/** Pfad-Parameter von `/api/karte/fachebenen/:quelle` — FE-lokal (Eingabeseite, kein Response-DTO). */
export type FachebeneQuelle =
  | 'dwd'
  | 'pegelonline'
  | 'nina'
  | 'kritis'
  | 'hochwasser'
  | 'autobahn'
  | 'odl'
  | 'luftqualitaet'
  | 'energie';

/**
 * Hochwasserklasse eines LHP-Pegels (LFH-77), wie sie in den Feature-Properties der
 * `hochwasser`-Ebene unter `klasse` steht.
 *
 * FE-LOKAL wie {@link FachebeneQuelle}, und aus demselben Grund nicht generiert:
 * Fachebenen-Properties sind backendseitig `HashMap<String, Value>` — ein registriertes
 * Rust-Enum stünde als Waise im OpenAPI-Schema, auf die nichts zeigt. Die Wire-Wörter
 * sind deshalb auf BEIDEN Seiten gepinnt: hier in `fachebenen.test.ts`, drüben in
 * `karte::normalisierung::hochwasser_tests`.
 *
 * Klassenlehre des Portals (`js/lage-basics.js`): keine Daten/veraltet · kein Hochwasser ·
 * kleines · mittleres · großes · sehr großes Hochwasser; `unklassifiziert` sind Pegel,
 * die gar keine Meldeklassen führen.
 */
export type HochwasserKlasse =
  | 'keine_daten'
  | 'kein_hochwasser'
  | 'klein'
  | 'mittel'
  | 'gross'
  | 'sehr_gross'
  | 'unklassifiziert';

/**
 * Stufe des UBA-Luftqualitätsindex einer Messstation (LFH-79), wie sie in den
 * Feature-Properties der `luftqualitaet`-Ebene unter `klasse` steht.
 *
 * FE-LOKAL aus demselben Grund wie {@link HochwasserKlasse}: Fachebenen-Properties sind
 * backendseitig `HashMap<String, Value>`, ein registriertes Rust-Enum wäre eine Waise im
 * OpenAPI-Schema. Die Wire-Wörter sind auf BEIDEN Seiten gepinnt: hier in
 * `theme/statusFarben.test.ts`, drüben in
 * `karte::luftqualitaet::tests::bildet_die_indexstufen_ab`.
 *
 * Die Quelle zählt 0 („sehr gut") bis 4 („sehr schlecht"); fehlend oder außerhalb der Skala
 * ist `keine_daten`.
 */
export type LuftqualitaetKlasse =
  'sehr_gut' | 'gut' | 'maessig' | 'schlecht' | 'sehr_schlecht' | 'keine_daten';

/**
 * Bewertungsstufe einer BfS-ODL-Sonde (LFH-78), wie sie in den Feature-Properties der
 * `odl`-Ebene unter `stufe` steht.
 *
 * FE-LOKAL und beidseitig gepinnt aus demselben Grund wie {@link HochwasserKlasse}: hier in
 * `theme/statusFarben.test.ts` und `pages/lagekarte/odlStil.test.ts`, drüben in
 * `karte::normalisierung::odl_tests`.
 *
 * Die Stufe stammt aus einer von ZWEI Einteilungen des Lifeline Hub (keine BfS-Schwelle),
 * welche, sagt {@link OdlBewertung}: relativ zum Standort-Grundpegel der Sonde (bis 1,5 × ·
 * bis 3 × · darüber, LFH-598) oder, solange keiner vorliegt, nach absoluten Bändern am vom
 * BfS genannten natürlichen Bereich (bis 0,2 µSv/h · bis 0,6 · darüber, LFH-78).
 * `keine_messung` sind Sonden ohne Messwert (defekt, Testbetrieb). Herleitung:
 * `docs/fachebenen-quellen.md`.
 */
export type OdlStufe = 'keine_messung' | 'normal' | 'erhoeht' | 'stark_erhoeht';

/**
 * Grundlage der {@link OdlStufe} einer Sonde (LFH-598), Property `bewertung`. Bei `standort`
 * tragen die Properties zusätzlich `grundpegel` (µSv/h), `faktor` und `grundpegel_stand`
 * (ISO-UTC); bei `absolut` fehlen alle drei.
 *
 * FE-lokal und beidseitig gepinnt wie {@link OdlStufe}: hier in
 * `pages/lagekarte/odlStil.test.ts`, drüben in `karte::odl_grundpegel::tests`. Ein
 * unbekanntes Wort liest `odlGrundlage` als `absolut` — es erfindet keinen Maßstab.
 */
export type OdlBewertung = 'standort' | 'absolut';

/**
 * Anlagenart eines Punkts der `energie`-Ebene (LFH-81), wie sie in den Feature-Properties
 * unter `anlagenart` steht. FE-LOKAL aus demselben Grund wie {@link HochwasserKlasse}: die
 * Properties sind backendseitig untypisiert. Die Menge ist fest (design.md, Entscheidung 3);
 * sie deckt MaStR-Energieträger und OSM-`plant:source` mit EINEM Schlüssel ab.
 */
export type EnergieAnlagenart =
  | 'kohle'
  | 'gas'
  | 'oel'
  | 'kern'
  | 'abfall'
  | 'wasser'
  | 'wind'
  | 'solar'
  | 'biomasse'
  | 'speicher'
  | 'sonstige';

/**
 * Lädt eine Fachebene. `bbox` (west,sued,ost,nord) brauchen die bbox-abhängigen Ebenen
 * (`kritis`, `energie` — siehe `istBboxAbhaengig`); das Backend lehnt sie dort ohne ab.
 */
export function ladeFachebene(quelle: FachebeneQuelle, bbox?: string): Promise<FachebeneAntwort> {
  const q = bbox ? `?bbox=${encodeURIComponent(bbox)}` : '';
  return apiGet<FachebeneAntwort>(`/api/karte/fachebenen/${quelle}${q}`);
}
