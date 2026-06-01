# Lagekarte: Online-Basemaps + Multi-View-Switcher — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bei aktivem „Online"-Basemap-Modus zwischen mehreren benannten Online-Views (Anbieter/Stile) umschalten, mit korrekter Pflicht-Attribution je View — Backend liefert eine Liste statt einer einzelnen Style-URL.

**Architecture:** Der Backend-Vertrag wechselt von `online_style_url: Option<String>` auf `online_styles: Vec<OnlineStyle>` (`{name, url, typ, attribution}`, `typ` = `vektor` | `raster`). `/api/karte/config` liefert die Liste; ist nichts konfiguriert, spielt der Server eine eingebaute, schlüsselfreie Shortlist aus. Im Frontend bleibt `basemapStil.ts` der pure, getestete Seam: Vektor-Views geben die Style-URL direkt an MapLibre, Raster-Views werden in einen `{type:'raster', tileSize:256}`-Style verpackt. Die Pflicht-Attribution ist **config-autoritativ** und läuft als einziger Kanal über `customAttribution` der MapLibre-`AttributionControl`, die `Kartenflaeche` bei View-Wechsel neu setzt.

**Tech Stack:** Rust (axum, clap, serde/serde_json, anyhow), React + TypeScript, MapLibre GL, antd, Vitest + Testing Library + MSW.

---

## Entwurfsentscheidungen (festgelegt)

1. **Vektor + Raster.** `OnlineStyle.typ` diskriminiert: `vektor` → URL-String direkt an MapLibre; `raster` → Tile-Template (`{z}/{y}/{x}`) **verbatim** in einen Raster-Style verpacken (MapLibre substituiert `{x}/{y}/{z}` namentlich; der Betreiber liefert die korrekte Reihenfolge im Template).
2. **Attribution config-autoritativ, ein Kanal.** Die je-View-Attribution wird **ausschließlich** über `customAttribution` der `AttributionControl` gesetzt (für Vektor UND Raster). Der Raster-Style schreibt **keine** `attribution` in die Source → keine Doppelanzeige. Vektor-Styles tragen zusätzlich ihre eigene Source-Attribution; Mehr-Attribution ist lizenzrechtlich unbedenklich.
3. **Eingebaute Shortlist.** Ohne Konfiguration liefert der **laufende Server** (nicht `KarteConfig::default()`) eine schlüsselfreie Default-Shortlist aus. `KarteConfig::default()` bleibt leer (Blind), damit die Integrationstests mit `build_router` (Default-Config) weiter Blind erwarten.
4. **Loud-Fail.** Malformed `LIFELINE_KARTE_STYLES`-JSON bricht den Serverstart hart ab (kein stiller Blind-Fallback).
5. **Backward-Compat (dünn).** Ist `LIFELINE_KARTE_STYLES` nicht gesetzt, aber das alte `LIFELINE_KARTE_STYLE_URL`, wird daraus ein Ein-Element-Vektor-View „Online" gebaut. Sind beide leer → Default-Shortlist.
6. **Degradation unverändert.** `onStyleFehler` stuft weiterhin online→offline→blind ab (kein View-internes Durchprobieren) — bewusst, um keine stille Regression einzuführen.

## File Structure

**Backend**
- `src/config.rs` — neuer `OnlineStyle`/`OnlineStyleTyp`-Typ (serde), `KarteConfig.online_styles: Vec<OnlineStyle>`, `default_online_styles()`, `online_styles_aufloesen()`, neuer clap-Arg `karte_styles` (`LIFELINE_KARTE_STYLES`). Verantwortung: Config-Typen + Auflösungslogik.
- `src/routes/karte.rs` — `KarteConfigAntwort.online_styles` statt `online_style_url`. Verantwortung: HTTP-Antwortform.
- `src/main.rs` — baut `KarteConfig` über `online_styles_aufloesen(...)`. Verantwortung: Verdrahtung Startup.
- `src/app.rs` — unverändert in Logik (nutzt `KarteConfig::default()`), kompiliert nach Feldumbenennung weiter.
- `tests/karte.rs` — Integrationstests auf neue Antwortform + Default-Blind.

**Frontend**
- `frontend/src/api/karte.ts` — `OnlineStyle`-Typ + `KarteServerConfig.online_styles`. Verantwortung: API-Vertrag (Typen).
- `frontend/src/pages/lagekarte/basemapStil.ts` — `baueOnlineStyle`, `rasterStyle`, `aktuelleAttribution`; `defaultModus`/`baueBasemapStyle` angepasst. Verantwortung: purer Style/Attribution-Seam (Unit-getestet).
- `frontend/src/pages/lagekarte/Kartenflaeche.tsx` — dynamische `AttributionControl` via `attribution`-Prop. Verantwortung: MapLibre-Runtime-Wiring.
- `frontend/src/pages/lagekarte/Sidebar.tsx` — Online-Sub-Switcher (antd `Select`). Verantwortung: UI.
- `frontend/src/pages/LagekartePage.tsx` — State `onlineStilName`, Auswahl + Verdrahtung. Verantwortung: Page-Orchestrierung.

**Tests (anzupassen)**
- `frontend/src/pages/lagekarte/basemapStil.test.ts`
- `frontend/src/pages/LagekartePage.test.tsx`

**Docs**
- `docs/betrieb/packaging.md` — neue ENV `LIFELINE_KARTE_STYLES`, Default-Shortlist, Raster-Hinweis.

---

## Task 1: Backend-Vertrag umstellen (OnlineStyle, Auflösung, Route)

Rust kompiliert nur, wenn alle `KarteConfig`-Nutzer gleichzeitig umgestellt werden. Diese Task ist daher eine kohärente Vertrags­änderung über `config.rs`, `routes/karte.rs`, `main.rs`, `tests/karte.rs`.

**Files:**
- Modify: `src/config.rs`
- Modify: `src/routes/karte.rs`
- Modify: `src/main.rs:68-71`
- Modify: `tests/karte.rs`

- [ ] **Step 1: Failing Unit-Tests in `src/config.rs` schreiben**

Im `mod tests` von `src/config.rs` (vor der schließenden `}` des Moduls) ergänzen:

```rust
    #[test]
    fn online_style_deserialisiert_mit_default_typ_vektor() {
        let s: OnlineStyle =
            serde_json::from_str(r#"{"name":"A","url":"https://x/s.json"}"#).unwrap();
        assert_eq!(s.name, "A");
        assert_eq!(s.url, "https://x/s.json");
        assert_eq!(s.typ, OnlineStyleTyp::Vektor); // typ fehlt → Default
        assert_eq!(s.attribution, None);
    }

    #[test]
    fn online_style_deserialisiert_raster_mit_attribution() {
        let s: OnlineStyle = serde_json::from_str(
            r#"{"name":"Top","url":"https://x/{z}/{y}/{x}.png","typ":"raster","attribution":"© BKG"}"#,
        )
        .unwrap();
        assert_eq!(s.typ, OnlineStyleTyp::Raster);
        assert_eq!(s.attribution.as_deref(), Some("© BKG"));
    }

    #[test]
    fn aufloesen_parst_json_liste() {
        let json = r#"[{"name":"A","url":"https://a"},{"name":"B","url":"https://b","typ":"raster"}]"#;
        let liste = online_styles_aufloesen(Some(json), None).unwrap();
        assert_eq!(liste.len(), 2);
        assert_eq!(liste[0].typ, OnlineStyleTyp::Vektor);
        assert_eq!(liste[1].typ, OnlineStyleTyp::Raster);
    }

    #[test]
    fn aufloesen_malformed_json_ist_fehler() {
        let err = online_styles_aufloesen(Some("kein json"), None);
        assert!(err.is_err());
    }

    #[test]
    fn aufloesen_faellt_auf_single_url_zurueck() {
        let liste = online_styles_aufloesen(None, Some("https://einzel/style.json")).unwrap();
        assert_eq!(liste.len(), 1);
        assert_eq!(liste[0].name, "Online");
        assert_eq!(liste[0].url, "https://einzel/style.json");
        assert_eq!(liste[0].typ, OnlineStyleTyp::Vektor);
    }

    #[test]
    fn aufloesen_ohne_config_liefert_default_shortlist() {
        let liste = online_styles_aufloesen(None, None).unwrap();
        assert!(liste.len() >= 3, "Default-Shortlist sollte mehrere Views haben");
        assert!(liste.iter().any(|s| s.typ == OnlineStyleTyp::Raster), "mind. ein Raster-View");
    }

    #[test]
    fn default_karte_config_ist_leer_blind() {
        let k = KarteConfig::default();
        assert!(k.online_styles.is_empty());
        assert!(k.pmtiles_path.is_none());
    }
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen (Compile-Fehler: Typen unbekannt)**

Run: `cargo test --lib config:: 2>&1 | tail -20`
Expected: FAIL — `cannot find type OnlineStyle` / `online_styles_aufloesen not found`.

- [ ] **Step 3: `src/config.rs` implementieren**

Oben in `src/config.rs` den serde-Import ergänzen (nach `use clap::{Parser, Subcommand};`):

```rust
use serde::{Deserialize, Serialize};
```

Den `KarteConfig`-Block (aktuell Zeilen 28–34) ersetzen durch:

```rust
/// Typ eines Online-Views: Vektor-Style-JSON (URL direkt an MapLibre) oder
/// Raster-Tile-Template (`{z}/{y}/{x}`), das das Frontend in einen Raster-Style verpackt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum OnlineStyleTyp {
    #[default]
    Vektor,
    Raster,
}

/// Ein benannter Online-Basemap-View. `attribution` ist die config-autoritative
/// Pflicht-Attribution, die das Frontend per `customAttribution` anzeigt.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct OnlineStyle {
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub typ: OnlineStyleTyp,
    #[serde(default)]
    pub attribution: Option<String>,
}

/// Karten-/Basemap-Konfiguration, die zur Laufzeit an die Karte-Routen geht.
/// `Default` (leer/None) → kein Tile-Service, Frontend geht in den Blind-Modus.
/// Die eingebaute Default-Shortlist wird NICHT hier, sondern erst beim Serverstart
/// über `online_styles_aufloesen` injiziert (Tests mit `build_router` bleiben Blind).
#[derive(Clone, Debug, Default)]
pub struct KarteConfig {
    pub pmtiles_path: Option<String>,
    pub online_styles: Vec<OnlineStyle>,
}

/// Eingebaute, schlüsselfreie Default-Shortlist (alle ohne API-Key, MapLibre-GL-tauglich,
/// behördlich/kommerziell nutzbar — Stand Recherche 30.05.2026).
pub fn default_online_styles() -> Vec<OnlineStyle> {
    vec![
        OnlineStyle {
            name: "OpenFreeMap Liberty".into(),
            url: "https://tiles.openfreemap.org/styles/liberty".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© OpenMapTiles © OpenStreetMap-Mitwirkende".into()),
        },
        OnlineStyle {
            name: "basemap.de Farbe".into(),
            url: "https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_col.json".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© GeoBasis-DE / BKG (2026) CC BY 4.0".into()),
        },
        OnlineStyle {
            name: "basemap.de Grau".into(),
            url: "https://sgx.geodatenzentrum.de/gdz_basemapde_vektor/styles/bm_web_gry.json".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© GeoBasis-DE / BKG (2026) CC BY 4.0".into()),
        },
        OnlineStyle {
            name: "OpenFreeMap Dark".into(),
            url: "https://tiles.openfreemap.org/styles/dark".into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: Some("© OpenMapTiles © OpenStreetMap-Mitwirkende".into()),
        },
        OnlineStyle {
            name: "TopPlusOpen (Topographie)".into(),
            url: "https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png".into(),
            typ: OnlineStyleTyp::Raster,
            attribution: Some("© GeoBasis-DE / BKG (2026), TopPlusOpen".into()),
        },
    ]
}

/// Bestimmt die Online-Views beim Serverstart. Präzedenz:
/// 1. `LIFELINE_KARTE_STYLES` (JSON-Liste) — bei Malformed JSON HARTER Fehler.
/// 2. sonst altes `LIFELINE_KARTE_STYLE_URL` → Ein-Element-Vektor-View „Online".
/// 3. sonst eingebaute Default-Shortlist.
pub fn online_styles_aufloesen(
    styles_json: Option<&str>,
    single_url: Option<&str>,
) -> anyhow::Result<Vec<OnlineStyle>> {
    if let Some(json) = styles_json {
        let liste: Vec<OnlineStyle> = serde_json::from_str(json)
            .map_err(|e| anyhow::anyhow!("LIFELINE_KARTE_STYLES ist kein gültiges JSON: {e}"))?;
        return Ok(liste);
    }
    if let Some(url) = single_url {
        return Ok(vec![OnlineStyle {
            name: "Online".into(),
            url: url.into(),
            typ: OnlineStyleTyp::Vektor,
            attribution: None,
        }]);
    }
    Ok(default_online_styles())
}
```

In `struct Config` direkt nach dem bestehenden `karte_online_style_url`-Feld (Zeilen 66–68) den neuen Arg ergänzen:

```rust
    /// Mehrere Online-Views als JSON-Liste: `[{"name":..,"url":..,"typ":"vektor|raster","attribution":..}]`.
    /// Hat Vorrang vor `--karte-online-style-url`. Fehlt beides, liefert der Server die Default-Shortlist.
    #[arg(long, env = "LIFELINE_KARTE_STYLES")]
    pub karte_styles: Option<String>,
```

- [ ] **Step 4: `src/routes/karte.rs` auf Liste umstellen**

`KarteConfigAntwort` (Zeilen 8–14) und `config()` (Zeilen 17–24) ersetzen durch:

```rust
use crate::config::{KarteConfig, OnlineStyle};
use axum::http::StatusCode;
use axum::{Extension, Json};
use serde::Serialize;

/// Antwort von `GET /api/karte/config`. Liefert NUR, was die Karte zur Laufzeit
/// braucht — NICHT den Server-Dateipfad der PMTiles-Datei.
#[derive(Debug, Serialize)]
pub struct KarteConfigAntwort {
    pub online_styles: Vec<OnlineStyle>,
    pub pmtiles_verfuegbar: bool,
    /// Relative URL des Tile-Endpoints, wenn eine PMTiles-Datei konfiguriert ist.
    pub pmtiles_url: Option<String>,
}

/// GET /api/karte/config — Basemap-Verfügbarkeit fürs Frontend.
pub async fn config(Extension(karte): Extension<KarteConfig>) -> Json<KarteConfigAntwort> {
    let pmtiles_verfuegbar = karte.pmtiles_path.is_some();
    Json(KarteConfigAntwort {
        online_styles: karte.online_styles.clone(),
        pmtiles_verfuegbar,
        pmtiles_url: pmtiles_verfuegbar.then(|| "/api/karte/tiles.pmtiles".to_string()),
    })
}
```

(Die `tiles_fehlt`-Funktion am Dateiende bleibt unverändert. Der bestehende `use crate::config::KarteConfig;` in Zeile 1 wird durch den `use ...{KarteConfig, OnlineStyle};` oben ersetzt — nicht doppelt importieren.)

- [ ] **Step 5: `src/main.rs` verdrahten**

`src/main.rs:68-71` ersetzen:

```rust
    let karte = lifeline_hub::config::KarteConfig {
        pmtiles_path: config.pmtiles_path.clone(),
        online_styles: lifeline_hub::config::online_styles_aufloesen(
            config.karte_styles.as_deref(),
            config.karte_online_style_url.as_deref(),
        )?,
    };
```

- [ ] **Step 6: `tests/karte.rs` anpassen**

Zeile 24 (`tiles_route_liefert_range_aus`):

```rust
        KarteConfig { pmtiles_path: Some(pfad), online_styles: vec![] },
```

Block in `config_endpoint_meldet_verfuegbarkeit` (Zeilen 53–67) ersetzen durch:

```rust
    let app = build_router_mit_karte(
        AppState { pool, live: LiveHub::new() },
        KarteConfig {
            pmtiles_path: Some("/irrelevant.pmtiles".into()),
            online_styles: vec![lifeline_hub::config::OnlineStyle {
                name: "Online".into(),
                url: "https://tiles.example/style.json".into(),
                typ: lifeline_hub::config::OnlineStyleTyp::Vektor,
                attribution: None,
            }],
        },
    );
    let req = Request::builder().uri("/api/karte/config").body(Body::empty()).unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(res.into_body(), 4096).await.unwrap();
    let v: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(v["pmtiles_verfuegbar"].as_bool(), Some(true));
    assert_eq!(v["pmtiles_url"].as_str(), Some("/api/karte/tiles.pmtiles"));
    assert_eq!(v["online_styles"][0]["url"].as_str(), Some("https://tiles.example/style.json"));
    assert_eq!(v["online_styles"][0]["typ"].as_str(), Some("vektor"));
```

In `config_endpoint_blind_modus_ohne_konfiguration` (Zeile 81) ersetzen:

```rust
    assert!(v["online_styles"].as_array().unwrap().is_empty());
```

- [ ] **Step 7: Gesamte Backend-Suite grün**

Run: `cargo test 2>&1 | tail -20`
Expected: PASS (alle Tests, inkl. neuer config-Tests und angepasster `tests/karte.rs`).

- [ ] **Step 8: Commit**

```bash
git add src/config.rs src/routes/karte.rs src/main.rs tests/karte.rs
git commit -m "feat(be): Online-Basemaps als Liste (OnlineStyle) + Default-Shortlist (LFH-29)"
```

---

## Task 2: Frontend-Typen + purer Style/Attribution-Seam

**Files:**
- Modify: `frontend/src/api/karte.ts`
- Modify: `frontend/src/pages/lagekarte/basemapStil.ts`
- Test: `frontend/src/pages/lagekarte/basemapStil.test.ts`

- [ ] **Step 1: `frontend/src/api/karte.ts` auf die Liste umstellen**

Datei komplett ersetzen:

```ts
import { apiGet } from './client';

export type OnlineStyleTyp = 'vektor' | 'raster';

/** Ein benannter Online-Basemap-View (vom Backend geliefert). */
export interface OnlineStyle {
  name: string;
  url: string;
  typ: OnlineStyleTyp;
  attribution: string | null;
}

/** Was die Karte zur Laufzeit über die Basemap-Verfügbarkeit wissen muss. */
export interface KarteServerConfig {
  online_styles: OnlineStyle[];
  pmtiles_verfuegbar: boolean;
  pmtiles_url: string | null;
}

export function ladeKarteConfig(): Promise<KarteServerConfig> {
  return apiGet<KarteServerConfig>('/api/karte/config');
}
```

- [ ] **Step 2: Failing Tests in `basemapStil.test.ts` schreiben**

Datei komplett ersetzen:

```ts
import { describe, expect, it } from 'vitest';
import {
  aktuelleAttribution,
  baueBasemapStyle,
  baueOnlineStyle,
  blindStyle,
  defaultModus,
  offlineStyle,
} from './basemapStil';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';

const vektorView: OnlineStyle = {
  name: 'A', url: 'https://tiles.example/style.json', typ: 'vektor', attribution: '© A',
};
const rasterView: OnlineStyle = {
  name: 'Top', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG',
};

const beides: KarteServerConfig = {
  online_styles: [vektorView],
  pmtiles_verfuegbar: true,
  pmtiles_url: '/api/karte/tiles.pmtiles',
};
const nurOffline: KarteServerConfig = {
  online_styles: [], pmtiles_verfuegbar: true, pmtiles_url: '/api/karte/tiles.pmtiles',
};
const leer: KarteServerConfig = { online_styles: [], pmtiles_verfuegbar: false, pmtiles_url: null };

describe('basemapStil', () => {
  it('blindStyle rendert nur einen Hintergrund-Layer', () => {
    const s = blindStyle('dark');
    expect(s.layers).toHaveLength(1);
    expect(s.layers[0].type).toBe('background');
  });

  it('offlineStyle referenziert die pmtiles-Source', () => {
    const s = offlineStyle('light', '/api/karte/tiles.pmtiles');
    expect(JSON.stringify(s.sources)).toContain('pmtiles://');
    expect(s.layers.some((l) => l.type === 'symbol')).toBe(false);
  });

  it('baueOnlineStyle: Vektor liefert die URL als String', () => {
    expect(baueOnlineStyle(vektorView)).toBe('https://tiles.example/style.json');
  });

  it('baueOnlineStyle: Raster verpackt das Template in einen Raster-Style', () => {
    const s = baueOnlineStyle(rasterView);
    expect(typeof s).toBe('object');
    const style = s as { sources: Record<string, { type: string; tiles: string[]; tileSize: number }> };
    const src = style.sources.raster;
    expect(src.type).toBe('raster');
    expect(src.tiles).toEqual(['https://x/{z}/{y}/{x}.png']); // verbatim, NICHT normalisiert
    expect(src.tileSize).toBe(256);
    // Attribution NICHT in der Source (läuft über customAttribution) → keine Doppelanzeige.
    expect(JSON.stringify(src)).not.toContain('© BKG');
  });

  it('online-Modus mit View liefert dessen Style', () => {
    expect(baueBasemapStyle('online', 'light', beides, vektorView)).toBe('https://tiles.example/style.json');
  });

  it('online ohne View → Blind-Fallback', () => {
    const s = baueBasemapStyle('online', 'light', leer, undefined);
    expect(typeof s).toBe('object');
    expect((s as { layers: unknown[] }).layers).toHaveLength(1);
  });

  it('defaultModus: online (Liste nicht leer) vor offline vor blind', () => {
    expect(defaultModus(beides)).toBe('online');
    expect(defaultModus(nurOffline)).toBe('offline');
    expect(defaultModus(leer)).toBe('blind');
  });

  it('aktuelleAttribution: online liefert View-Attribution, sonst null', () => {
    expect(aktuelleAttribution('online', vektorView)).toBe('© A');
    expect(aktuelleAttribution('online', undefined)).toBeNull();
    expect(aktuelleAttribution('offline', vektorView)).toBeNull();
    expect(aktuelleAttribution('blind', rasterView)).toBeNull();
  });
});
```

- [ ] **Step 3: Tests laufen lassen — müssen fehlschlagen**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/basemapStil.test.ts 2>&1 | tail -20`
Expected: FAIL — `baueOnlineStyle`/`aktuelleAttribution` nicht exportiert, `online_styles` unbekannt.

- [ ] **Step 4: `basemapStil.ts` implementieren**

Den Import in Zeile 1–2 erweitern und die Funktionen `defaultModus`/`baueBasemapStyle` (Zeilen 53–72) ersetzen; `blindStyle`/`offlineStyle`/`FARBEN` bleiben unverändert.

Import-Block oben:

```ts
import type { StyleSpecification } from 'maplibre-gl';
import type { KarteServerConfig, OnlineStyle } from '../../api/karte';
```

Am Dateiende (ersetzt die bisherigen `defaultModus` + `baueBasemapStyle`):

```ts
/** Default-Modus nach Verfügbarkeit: online → offline → blind. */
export function defaultModus(config: KarteServerConfig | undefined): BasemapModus {
  if (config && config.online_styles.length > 0) return 'online';
  if (config?.pmtiles_verfuegbar) return 'offline';
  return 'blind';
}

/** Verpackt ein Raster-Tile-Template (`{z}/{y}/{x}`) in einen MapLibre-Raster-Style.
 *  URL wird VERBATIM durchgereicht; Attribution läuft NICHT über die Source,
 *  sondern config-autoritativ über `customAttribution` (siehe aktuelleAttribution). */
function rasterStyle(stil: OnlineStyle): StyleSpecification {
  return {
    version: 8,
    sources: {
      raster: { type: 'raster', tiles: [stil.url], tileSize: 256 },
    },
    layers: [{ id: 'raster', type: 'raster', source: 'raster' }],
  } as StyleSpecification;
}

/** Style für einen Online-View: Vektor → URL-String, Raster → verpackter Raster-Style. */
export function baueOnlineStyle(stil: OnlineStyle): StyleSpecification | string {
  if (stil.typ === 'raster') return rasterStyle(stil);
  return stil.url;
}

/**
 * Wählt den Style passend zu Modus + Theme + Verfügbarkeit. Im Online-Modus wird der
 * übergebene View verwendet; fehlt er → Blind-Style. Offline → pmtiles-Style.
 */
export function baueBasemapStyle(
  modus: BasemapModus,
  theme: KartenTheme,
  config: KarteServerConfig | undefined,
  onlineStil: OnlineStyle | undefined,
): StyleSpecification | string {
  if (modus === 'online' && onlineStil) return baueOnlineStyle(onlineStil);
  if (modus === 'offline' && config?.pmtiles_url) return offlineStyle(theme, config.pmtiles_url);
  return blindStyle(theme);
}

/** Config-autoritative Pflicht-Attribution des aktiven Views (nur online). */
export function aktuelleAttribution(
  modus: BasemapModus,
  onlineStil: OnlineStyle | undefined,
): string | null {
  if (modus === 'online' && onlineStil) return onlineStil.attribution;
  return null;
}
```

- [ ] **Step 5: Tests grün**

Run: `cd frontend && pnpm vitest run src/pages/lagekarte/basemapStil.test.ts 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api/karte.ts frontend/src/pages/lagekarte/basemapStil.ts frontend/src/pages/lagekarte/basemapStil.test.ts
git commit -m "feat(fe): OnlineStyle-Liste + Raster-Wrap + Attribution-Seam (LFH-29)"
```

---

## Task 3: Kartenflaeche — dynamische AttributionControl

`Kartenflaeche` ist WebGL-gebunden und in Page-Tests gemockt → die AttributionControl-Verdrahtung wird **manuell im Browser** verifiziert (Task 7), nicht per Unit-Test. Diese Task ändert nur Implementierung.

**Files:**
- Modify: `frontend/src/pages/lagekarte/Kartenflaeche.tsx`

- [ ] **Step 1: `attribution`-Prop einführen**

In `KartenflaecheProps` (nach `onStyleFehler`, ca. Zeile 29) ergänzen:

```tsx
  /** Config-autoritative Pflicht-Attribution des aktiven Online-Views (null = keine). */
  attribution?: string | null;
```

Die Destrukturierung in der Komponenten-Signatur (Zeilen 85–88) um `attribution` erweitern:

```tsx
export default function Kartenflaeche({
  style, markers, onKarteKlick, onMarkerKlick, flyToZiel, onStyleFehler, attribution,
  flaechen, zeichnen, onFlaecheGezeichnet, onFlaecheKlick,
}: KartenflaecheProps) {
```

- [ ] **Step 2: Ref für die AttributionControl anlegen**

Nach `const stilGeladenRef = useRef(false);` (ca. Zeile 94) ergänzen:

```tsx
  // Eigene AttributionControl (statt der eingebauten), damit customAttribution je View
  // gesetzt werden kann. Wird bei Attribution-Wechsel entfernt und neu hinzugefügt.
  const attribControlRef = useRef<maplibregl.AttributionControl | null>(null);
```

- [ ] **Step 3: Eingebaute AttributionControl bei Init abschalten**

Im `new maplibregl.Map({...})` (Zeile 112) `attributionControl: { compact: true }` ersetzen durch:

```tsx
      attributionControl: false,
```

- [ ] **Step 4: Effekt für die dynamische AttributionControl**

Direkt **nach** dem Style-Wechsel-Effekt (`map.setStyle(style)`, endet ca. Zeile 139) einfügen:

```tsx
  // AttributionControl je nach aktivem View neu setzen (config-autoritativ). MapLibre
  // bietet keinen Setter für customAttribution → Control entfernen und neu anlegen.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (attribControlRef.current) {
      map.removeControl(attribControlRef.current);
      attribControlRef.current = null;
    }
    const ctrl = new maplibregl.AttributionControl({
      compact: true,
      customAttribution: attribution ?? '',
    });
    map.addControl(ctrl);
    attribControlRef.current = ctrl;
  }, [attribution]);
```

- [ ] **Step 5: Kompiliert + Lint sauber**

Run: `cd frontend && pnpm tsc --noEmit 2>&1 | tail -20 && pnpm eslint src/pages/lagekarte/Kartenflaeche.tsx 2>&1 | tail -20`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/lagekarte/Kartenflaeche.tsx
git commit -m "feat(fe): dynamische AttributionControl je Online-View (LFH-29)"
```

---

## Task 4: Sidebar — Online-Sub-Switcher

**Files:**
- Modify: `frontend/src/pages/lagekarte/Sidebar.tsx`

- [ ] **Step 1: Import + Props erweitern**

Zeile 1 (antd-Import) um `Select` ergänzen:

```tsx
import { Badge, Button, Card, Empty, InputNumber, List, Radio, Select, Space, Switch, Tooltip, Typography } from 'antd';
```

Zeile 4 (Typ-Import) um `OnlineStyle` ergänzen — `OnlineStyle` kommt aus der API:

```tsx
import type { BasemapModus } from './basemapStil';
import type { OnlineStyle } from '../../api/karte';
```

In `SidebarProps` (nach `onlineVerfuegbar` / `offlineVerfuegbar`, Zeilen 44–45) ergänzen:

```tsx
  onlineStyles: OnlineStyle[];
  onlineStilName: string | null;
  onOnlineStilWechsel: (name: string) => void;
```

- [ ] **Step 2: Sub-Switcher in der Basemap-Card rendern**

Im „Basemap"-`Card` direkt **nach** der `</Radio.Group>` (vor `{props.basemap === 'blind' && ...}`, ca. Zeile 240) einfügen:

```tsx
        {props.basemap === 'online' && props.onlineStyles.length > 1 && (
          <Select
            size="small"
            aria-label="Online-Ansicht"
            style={{ width: '100%', marginTop: 8 }}
            value={props.onlineStilName ?? props.onlineStyles[0]?.name}
            onChange={(name) => props.onOnlineStilWechsel(name)}
            options={props.onlineStyles.map((s) => ({ label: s.name, value: s.name }))}
          />
        )}
```

- [ ] **Step 3: Kompiliert + Lint sauber**

Run: `cd frontend && pnpm tsc --noEmit 2>&1 | tail -20 && pnpm eslint src/pages/lagekarte/Sidebar.tsx 2>&1 | tail -20`
Expected: keine Fehler. (Die Page übergibt die neuen Props erst in Task 5 — `tsc` kann hier noch über fehlende Props in `LagekartePage.tsx` meckern; das wird in Task 5 geschlossen. Reihenfolge ist bewusst: Sidebar-Prop-Erweiterung zuerst.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/lagekarte/Sidebar.tsx
git commit -m "feat(fe): Online-Sub-Switcher (Select) in der Sidebar (LFH-29)"
```

---

## Task 5: Page-Verdrahtung + Page-Tests

**Files:**
- Modify: `frontend/src/pages/LagekartePage.tsx`
- Test: `frontend/src/pages/LagekartePage.test.tsx`

- [ ] **Step 1: Failing/angepasste Page-Tests schreiben**

In `LagekartePage.test.tsx`:

(a) Kartenflaeche-Mock (Zeilen 16–46) um eine Attribution-Anzeige erweitern — direkt nach `<div data-testid="kartenflaeche-stub">` einfügen:

```tsx
      <div data-testid="attribution">{props.attribution ?? ''}</div>
```

(b) Default-Config in `basisHandler` (Zeile 184) ersetzen:

```tsx
  config: KarteServerConfig = { online_styles: [], pmtiles_verfuegbar: false, pmtiles_url: null },
```

(c) Alle Test-Configs mit `online_style_url: 'https://x/style.json'` (Zeilen ~270 und ~309) ersetzen durch:

```tsx
      online_styles: [{ name: 'Online', url: 'https://x/style.json', typ: 'vektor', attribution: '© X' }],
```

(d) Die „nur Offline"-Config (Zeile ~323) ersetzen durch:

```tsx
      online_styles: [],
```

(e) Neuen Test ans Ende des `describe`-Blocks (vor der schließenden `});` von `describe('LagekartePage'`) anfügen:

```tsx
  it('Online-Sub-Switcher: zwischen zwei Views wechseln aktualisiert die Attribution', async () => {
    basisHandler([], {
      online_styles: [
        { name: 'Liberty', url: 'https://x/liberty', typ: 'vektor', attribution: '© Liberty' },
        { name: 'TopPlus', url: 'https://x/{z}/{y}/{x}.png', typ: 'raster', attribution: '© BKG' },
      ],
      pmtiles_verfuegbar: false,
      pmtiles_url: null,
    });
    const user = userEvent.setup();
    renderSeite();
    await screen.findByText('marker-schaden-9');
    // Default-View ist der erste (Liberty) → dessen Attribution liegt an.
    expect(screen.getByTestId('attribution')).toHaveTextContent('© Liberty');
    // Sub-Switcher (Select) öffnen und TopPlus wählen. Es gibt nur EINE Combobox auf der
    // Seite (die InputNumber-Felder sind spinbutton) → Query ohne name ist eindeutig und
    // umgeht die v5-abhängige aria-label-Durchreichung.
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText('TopPlus'));
    await waitFor(() => expect(screen.getByTestId('attribution')).toHaveTextContent('© BKG'));
  });
```

- [ ] **Step 2: Tests laufen lassen — müssen fehlschlagen**

Run: `cd frontend && pnpm vitest run src/pages/LagekartePage.test.tsx 2>&1 | tail -30`
Expected: FAIL — `online_styles` nicht verdrahtet, kein Sub-Switcher, Attribution-Prop nicht gesetzt; ggf. Typfehler.

- [ ] **Step 3: `LagekartePage.tsx` verdrahten**

(a) Import (Zeile 25) ersetzen:

```tsx
import { baueBasemapStyle, defaultModus, aktuelleAttribution, type BasemapModus } from './lagekarte/basemapStil';
```

(b) State nach `const [basemap, setBasemap] = useState<BasemapModus | null>(null);` (Zeile 59) ergänzen:

```tsx
  const [onlineStilName, setOnlineStilName] = useState<string | null>(null);
```

(c) Default-Effekt (Zeilen 98–100) ersetzen:

```tsx
  // Basemap-Default + Default-Online-View setzen, sobald Config da ist.
  useEffect(() => {
    if (basemap == null && configQuery.data) setBasemap(defaultModus(configQuery.data));
    if (onlineStilName == null && configQuery.data?.online_styles.length) {
      setOnlineStilName(configQuery.data.online_styles[0].name);
    }
  }, [basemap, onlineStilName, configQuery.data]);
```

(d) Den `style`-`useMemo` (Zeilen 178–181) ersetzen und direkt darunter `onlineStil` + `attribution` ergänzen:

```tsx
  const onlineStil = useMemo(() => {
    const liste = configQuery.data?.online_styles ?? [];
    return liste.find((s) => s.name === onlineStilName) ?? liste[0];
  }, [configQuery.data, onlineStilName]);

  const style = useMemo(
    () => baueBasemapStyle(basemap ?? 'blind', effektiv, configQuery.data, onlineStil),
    [basemap, effektiv, configQuery.data, onlineStil],
  );

  const attribution = useMemo(
    () => aktuelleAttribution(basemap ?? 'blind', onlineStil),
    [basemap, onlineStil],
  );
```

(e) `<Sidebar ...>` (Zeilen 302–306) — die `onlineVerfuegbar`-Zeile ersetzen und die drei neuen Props ergänzen:

```tsx
        basemap={basemap ?? 'blind'}
        onBasemapWechsel={setBasemap}
        onMarkerWaehlen={onMarkerWaehlen}
        onlineVerfuegbar={(configQuery.data?.online_styles.length ?? 0) > 0}
        offlineVerfuegbar={!!configQuery.data?.pmtiles_verfuegbar}
        onlineStyles={configQuery.data?.online_styles ?? []}
        onlineStilName={onlineStilName}
        onOnlineStilWechsel={setOnlineStilName}
```

(f) `<Kartenflaeche ...>` (ab Zeile 309) das `style`-Prop um `attribution` ergänzen — direkt nach `style={style}`:

```tsx
          style={style}
          attribution={attribution}
```

- [ ] **Step 4: Page-Tests grün**

Run: `cd frontend && pnpm vitest run src/pages/LagekartePage.test.tsx 2>&1 | tail -30`
Expected: PASS (alle, inkl. neuem Sub-Switcher-Test).

- [ ] **Step 5: tsc + Lint gesamt**

Run: `cd frontend && pnpm tsc --noEmit 2>&1 | tail -20 && pnpm eslint src 2>&1 | tail -20`
Expected: keine Fehler.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LagekartePage.tsx frontend/src/pages/LagekartePage.test.tsx
git commit -m "feat(fe): Page-Verdrahtung Online-Multi-View + Attribution (LFH-29)"
```

---

## Task 6: Doku aktualisieren

**Files:**
- Modify: `docs/betrieb/packaging.md:39,69`

- [ ] **Step 1: ENV-Tabelle + Beschreibung ergänzen**

In der ENV-Tabelle (Zeile 39) eine Zeile **über** `--karte-online-style-url` einfügen:

```markdown
| `--karte-styles` | `LIFELINE_KARTE_STYLES` | *(Default-Shortlist)* | JSON-Liste benannter Online-Views: `[{"name","url","typ":"vektor\|raster","attribution"}]`. Hat Vorrang vor `--karte-online-style-url`. |
```

Im Fließtext bei `--karte-online-style-url` (Zeile 69) ergänzen:

```markdown
- **`--karte-styles` / `LIFELINE_KARTE_STYLES`** — mehrere Online-Views als JSON-Liste.
  Jeder View: `name` (Anzeigename im Switcher), `url` (Vektor-Style-JSON-URL **oder**
  Raster-Tile-Template mit `{z}/{y}/{x}`), `typ` (`vektor` Default | `raster`),
  `attribution` (Pflicht-Attribution, wird je View angezeigt). Fehlt diese ENV **und**
  `LIFELINE_KARTE_STYLE_URL`, liefert der Server eine eingebaute schlüsselfreie Shortlist
  (OpenFreeMap, basemap.de, TopPlusOpen). `--karte-online-style-url` bleibt als
  Einzel-URL-Kurzform erhalten (→ Ein-Element-Liste „Online").
```

- [ ] **Step 2: Commit**

```bash
git add docs/betrieb/packaging.md
git commit -m "docs(betrieb): LIFELINE_KARTE_STYLES + Default-Shortlist dokumentiert (LFH-29)"
```

---

## Task 7: Gesamtverifikation + manueller Browser-Check

- [ ] **Step 1: Backend-Suite grün**

Run: `cargo test 2>&1 | tail -15`
Expected: PASS.

- [ ] **Step 2: Frontend-Suite grün (stabil, ohne Parallel-Flakiness)**

Run: `cd frontend && pnpm vitest run --no-file-parallelism 2>&1 | tail -25`
Expected: PASS. (`--no-file-parallelism` per Memory „Frontend-Testsuite Parallel-Timeouts".)

- [ ] **Step 3: tsc + Lint gesamt**

Run: `cd frontend && pnpm tsc --noEmit && pnpm eslint src 2>&1 | tail -15`
Expected: keine Fehler.

- [ ] **Step 4: Frontend bauen + Server neu starten (rust-embed)**

Da das Frontend ins Binary eingebettet ist (Memory „Frontend ins Binary eingebettet"), muss vor dem manuellen Check gebaut werden:

Run: `cd frontend && pnpm build && cd .. && cargo run` (mit gesetztem `LIFELINE_KARTE_STYLES` oder ohne → Default-Shortlist)
Expected: Server startet; `/api/karte/config` liefert die `online_styles`-Liste.

- [ ] **Step 5: Manuelle Akzeptanz im Browser (Akzeptanzkriterien LFH-29)**

Auf einer Lagekarte eines aktiven Einsatzes prüfen:
- Basemap auf **Online** → der Sub-Switcher (Select) erscheint und listet mehrere Views.
- View wechseln (Vektor → z. B. basemap.de Farbe; Raster → TopPlusOpen) → Kartenbild ändert sich; **Attribution unten rechts** zeigt die zum View gehörende Pflicht-Attribution.
- Raster-View (TopPlusOpen) rendert Kacheln korrekt (richtige `{z}/{y}/{x}`-Reihenfolge, keine versetzten/leeren Kacheln).
- Loud-Fail: Server mit `LIFELINE_KARTE_STYLES='kein json'` starten → Start bricht mit klarer Meldung ab (kein stiller Blind-Modus).

- [ ] **Step 6: Verifikation vor „fertig"**

REQUIRED SUB-SKILL: `superpowers:verification-before-completion` durchlaufen, bevor der Task als erledigt gemeldet wird.

---

## Self-Review

**Spec-Abdeckung (Akzeptanzkriterien LFH-29):**
- „Mehrere Online-Views konfigurierbar; Nutzer schaltet bei Online um" → Task 1 (Backend-Liste), Task 4 (Sub-Switcher), Task 5 (State/Verdrahtung). ✅
- „Korrekte Pflicht-Attribution je View (customAttribution)" → Task 2 (`aktuelleAttribution`), Task 3 (dynamische `AttributionControl`), Task 5 (Prop-Verdrahtung), Task 7 (Browser-Check). ✅
- „Raster-Quellen als `type: raster, tileSize: 256` verpacken, `{z}/{y}/{x}` beachten" → Task 2 (`rasterStyle`, verbatim-URL + Test). ✅
- „Key-basierte Anbieter nicht mit Secret im Frontend" → eingehalten: Default-Shortlist ist schlüsselfrei; ENV erlaubt nur URL/Template, kein Secret-Handling im FE (dokumentiert Task 6). ✅
- Backend-Referenzen `src/config.rs`, `src/routes/karte.rs` → Task 1. Frontend-Referenzen `basemapStil.ts`, `Sidebar.tsx`, `LagekartePage.tsx`, `api/karte.ts` → Tasks 2/4/5. ✅

**Typ-Konsistenz:** `OnlineStyle{name,url,typ,attribution}` identisch in Rust (`config.rs`) und TS (`api/karte.ts`); `typ`-Werte `"vektor"|"raster"` (serde `rename_all="lowercase"` ↔ TS-Literaltyp). `online_styles` einheitlich in `KarteConfig`, `KarteConfigAntwort`, `KarteServerConfig`, `defaultModus`, Page, Tests. `baueBasemapStyle(modus,theme,config,onlineStil)`-Signatur konsistent zwischen `basemapStil.ts` und Aufruf in `LagekartePage.tsx`. `attribution`-Prop konsistent zwischen `Kartenflaeche`, Page und Mock.

**Placeholder-Scan:** Keine TBD/TODO/„handle edge cases" — alle Code-Schritte enthalten vollständigen Code.
