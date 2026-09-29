// Response-Typen sind Re-Exporte der aus Rust generierten Schemas.
import { apiGet } from './client';
import type { components } from './types.generated';

type S = components['schemas'];

export type FachebeneStatus = S['FachebeneStatus'];

/** GeoJSON FeatureCollection (lose typisiert, Geometrie ist quellabhängig). Rust:
 *  `GeoJsonFeatureCollection`. `type` ist `string` statt Literal und `geometry` optional: das
 *  Backend hält das Schema bewusst flach. MapLibre-Übergaben casten ohnehin (`as never`). */
export type FeatureCollection = S['GeoJsonFeatureCollection'];

/** Rust: `FachebeneAntwort`. `stand` ist ABSENT statt present-null. */
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
 * Hochwasserklasse eines LHP-Pegels (LFH-77), Feature-Property `klasse` der
 * `hochwasser`-Ebene.
 *
 * FE-LOKAL: Fachebenen-Properties sind backendseitig `HashMap<String, Value>`, ein
 * registriertes Rust-Enum wäre eine Waise im OpenAPI-Schema. Die Wire-Wörter sind deshalb auf
 * BEIDEN Seiten gepinnt: `fachebenen.test.ts` und `karte::normalisierung::hochwasser_tests`.
 *
 * Klassen des Portals: keine Daten/veraltet · kein Hochwasser · kleines · mittleres · großes ·
 * sehr großes Hochwasser; `unklassifiziert` sind Pegel ohne Meldeklassen.
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
 * Stufe des UBA-Luftqualitätsindex einer Messstation (LFH-79), Feature-Property `klasse` der
 * `luftqualitaet`-Ebene. FE-lokal wie {@link HochwasserKlasse}, gepinnt in
 * `theme/statusFarben.test.ts` und `karte::luftqualitaet::tests::bildet_die_indexstufen_ab`.
 * Die Quelle zählt 0 („sehr gut“) bis 4 („sehr schlecht“); fehlend oder außerhalb ist
 * `keine_daten`.
 */
export type LuftqualitaetKlasse =
  'sehr_gut' | 'gut' | 'maessig' | 'schlecht' | 'sehr_schlecht' | 'keine_daten';

/**
 * Bewertungsstufe einer BfS-ODL-Sonde (LFH-78), Feature-Property `stufe` der `odl`-Ebene.
 * FE-lokal wie {@link HochwasserKlasse}, gepinnt in `theme/statusFarben.test.ts`,
 * `pages/lagekarte/odlStil.test.ts` und `karte::normalisierung::odl_tests`.
 *
 * Eine Projekt-Einteilung, keine BfS-Schwelle; welche von zweien, sagt {@link OdlBewertung}:
 * relativ zum Grundpegel der Sonde (bis 1,5 × · bis 3 × · darüber) oder nach absoluten Bändern
 * (bis 0,2 µSv/h · bis 0,6 · darüber). `keine_messung` sind Sonden ohne Messwert. Herleitung:
 * `docs/fachebenen-quellen.md`.
 */
export type OdlStufe = 'keine_messung' | 'normal' | 'erhoeht' | 'stark_erhoeht';

/**
 * Grundlage der {@link OdlStufe} einer Sonde (LFH-598), Property `bewertung`. Bei `standort`
 * tragen die Properties zusätzlich `grundpegel` (µSv/h), `faktor` und `grundpegel_stand`
 * (ISO-UTC); bei `absolut` fehlen alle drei. Gepinnt in `pages/lagekarte/odlStil.test.ts` und
 * `karte::odl_grundpegel::tests`. Ein unbekanntes Wort liest `odlGrundlage` als `absolut`.
 */
export type OdlBewertung = 'standort' | 'absolut';

/**
 * Anlagenart eines Punkts der `energie`-Ebene (LFH-81), Feature-Property `anlagenart`. FE-lokal
 * wie {@link HochwasserKlasse}. Die Menge ist fest und deckt MaStR-Energieträger und
 * OSM-`plant:source` mit EINEM Schlüssel ab.
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
