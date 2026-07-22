// LFH-265: Typ-Ebenen-Pins für die aus Rust generierten Karten-Schemas.
// Läuft über `pnpm typecheck` (Schritt 4 von check-typ-codegen.sh) und den pre-push-Hook.
// REGELN (empirisch gemessen, siehe Commit-Body):
//  - jeder Assert-Alias MUSS exportiert sein — ein nicht-exportierter type-Alias feuert TS6196
//    unter `noUnusedLocals: true`.
//  - `@ts-expect-error` nur auf EXPORTIERTEN const-Bindungen und nur MIT Begründung (>=3 Zeichen),
//    sonst absorbiert TS6133 die Direktive (Test grün in beiden Zuständen) bzw. bricht
//    @typescript-eslint/ban-ts-comment das Lint-Gate.
import type { components } from './types.generated';

type S = components['schemas'];

export type Assert<T extends true> = T;

// Rauchprobe: das generierte Schema-Barrel ist überhaupt erreichbar und nicht leer/`never`.
export type _BarrelErreichbar = Assert<S extends object ? true : false>;

// ---------------------------------------------------------------------------
// KLASSE A — SCHEMA-ANKER-FELDER: LFH-265 ändert den generierten Typ dieser Felder.
// Die Asserts unterscheiden echt (vorher `string`/`unknown` → Assert<false> → TS2344),
// „Attribut entfernen → regenerieren → tsc rot" ist eine reale Mutationsprobe.
// ---------------------------------------------------------------------------

// Union-Anker (`#[schema(value_type = OnlineStyleTyp)]`): vorher `string`, danach
// `'vektor' | 'raster'`. `'quatsch' extends string` = true → Assert<false> vor der Änderung.
export type _FormatIstUnion = Assert<'quatsch' extends S['OfflineRegionConfig']['format'] ? false : true>;
export type _OfflineFormatIstUnion = Assert<
  'quatsch' extends NonNullable<S['KarteConfigAntwort']['offline_format']> ? false : true
>;
export type _OnlineQuelleTypIstUnion = Assert<'quatsch' extends S['OnlineQuelle']['typ'] ? false : true>;
export type _StatusIstUnion = Assert<'quatsch' extends S['OfflineKarte']['status'] ? false : true>;

// GeoJSON-Anker (`#[schema(value_type = GeoJsonFeatureCollection)]`): vorher `unknown`
// (jeder Typ extendet `unknown` → Assert<false>), danach die Anker-Struktur.
export type _FeaturesNichtUnknown = Assert<unknown extends S['FachebeneAntwort']['features'] ? false : true>;
export type _FcHatFeatures = Assert<'features' extends keyof S['GeoJsonFeatureCollection'] ? true : false>;

// Pflicht-Anker (`#[schema(required)]`): `typ` wird trotz `#[serde(default)]` immer
// serialisiert. Vorher `typ?: …` → `undefined extends` true → Assert<false>.
export type _OnlineStyleTypPflicht = Assert<undefined extends S['OnlineStyle']['typ'] ? false : true>;
