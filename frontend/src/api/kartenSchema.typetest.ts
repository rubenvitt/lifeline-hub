// Typ-Ebenen-Pins für die aus Rust generierten Karten-Schemas; laufen über `pnpm typecheck`.
// REGELN:
//  - jeder Assert-Alias MUSS exportiert sein, sonst feuert TS6196 (`noUnusedLocals`).
//  - `@ts-expect-error` nur auf EXPORTIERTEN const-Bindungen und nur MIT Begründung, sonst
//    absorbiert TS6133 die Direktive bzw. bricht @typescript-eslint/ban-ts-comment das Lint-Gate.
import type { components } from './types.generated';

type S = components['schemas'];

export type Assert<T extends true> = T;

// Rauchprobe: das generierte Schema-Barrel ist überhaupt erreichbar und nicht leer/`never`.
export type _BarrelErreichbar = Assert<S extends object ? true : false>;

// ---------------------------------------------------------------------------
// KLASSE A: SCHEMA-ANKER-FELDER. Ohne das jeweilige `#[schema(…)]`-Attribut wäre der generierte
// Typ `string`/`unknown` und der Assert rot (TS2344).
// ---------------------------------------------------------------------------

// Union-Anker (`#[schema(value_type = OnlineStyleTyp)]`): `'vektor' | 'raster'` statt `string`.
export type _FormatIstUnion = Assert<
  'quatsch' extends S['OfflineRegionConfig']['format'] ? false : true
>;
export type _OfflineFormatIstUnion = Assert<
  'quatsch' extends NonNullable<S['KarteConfigAntwort']['offline_format']> ? false : true
>;
export type _OnlineQuelleTypIstUnion = Assert<
  'quatsch' extends S['OnlineQuelle']['typ'] ? false : true
>;
export type _StatusIstUnion = Assert<'quatsch' extends S['OfflineKarte']['status'] ? false : true>;

// GeoJSON-Anker (`#[schema(value_type = GeoJsonFeatureCollection)]`): die Anker-Struktur statt
// `unknown`.
export type _FeaturesNichtUnknown = Assert<
  unknown extends S['FachebeneAntwort']['features'] ? false : true
>;
export type _FcHatFeatures = Assert<
  'features' extends keyof S['GeoJsonFeatureCollection'] ? true : false
>;

// Pflicht-Anker (`#[schema(required)]`): `typ` wird trotz `#[serde(default)]` immer serialisiert,
// also nicht optional.
export type _OnlineStyleTypPflicht = Assert<
  undefined extends S['OnlineStyle']['typ'] ? false : true
>;
