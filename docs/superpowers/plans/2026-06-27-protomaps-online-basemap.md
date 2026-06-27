# Protomaps-Online-Basemap (beschriftet, key-sicher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protomaps als **beschriftete**, **key-sichere** Online-Basemap nutzbar machen — Admin trägt die Protomaps-TileJSON-URL (inkl. Key) ein, der Key bleibt serverseitig (LFH-182-Proxy), das Frontend baut den Style aus unseren Protomaps-Layern + Orts-/Straßennamen-Labels.

**Architecture:** Neuer Online-Quellen-Typ `protomaps`. Registrierung erzwingt `proxy=true`. `/api/karte/config` liefert für diesen Typ eine key-freie proxied TileJSON-URL über einen neuen **slot-losen** `/tilejson`-Entry-Endpunkt (nutzt das vorhandene `hole_tilejson`/`rewrite_tilejson`). Das Frontend erkennt `typ=protomaps` und baut den beschrifteten Style mit öffentlichen Protomaps-Glyphs.

**Tech Stack:** Rust (axum, reqwest, sqlx), React/TS (antd, MapLibre-GL, vitest). Wiederverwendet LFH-182 (Proxy) + `offlineStyle()` (LFH-181).

## Global Constraints

- **Key NIE im Frontend.** `typ=protomaps` ⇒ `proxy=true` **erzwungen** (Registrierung + Config-Handler); `/config` gibt für protomaps nie die Upstream-URL aus.
- **Kein `cargo fmt`.** Repo ist nicht rustfmt-clean; von Hand im Bestandsstil editieren. Rust-Gate = `cargo test`. Ehrlicher Exit via `rtk proxy cargo test` (kein `| tail`).
- **pnpm via mise:** `mise exec pnpm@11.0.9 -- pnpm -C <ABS>/frontend …`, absolute Pfade.
- **Lint:** `pnpm lint` mit `--max-warnings 0`. `tsc --noEmit` als eigenes Gate.
- **Frontend ins Binary (rust-embed):** Browser-Smoke braucht `pnpm build` + Neustart; Vitest nicht.
- **MapLibre-Layer in jsdom nicht render-/typprüfbar** — Vitest prüft das Style-OBJEKT (Layer/Quelle/glyphs), echtes Rendering nur im Browser-Smoke.
- **Glyphs öffentlich:** `https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf` (key-frei). Font `Noto Sans Regular`.
- **YAGNI:** nur Orts- + Straßennamen-Labels, kein Sprite/POI-Icon, keine Offline-Labels, keine volle `@protomaps/basemaps`-Kartografie.

---

## File Structure

| Datei | Verantwortung | Task |
|---|---|---|
| `src/config.rs` | `OnlineStyleTyp::Protomaps` | 1 |
| `src/karte/proxy.rs` | `proxy_config_url` Protomaps-Arm | 1 |
| `src/routes/karte.rs` | Config-Handler protomaps-Mapping (immer proxied); `proxy_tilejson_entry`-Handler; Registrierung erzwingt proxy | 1, 2 |
| `src/app.rs` | Route `/api/karte/proxy/{id}/tilejson` (slot-los) | 2 |
| `frontend/src/api/karte.ts` | `OnlineStyleTyp` += `'protomaps'` | 3 |
| `frontend/src/pages/lagekarte/basemapStil.ts` | `protomapsLabeledStyle` + Label-Farben + `baueBasemapStyle`-Zweig | 3 |
| `frontend/src/karten/OnlineQuelleFormModal.tsx` | Typ-Option „Protomaps" + proxy erzwingen | 4 |

---

### Task 1: Backend — Typ `protomaps` + Config liefert proxied TileJSON-URL

**Files:**
- Modify: `src/config.rs` (`OnlineStyleTyp` ~31-37)
- Modify: `src/karte/proxy.rs` (`proxy_config_url` ~46-52)
- Modify: `src/routes/karte.rs` (`config`-Handler ~48-69)

**Interfaces:**
- Produces: `OnlineStyleTyp::Protomaps` (serde `"protomaps"`). `proxy_config_url(id, &Protomaps) == "/api/karte/proxy/{id}/tilejson"`. Config-Handler liefert für eine aktive protomaps-Quelle `OnlineStyle{ typ: Protomaps, url: "/api/karte/proxy/{id}/tilejson" }`.

- [ ] **Step 1: Failing test — proxy_config_url + Serde für Protomaps**

In `src/karte/proxy.rs` im `mod tests` (nutzt `use crate::config::OnlineStyleTyp;` — schon vorhanden):

```rust
#[test]
fn proxy_config_url_protomaps_ist_tilejson_entry() {
    assert_eq!(
        proxy_config_url(7, &OnlineStyleTyp::Protomaps),
        "/api/karte/proxy/7/tilejson"
    );
}
```

In `src/config.rs` im `mod tests`:

```rust
#[test]
fn online_style_typ_protomaps_serde() {
    let j = serde_json::to_string(&OnlineStyleTyp::Protomaps).unwrap();
    assert_eq!(j, "\"protomaps\"");
    let back: OnlineStyleTyp = serde_json::from_str("\"protomaps\"").unwrap();
    assert_eq!(back, OnlineStyleTyp::Protomaps);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `rtk proxy cargo test --lib config::tests::online_style_typ_protomaps karte::proxy::tests::proxy_config_url_protomaps`
Expected: FAIL — `OnlineStyleTyp::Protomaps` existiert nicht (E0599/E0433).

- [ ] **Step 3: Variante hinzufügen**

In `src/config.rs`, `enum OnlineStyleTyp` (nach `Raster,`):

```rust
    Raster,
    /// Protomaps (key-basiert): registrierte TileJSON, beschrifteter Style wird im Frontend gebaut.
    Protomaps,
```

- [ ] **Step 4: proxy_config_url-Arm**

In `src/karte/proxy.rs`, `proxy_config_url`-`match` (nach dem `Raster`-Arm):

```rust
        OnlineStyleTyp::Raster => format!("/api/karte/proxy/{id}/raster/{{z}}/{{x}}/{{y}}"),
        OnlineStyleTyp::Protomaps => format!("/api/karte/proxy/{id}/tilejson"),
```

- [ ] **Step 5: Config-Handler — protomaps mappen + immer proxied**

In `src/routes/karte.rs`, `config`-Handler. Das `typ`-Mapping (~52-56) und die URL-Wahl (~57-61) ersetzen:

```rust
            let typ = match q.typ.as_str() {
                "raster" => OnlineStyleTyp::Raster,
                "protomaps" => OnlineStyleTyp::Protomaps,
                _ => OnlineStyleTyp::Vektor,
            };
            // protomaps trägt den Key in der Upstream-URL → IMMER proxied ausliefern (nie roh),
            // auch als Defense-in-Depth falls proxy versehentlich false wäre.
            let url = if q.proxy || matches!(typ, OnlineStyleTyp::Protomaps) {
                proxy::proxy_config_url(q.id, &typ)
            } else {
                q.url
            };
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `rtk proxy cargo test --lib config::tests::online_style_typ_protomaps karte::proxy::tests::proxy_config_url_protomaps`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/config.rs src/karte/proxy.rs src/routes/karte.rs
git commit -m "feat(lfh-192): OnlineStyleTyp::Protomaps + config liefert proxied TileJSON-URL"
```

---

### Task 2: Backend — slot-loser TileJSON-Entry-Endpunkt + proxy erzwingen

**Files:**
- Modify: `src/routes/karte.rs` (neuer Handler `proxy_tilejson_entry` nahe `proxy_tilejson` ~770; Registrierungs-Validierung — die Fn, die `OnlineQuelleEingabe` baut, ~200-235)
- Modify: `src/app.rs` (Route nach `…/tilejson/{slot}` ~378)
- Test: `tests/karte.rs` (Integration gegen Loopback-Fixture)

**Interfaces:**
- Consumes: `OnlineStyleTyp::Protomaps`, `aktive_proxy_quelle`, `ssrf_geprueft`, `proxy::hole_tilejson`, `json_proxy_antwort` (alle vorhanden).
- Produces: `GET /api/karte/proxy/{id}/tilejson` (slot-los). Registrierung mit `typ="protomaps"` ⇒ `proxy=true`.

- [ ] **Step 1: Failing test — Entry liefert key-frei + protomaps erzwingt proxy**

In `tests/karte.rs` (Muster wie vorhandene Proxy-Tests; ein Loopback-Fixture, der eine TileJSON mit Key-haltigem `tiles`-Eintrag liefert, registriert als `typ=protomaps`). Da die exakte Fixture-/Admin-Helfer-Form an die Datei anzupassen ist, prüft der Test minimal: (a) eine als `typ=protomaps`, `proxy=false` angelegte Quelle wird mit `proxy=true` gespeichert; (b) `GET /api/karte/proxy/{id}/tilejson` antwortet `200 application/json` und der Body enthält **nicht** den Key, sondern eine `/api/karte/proxy/`-Tile-URL.

```rust
#[tokio::test]
async fn protomaps_quelle_erzwingt_proxy_und_tilejson_entry_ist_keyfrei() {
    let srv = TestServer::neu().await; // vorhandener Harness in tests/karte.rs
    // Loopback-Fixture: TileJSON mit Key in tiles[].
    let upstream = srv.spawn_json_fixture(
        r#"{"tilejson":"3.0.0","tiles":["http://%HOST%/t/{z}/{x}/{y}.mvt?key=GEHEIM"]}"#,
    ).await;
    let q = srv.post_admin_json("/api/karte/online-quellen", &serde_json::json!({
        "name": "Protomaps", "url": upstream, "typ": "protomaps",
        "attribution": "© OSM, © Protomaps", "sortier": 0, "aktiv": true, "proxy": false,
    })).await;
    assert_eq!(q["proxy"], true, "protomaps erzwingt proxy");
    let id = q["id"].as_i64().unwrap();

    let resp = srv.get_admin(&format!("/api/karte/proxy/{id}/tilejson")).await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await;
    assert!(!body.contains("GEHEIM"), "Key nicht im Body: {body}");
    assert!(body.contains("/api/karte/proxy/"), "tiles auf Proxy-Slot umgeschrieben: {body}");
}
```

(Anm.: Die konkreten Harness-Methoden — `TestServer::neu`, `spawn_json_fixture`, `post_admin_json`, `get_admin` — an die in `tests/karte.rs` real existierenden Helfer anpassen; Fixture muss HTTP-Range nicht können, nur den TileJSON-Body liefern. `%HOST%` durch die Fixture-Adresse ersetzen.)

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk proxy cargo test --test karte protomaps_quelle_erzwingt_proxy`
Expected: FAIL — Route `/tilejson` (slot-los) existiert nicht / proxy wird nicht erzwungen.

- [ ] **Step 3: Registrierung erzwingt proxy für protomaps**

In `src/routes/karte.rs`, in der Fn, die `OnlineQuelleEingabe` baut: VOR dem `if body.proxy {`-Block die effektive proxy-Flag ableiten und im `OnlineQuelleEingabe` verwenden:

```rust
    // protomaps trägt den Key in der URL → Proxy ist Pflicht (nie roh ausliefern).
    let proxy_effektiv = body.proxy || body.typ == "protomaps";
```

Dann den `if body.proxy {`-Guard auf `if proxy_effektiv {` ändern und im zurückgegebenen `OnlineQuelleEingabe` `proxy: proxy_effektiv,` statt `proxy: body.proxy,` setzen.

- [ ] **Step 4: Entry-Handler ergänzen**

In `src/routes/karte.rs`, direkt nach `proxy_tilejson` (dem slot-behafteten Handler):

```rust
/// GET /api/karte/proxy/{id}/tilejson — registrierte TileJSON-Quelle (z. B. Protomaps) holen +
/// key-frei umschreiben. SLOT-LOS: die Quelle-`url` IST die TileJSON (analog `proxy_style`).
pub async fn proxy_tilejson_entry(
    State(state): State<AppState>,
    Path(id): Path<i64>,
) -> Result<Response, AppError> {
    let q = aktive_proxy_quelle(&state, id).await?;
    let u = ssrf_geprueft(&q.url)?;
    let json = proxy::hole_tilejson(proxy::proxy_client(), &state.pool, id, u)
        .await
        .map_err(|e| AppError::Internal(e.to_string()))?;
    Ok(json_proxy_antwort(json))
}
```

- [ ] **Step 5: Route registrieren**

In `src/app.rs`, NACH dem `…/tilejson/{slot}`-Block (~378) den slot-losen Entry ergänzen:

```rust
        .route(
            "/api/karte/proxy/{id}/tilejson",
            get(routes::karte::proxy_tilejson_entry),
        )
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `rtk proxy cargo test --test karte protomaps_quelle_erzwingt_proxy`
Expected: PASS.

- [ ] **Step 7: Gate — voller karte-Test**

Run: `rtk proxy cargo test --test karte && rtk proxy cargo test --lib karte::proxy`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/routes/karte.rs src/app.rs tests/karte.rs
git commit -m "feat(lfh-192): slot-loser TileJSON-Proxy-Entry + proxy-Zwang für protomaps"
```

---

### Task 3: Frontend — beschrifteter Protomaps-Style

**Files:**
- Modify: `frontend/src/api/karte.ts` (`OnlineStyleTyp` ~3)
- Modify: `frontend/src/pages/lagekarte/basemapStil.ts` (`FARBEN` ~7-16, neue Fn, `baueBasemapStyle` ~102-111)
- Test: `frontend/src/pages/lagekarte/basemapStil.test.ts` (vorhanden)

**Interfaces:**
- Consumes: Backend `OnlineStyle{ typ:'protomaps', url:'/api/karte/proxy/{id}/tilejson' }`.
- Produces: `protomapsLabeledStyle(theme: KartenTheme, tilejsonUrl: string): StyleSpecification`. `baueBasemapStyle(...)` ruft sie bei `onlineStil.typ === 'protomaps'`.

- [ ] **Step 1: Failing test**

In `frontend/src/pages/lagekarte/basemapStil.test.ts`:

```ts
import { protomapsLabeledStyle, baueBasemapStyle } from './basemapStil';

it('protomapsLabeledStyle: Label-Layer + glyphs + proxied Quelle', () => {
  const s = protomapsLabeledStyle('light', '/api/karte/proxy/3/tilejson') as any;
  expect(s.glyphs).toContain('protomaps.github.io');
  expect(s.sources.protomaps.url).toBe(`${window.location.origin}/api/karte/proxy/3/tilejson`);
  const ids = s.layers.map((l: any) => l.id);
  expect(ids).toEqual(expect.arrayContaining(['orte', 'strassennamen', 'erde', 'wasser']));
  // Jeder Symbol-Layer hat text-font (sonst rendert MapLibre keine Glyphs).
  for (const l of s.layers.filter((l: any) => l.type === 'symbol')) {
    expect(l.layout['text-font']).toBeTruthy();
  }
});

it('baueBasemapStyle: protomaps-Quelle → Protomaps-Style (Objekt, nicht URL-String)', () => {
  const s = baueBasemapStyle('online', 'light', undefined, {
    name: 'Protomaps', url: '/api/karte/proxy/3/tilejson', typ: 'protomaps', attribution: '©',
  } as any);
  expect(typeof s).toBe('object');
  expect((s as any).sources.protomaps).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run basemapStil`
Expected: FAIL — `protomapsLabeledStyle` nicht exportiert.

- [ ] **Step 3: Typ erweitern**

In `frontend/src/api/karte.ts`:

```ts
export type OnlineStyleTyp = 'vektor' | 'raster' | 'protomaps';
```

- [ ] **Step 4: Label-Farben + protomapsLabeledStyle**

In `frontend/src/pages/lagekarte/basemapStil.ts`, `FARBEN` je Theme um Label-Farben ergänzen:

```ts
  light: {
    erde: '#f5f5f3', wasser: '#a8cdf0', landuse: '#eaf0e2',
    strasse: '#ffffff', gebaeude: '#e4e0da', hintergrund: '#e8e8e8',
    label: '#3a3a3a', labelHalo: '#ffffff',
  },
  dark: {
    erde: '#15181d', wasser: '#15233f', landuse: '#1b2119',
    strasse: '#33373d', gebaeude: '#23262b', hintergrund: '#0f1115',
    label: '#d6d6d6', labelHalo: '#0f1115',
  },
```

Neue Fn (nach `offlineStyle`):

```ts
/**
 * Beschrifteter Protomaps-Style für ONLINE: dieselben Flächen/Linien-Layer wie offlineStyle,
 * aber Vektor-Quelle = proxied TileJSON (LFH-182, Key serverseitig) statt pmtiles://, PLUS
 * Orts-/Straßennamen-Labels mit öffentlichen Protomaps-Glyphs (key-frei).
 */
export function protomapsLabeledStyle(theme: KartenTheme, tilejsonUrl: string): StyleSpecification {
  const f = FARBEN[theme];
  const absolut = new URL(tilejsonUrl, window.location.origin).href;
  return {
    version: 8,
    glyphs: 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf',
    sources: {
      protomaps: { type: 'vector', url: absolut },
    },
    layers: [
      { id: 'hintergrund', type: 'background', paint: { 'background-color': f.erde } },
      { id: 'erde', source: 'protomaps', 'source-layer': 'earth', type: 'fill', paint: { 'fill-color': f.erde } },
      { id: 'landuse', source: 'protomaps', 'source-layer': 'landuse', type: 'fill', paint: { 'fill-color': f.landuse } },
      { id: 'wasser', source: 'protomaps', 'source-layer': 'water', type: 'fill', paint: { 'fill-color': f.wasser } },
      { id: 'strassen', source: 'protomaps', 'source-layer': 'roads', type: 'line', paint: { 'line-color': f.strasse, 'line-width': 1.2 } },
      { id: 'gebaeude', source: 'protomaps', 'source-layer': 'buildings', type: 'fill', paint: { 'fill-color': f.gebaeude } },
      {
        id: 'strassennamen', source: 'protomaps', 'source-layer': 'roads', type: 'symbol',
        layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 11 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
      {
        id: 'orte', source: 'protomaps', 'source-layer': 'places', type: 'symbol',
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Regular'], 'text-size': 12 },
        paint: { 'text-color': f.label, 'text-halo-color': f.labelHalo, 'text-halo-width': 1.2 },
      },
    ],
  } as StyleSpecification;
}
```

- [ ] **Step 5: baueBasemapStyle-Zweig**

In `frontend/src/pages/lagekarte/basemapStil.ts`, `baueBasemapStyle` (~108) den Online-Zweig erweitern:

```ts
  if (modus === 'online' && onlineStil) {
    if (onlineStil.typ === 'protomaps') return protomapsLabeledStyle(theme, onlineStil.url);
    return baueOnlineStyle(onlineStil);
  }
```

- [ ] **Step 6: Run tests + Gates**

Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run basemapStil`
Expected: PASS.
Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend lint && mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit`
Expected: PASS, 0 Warnings.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/api/karte.ts frontend/src/pages/lagekarte/basemapStil.ts frontend/src/pages/lagekarte/basemapStil.test.ts
git commit -m "feat(lfh-192): beschrifteter Protomaps-Online-Style (Labels + öffentliche Glyphs)"
```

---

### Task 4: Frontend — „Protomaps"-Option im Quellen-Formular (proxy erzwungen)

**Files:**
- Modify: `frontend/src/karten/OnlineQuelleFormModal.tsx` (`TYP_OPTIONEN` ~24-27, `URL_PLATZHALTER` ~29-32, `mutation` ~74-86, Proxy-`Form.Item` ~157-164)
- Test: `frontend/src/karten/OnlineQuellenVerwaltung.test.tsx` ODER `OnlineQuelleFormModal.test.tsx` (vorhandenes Muster)

**Interfaces:**
- Consumes: `OnlineStyleTyp` (Task 3), `OnlineQuelleBody`.
- Produces: Auswahl „Protomaps" ⇒ Body `{ typ:'protomaps', proxy:true }`.

- [ ] **Step 1: Failing test — Protomaps erzwingt proxy im Body**

In der Form-Testdatei (Muster der vorhandenen Quellen-Tests): „Hinzufügen" öffnen, Typ „Protomaps" wählen, Name/URL/Attribution füllen, speichern → `legeOnlineQuelleAn` (gemockt/MSW) erhält `typ:'protomaps'` und `proxy:true`.

```ts
expect(postBody).toMatchObject({ typ: 'protomaps', proxy: true });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run OnlineQuelle`
Expected: FAIL — „Protomaps" nicht wählbar / proxy nicht erzwungen.

- [ ] **Step 3: Typ-Option + Platzhalter**

In `frontend/src/karten/OnlineQuelleFormModal.tsx`:

```ts
const TYP_OPTIONEN: { value: OnlineStyleTyp; label: string }[] = [
  { value: 'vektor', label: 'Vektor (Style-JSON)' },
  { value: 'raster', label: 'Raster (XYZ-Kacheln)' },
  { value: 'protomaps', label: 'Protomaps (API-Key, beschriftet)' },
];

const URL_PLATZHALTER: Record<OnlineStyleTyp, string> = {
  vektor: 'https://…/style.json',
  raster: 'https://…/{z}/{x}/{y}.png',
  protomaps: 'https://api.protomaps.com/tiles/v4.json?key=…',
};
```

- [ ] **Step 4: proxy für protomaps erzwingen (Body + UI)**

Im `mutationFn`-Body (`proxy` ableiten):

```ts
        proxy: werte.typ === 'protomaps' ? true : (werte.proxy ?? false),
```

Und das Proxy-`Form.Item` bei protomaps fix/ausgegraut anzeigen — den `<Switch />` ersetzen durch:

```tsx
          <Switch disabled={typ === 'protomaps'} />
```

(Plus optional im selben Item-`tooltip` ergänzen, dass protomaps immer proxt. `typ` ist via `Form.useWatch` schon vorhanden.)

- [ ] **Step 5: Run test + Gates**

Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test --run OnlineQuelle`
Expected: PASS.
Run: `mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend lint && mise exec pnpm@11.0.9 -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend exec tsc --noEmit`
Expected: PASS, 0 Warnings.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/karten/OnlineQuelleFormModal.tsx frontend/src/karten/*.test.tsx
git commit -m "feat(lfh-192): Quellen-Formular Typ Protomaps (proxy erzwungen)"
```

---

### Abschluss (manuell, nach Task 1–4)

- [ ] **Browser-Smoke** (WebGL, nicht jsdom): `pnpm -C frontend build` + Backend neu starten. Online-Quelle Typ „Protomaps" mit `https://api.protomaps.com/tiles/v4.json?key=<KEY>` anlegen, aktivieren. Lagekarte: Karte rendert mit **Orts-/Straßennamen**. Netzwerk-Tab: nur `/api/karte/proxy/{id}/tilejson` + `/api/karte/proxy/{id}/tile/…` — **kein** `api.protomaps.com` und **kein** `key=` im Browser.
- [ ] **Voller Gate-Lauf:** `rtk proxy cargo test` (ehrlich, ohne `| tail`) + volle Frontend-Suite `--no-file-parallelism`.

---

## Self-Review

- **Spec-Abdeckung:** Typ `protomaps` → T1. Slot-loser TileJSON-Entry → T2. proxy erzwungen (Backend) → T2; (Frontend) → T4. `protomapsLabeledStyle` + Labels + Glyphs → T3. Form-Option → T4. Key-Sicherheit (Config immer proxied + Registrierung erzwingt) → T1+T2. Browser-Smoke → Abschluss.
- **Platzhalter:** Der Integrationstest (T2 Step 1) nennt explizit, dass die Harness-Methoden an `tests/karte.rs` anzupassen sind — kein verstecktes TODO, sondern eine bewusste Anpassung an real existierende Helfer (vor dem Schreiben `tests/karte.rs`-Proxy-Tests als Vorlage lesen).
- **Typ-Konsistenz:** `OnlineStyleTyp::Protomaps` (Rust) / `'protomaps'` (TS); `proxy_tilejson_entry`; `protomapsLabeledStyle(theme, tilejsonUrl)`; `proxy_effektiv` — durchgängig.
- **Risiko Font-Name:** `Noto Sans Regular` muss von den Protomaps-Assets geliefert werden — im Browser-Smoke bestätigen; falls leer, Fontstack-Name aus `protomaps.github.io/basemaps-assets` anpassen (reiner Daten-, kein Strukturfix).
