# Server-Proxy für Style/Tile (LFH-182) — Implementierungsplan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein serverseitiger, cross-host-generischer Style-/Tile-Proxy, der key-basierte Online-Basemap-Quellen für MapLibre transparent über relative `/api/karte/proxy/…`-Endpunkte ausliefert, ohne dass Upstream-Key/-URL je im Browser landet.

**Architecture:** Per-Quelle `proxy`-Flag auf `karte_online_quelle`. `/api/karte/config` schreibt für `proxy=1` die Upstream-URL auf relative Proxy-URLs um. Der Vektor-Style wird serverseitig geparst, **strukturell** (nur bekannte Asset-Positionen) auf Proxy-Slots (persistente Tabelle `karte_proxy_asset`) umgeschrieben, unbekannte absolute URLs **neutralisiert**, ein `contains_secret`-Backstop **fail-closed**. Jeder Upstream-Fetch läuft durch `url_ist_sicher` **plus** einen auflösend-pinnenden DNS-Resolver (Anti-Rebinding). Frontend bleibt fast unverändert (Proxy ist transparent, same-origin).

**Tech Stack:** Rust/axum, sqlx 0.9 (SQLite), reqwest 0.13.4 (bereits Dependency), serde_json; React/antd/maplibre-gl/vitest im Frontend.

**Quellen:** Spec `docs/superpowers/specs/2026-06-27-style-tile-proxy-design.md` (autoritativ, inkl. §5 Härtung). Diese ist aus 3 Planentwürfen + adversarialer Design-Review (Key-Leak/SSRF/MapLibre) synthetisiert.

## Global Constraints

- **sqlx 0.9:** `query`/`query_as` nehmen NUR `&'static str` (SqlSafeStr) — **kein** `format!`-SQL. Spaltenlisten je Query als Literal wiederholen.
- **Migration** `0077_karte_proxy.sql`: rein additiv (`ALTER TABLE … ADD COLUMN` + `CREATE TABLE`) → kein CHECK-Rebuild, no-transaction-Caveat irrelevant. **Vor Merge** gegen den dann-aktuellen `migrations/`-Stand re-prüfen; bei Kollision höher umbenennen.
- **Keys nie client-seitig:** kein client-gerichteter Endpunkt (`/config`, `/proxy/*`) gibt Upstream-`url`/Key aus. Rewrite ist **strukturell-zuerst + neutralize**; `contains_secret` ist **fail-closed**.
- **SSRF auf JEDEM Fetch:** `url_ist_sicher` (Schema/Literal) + auflösend-pinnender Resolver (alle A/AAAA gegen `ip_ist_intern`, nur public IPs an reqwest). Gilt auch in der Redirect-Policy.
- **Template-URLs roh speichern:** `url`-crate (2.5.8) percent-encodet `{}` → Template-Upstream-URLs (`karte_online_quelle.url` bei `proxy=1`, `karte_proxy_asset.upstream_url`) **roh** (getrimmt) ablegen, **textuell** substituieren (kein `Url`-Roundtrip). SSRF-Check auf einer **materialisierten Probe** (z=0/x=0/y=0).
- **Proxy-Endpunkte sind öffentlich** (kein Auth-Extractor, wie `/config`/`/tiles`); Online-**Schreib**-CRUD bleibt `AdminUser`. `online_liste`-Lesen ist `darf_admin_bereich()` (schließt Führungskräfte ein) → `url` für `proxy=1` maskieren, wenn nicht `ist_admin()`.
- **AppState:** neue Felder als **ein** gruppiertes `ProxyState{ client, slots }`-Feld (genau eine Zeile je Konstruktionsstelle — `main.rs` + alle `tests/*.rs`). `slots` = `Arc<RwLock<HashMap<(i64,i64), String>>>`-Cache vor der Tabelle.
- **Gates** (immer via `rtk proxy <cmd>` für ehrliche Exit-Codes): `cargo test`, `cargo clippy --all-targets -- -D warnings`, Frontend `pnpm lint` (`--max-warnings 0`), `pnpm test`, `pnpm exec tsc --noEmit`. pnpm läuft via `mise exec pnpm@<ver> -- pnpm -C <abs-pfad> …` mit absoluten `-C`-Pfaden.
- **Frontend ist ins Binary eingebettet** (rust-embed); Map ist WebGL → in jsdom nicht renderbar. Finale Funktions-Verifikation als **Browser-Smoke** gegen ein hochgezogenes Debug-Backend.

## File Structure

- `migrations/0077_karte_proxy.sql` *(neu)* — `proxy`-Spalte + `karte_proxy_asset`-Tabelle.
- `src/karte/proxy.rs` *(neu)* — reine Bausteine (URL-Bauer, Substitution, Rewrite-Walker, Validatoren, `contains_secret`) + nicht-validierende Service-Schicht (`proxy_client`, `sicherer_resolver`, `hole_asset`, `hole_style`, `hole_tilejson`).
- `src/karte/mod.rs` *(mod)* — `pub mod proxy;`.
- `src/karte/download.rs` *(mod)* — `ssrf_redirect_policy()` aus `download_client()` herausziehen (geteilt mit `proxy_client`).
- `src/karte/registry/repo.rs` *(mod)* — `proxy`-Spalte; `aktive_online_quellen_fuer_config()`; Slot-Map-CRUD.
- `src/routes/karte.rs` *(mod)* — `OnlineQuelleBody`/`validiere_online`/`config`/`online_liste` erweitern; Proxy-Handler.
- `src/app.rs` *(mod)* — `ProxyState` im `AppState`, Routen registrieren.
- `src/main.rs` *(mod)* — `ProxyState` konstruieren.
- `tests/karte.rs` *(neu/mod)* — Integrationstests der Endpunkte (Verzeichnis prüfen; ggf. existierendes `tests/`-Muster).
- `frontend/src/.../OnlineQuelleFormModal.tsx` *(mod)* — Proxy-`<Switch>`.
- `frontend/src/pages/lagekarte/basemapStil.ts` *(mod)* — Vektor-Style-URL gegen Origin absolutieren.
- `frontend/src/pages/lagekarte/basemapStil.test.ts` *(mod)* — Unit.

Der Implementierer muss zu Beginn per `rg` verifizieren: exakter Pfad von `OnlineQuelleFormModal` (`rg -l "OnlineQuelle" frontend/src`), Existenz/Form von `tests/karte.rs` bzw. `tests/`-Integrationsmuster, `ist_admin()` vs `darf_admin_bereich()` in `src/auth/`, und die `AppState`-Konstruktionsstellen (`rg -n "AppState\s*\{" src tests`).

---

### Task 1: `proxy.rs` — URL-Bauer, Substitution, Validatoren (rein)

**Files:**
- Create: `src/karte/proxy.rs`
- Modify: `src/karte/mod.rs` (`pub mod proxy;`)
- Test: in `src/karte/proxy.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces:
  - `pub enum SlotArt { Static, Template, Tilejson, Sprite, Glyphs }` mit `fn as_str(&self)->&'static str` und `fn from_str(&str)->Option<SlotArt>` (`'static'|'template'|'tilejson'|'sprite'|'glyphs'`).
  - `pub fn proxy_config_url(id: i64, typ: &crate::config::OnlineStyleTyp) -> String` — Vektor→`/api/karte/proxy/{id}/style.json`, Raster→`/api/karte/proxy/{id}/raster/{z}/{x}/{y}`.
  - `pub fn proxy_url(id: i64, art: SlotArt, slot: i64) -> String` — `Template`→`/api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}`, `Tilejson`→`/…/tilejson/{slot}`, `Sprite`→`/…/sprite/{slot}`, `Glyphs`→`/…/glyphs/{slot}/{fontstack}/{range}`, `Static`→`/…/asset/{slot}`.
  - `pub fn ist_absolute_http_url(s: &str) -> bool`
  - `pub fn subst_template(template: &str, z: i64, x: i64, y: i64) -> String`
  - `pub fn subst_glyphs(template: &str, fontstack: &str, range: &str) -> String`
  - `pub fn validiere_range(range: &str) -> Result<(), String>`
  - `pub fn validiere_fontstack(fontstack: &str) -> Result<(), String>`
  - `pub fn sprite_upstream(base: &str, suffix: &str) -> String`
  - `pub fn split_slot_suffix(rest: &str) -> Result<(i64, String), String>`
  - `pub fn unbekannte_platzhalter(template: &str) -> Vec<String>` — `{…}`-Token außerhalb `{z}{x}{y}{-y}{fontstack}{range}`.

- [ ] **Step 1: Failing tests schreiben** (in `proxy.rs`):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::OnlineStyleTyp;

    #[test]
    fn proxy_config_url_je_typ() {
        assert_eq!(proxy_config_url(7, &OnlineStyleTyp::Vektor), "/api/karte/proxy/7/style.json");
        assert_eq!(proxy_config_url(7, &OnlineStyleTyp::Raster), "/api/karte/proxy/7/raster/{z}/{x}/{y}");
    }

    #[test]
    fn proxy_url_fuenf_formen() {
        assert_eq!(proxy_url(3, SlotArt::Template, 9), "/api/karte/proxy/3/tile/9/{z}/{x}/{y}");
        assert_eq!(proxy_url(3, SlotArt::Tilejson, 9), "/api/karte/proxy/3/tilejson/9");
        assert_eq!(proxy_url(3, SlotArt::Sprite, 9), "/api/karte/proxy/3/sprite/9");
        assert_eq!(proxy_url(3, SlotArt::Glyphs, 9), "/api/karte/proxy/3/glyphs/9/{fontstack}/{range}");
        assert_eq!(proxy_url(3, SlotArt::Static, 9), "/api/karte/proxy/3/asset/9");
    }

    #[test]
    fn subst_template_namensbasiert_und_tms() {
        // Reihenfolge {z}/{y}/{x} muss namensbasiert korrekt füllen.
        assert_eq!(subst_template("https://h/{z}/{y}/{x}.pbf?key=K", 3, 5, 1), "https://h/3/1/5.pbf?key=K");
        // {-y} TMS: z=3 -> 2^3-1-1 = 6
        assert_eq!(subst_template("https://h/{z}/{x}/{-y}", 3, 2, 1), "https://h/3/2/6");
        // Roher String ohne Platzhalter bleibt unverändert (keine versehentliche Ersetzung).
        assert_eq!(subst_template("https://h/static.png", 3, 2, 1), "https://h/static.png");
    }

    #[test]
    fn subst_glyphs_encodet_fontstack() {
        let out = subst_glyphs("https://h/fonts/{fontstack}/{range}.pbf?key=K", "Noto Sans,Arial", "0-255");
        assert_eq!(out, "https://h/fonts/Noto%20Sans%2CArial/0-255.pbf?key=K");
    }

    #[test]
    fn validiere_range_und_fontstack() {
        assert!(validiere_range("0-255").is_ok());
        assert!(validiere_range("0-255?x=").is_err());
        assert!(validiere_range("0-255.pbf").is_err());
        assert!(validiere_fontstack("Noto Sans,Arial").is_ok());
        for bad in ["a/b", "..", "a#b", "a?b"] { assert!(validiere_fontstack(bad).is_err(), "{bad}"); }
    }

    #[test]
    fn sprite_upstream_suffix_vor_query() {
        assert_eq!(sprite_upstream("https://h/sprite?key=K", ".png"), "https://h/sprite.png?key=K");
        assert_eq!(sprite_upstream("https://h/sprite?key=K", "@2x.json"), "https://h/sprite@2x.json?key=K");
        assert_eq!(sprite_upstream("https://h/sprite", ".png"), "https://h/sprite.png");
    }

    #[test]
    fn split_slot_suffix_allowlist() {
        assert_eq!(split_slot_suffix("7.png").unwrap(), (7, ".png".into()));
        assert_eq!(split_slot_suffix("7@2x.png").unwrap(), (7, "@2x.png".into()));
        assert_eq!(split_slot_suffix("7.json").unwrap(), (7, ".json".into()));
        assert!(split_slot_suffix("7.exe").is_err());
        assert!(split_slot_suffix("7").is_err());
    }

    #[test]
    fn ist_absolute_http_url_erkennung() {
        for ok in ["https://h/a", "HTTPS://h/a", "//h/a"] { assert!(ist_absolute_http_url(ok), "{ok}"); }
        for no in ["/a/b", "a/b", "pmtiles://x", "mapbox://x", "data:foo"] { assert!(!ist_absolute_http_url(no), "{no}"); }
    }

    #[test]
    fn unbekannte_platzhalter_findet_nur_unbekannte() {
        assert!(unbekannte_platzhalter("https://h/{z}/{x}/{y}").is_empty());
        assert_eq!(unbekannte_platzhalter("https://h/{z}/{quadkey}/{ratio}"), vec!["{quadkey}".to_string(), "{ratio}".to_string()]);
    }
}
```

- [ ] **Step 2: Tests laufen → FAIL**: `rtk proxy cargo test -p lifeline-hub karte::proxy::tests` → erwartet Compile-Fehler/FAIL (Funktionen fehlen).

- [ ] **Step 3: Minimal implementieren.** Kernlogik:
  - `proxy_config_url`/`proxy_url`: `format!`-Strings exakt wie oben.
  - `ist_absolute_http_url`: lowercased `starts_with("http://")||starts_with("https://")||starts_with("//")`.
  - `subst_template`: rein textuelles `replace("{z}", &z.to_string())`, `{x}`, `{y}`; `{-y}` → `((1i64<<z) - 1 - y)`. Reihenfolge: `{-y}` vor `{y}` ersetzen (sonst frisst `{y}` das Innere — präzise: zuerst `{-y}`, dann `{z}`,`{x}`,`{y}`).
  - `subst_glyphs`: `{range}` validiert einsetzen; `{fontstack}` mit `percent_encoding` (vorhandene Crate? sonst manuell: `,`→`%2C`, ` `→`%20`; pro Komma-Segment encoden). Prüfe vorhandene Dependency `rg "percent" Cargo.toml`; sonst minimaler eigener Encoder für die erlaubte Zeichenmenge.
  - `validiere_range`: Regex-frei — split einmal an `-`, beide Seiten nicht-leer und nur ASCII-Digits.
  - `validiere_fontstack`: erlaubt Buchstaben/Ziffern/Leerzeichen/Komma/`-`; lehnt `/ . # ? %` und `..` ab.
  - `sprite_upstream`: an `?` splitten; `suffix` zwischen Pfad und `?query` einfügen.
  - `split_slot_suffix`: Suffix gegen Allowlist `["@2x.json","@2x.png",".json",".png"]` matchen (längste zuerst), Rest als `i64` parsen.
  - `unbekannte_platzhalter`: alle `{…}` extrahieren, bekannte Menge abziehen.

- [ ] **Step 4: Tests laufen → PASS**: `rtk proxy cargo test -p lifeline-hub karte::proxy::tests`.
- [ ] **Step 5: Clippy**: `rtk proxy cargo clippy --all-targets -- -D warnings`.
- [ ] **Step 6: Commit**:

```bash
git add src/karte/proxy.rs src/karte/mod.rs
git commit -m "feat(lfh-182): proxy.rs URL-Bauer/Substitution/Validatoren (rein)"
```

---

### Task 2: `proxy.rs` — Rewrite-Walker + `contains_secret` (rein)

**Files:**
- Modify: `src/karte/proxy.rs`
- Test: `src/karte/proxy.rs` (tests)

**Interfaces:**
- Consumes: `SlotArt`, `proxy_url`, `ist_absolute_http_url`, `subst_*` (Task 1).
- Produces:
  - `pub enum RewriteFehler { ZuVieleSlots, Json(String) }` (`impl Display`).
  - `pub fn rewrite_style(style: &mut serde_json::Value, basis: &url::Url, mint: &mut dyn FnMut(&str, SlotArt) -> String, max_slots: usize) -> Result<(), RewriteFehler>` — `mint(upstream_url, art)` liefert die fertige Proxy-Client-URL (im Handler: DB-Upsert + `proxy_url`; im Test: Fake). Schreibt **strukturell** um, **neutralisiert** unbekannt-positionierte absolute URLs, absolutiert relative Asset-Refs gegen `basis`.
  - `pub fn rewrite_tilejson(tj: &mut serde_json::Value, basis: &url::Url, mint: &mut dyn FnMut(&str, SlotArt) -> String, max_slots: usize) -> Result<(), RewriteFehler>`
  - `pub fn contains_secret(serialisiert: &str, upstream: &url::Url) -> bool` — true, wenn ein Query-Param-Wert von `upstream` (len ≥ 1) als Substring in `serialisiert` vorkommt.

**Strukturregeln (rewrite_style):** iteriere `sources` (Objekt): je Source
- `tiles: [..]` (Array von Strings) → jede URL gegen `basis` absolutieren, `mint(url, Template)` → ersetzen.
- `url: ".."` (String, TileJSON-Indirektion) → absolutieren, `mint(url, Tilejson)`.
- `data: ".."` (geojson, nur wenn absolute http) → `mint(url, Static)`.
Top-Level:
- `sprite`: String → absolutieren, `mint(url, Sprite)`; ODER Array `[{id,url}]` → je Eintrag `url` minten (Sprite).
- `glyphs`: String → absolutieren, `mint(url, Glyphs)`.
`metadata`/`attribution` werden **strukturell übersprungen** (kein Slot). Danach ein **Sweep** über das gesamte JSON: jede verbleibende absolute http-URL an **unbekannter** Position → **neutralisieren** (Feld entfernen bzw. auf `""`-frei: Schlüssel löschen). Slot-Zähler > `max_slots` → `Err(ZuVieleSlots)`.

- [ ] **Step 1: Failing tests** (Auszug; volle Liste siehe Testliste der Spec):

```rust
#[cfg(test)]
mod rewrite_tests {
    use super::*;
    use serde_json::json;

    // mint: deterministischer Fake, der die Aufrufe protokolliert.
    fn fake_mint(log: &mut Vec<(String, SlotArt)>) -> impl FnMut(&str, SlotArt) -> String + '_ {
        move |u, a| { log.push((u.to_string(), a)); format!("/api/karte/proxy/1/{}/{}", a.as_str(), log.len()) }
    }

    #[test]
    fn rewrite_style_mintet_strukturell_und_ist_keyfrei() {
        let basis = url::Url::parse("https://api.host/maps/x/style.json?key=K").unwrap();
        let mut style = json!({
            "version": 8,
            "sources": {
                "v": { "type": "vector", "url": "https://api.host/maps/x/tiles.json?key=K" },
                "r": { "type": "raster", "tiles": ["https://api.host/t/{z}/{x}/{y}.png?key=K"] },
                "g": { "type": "geojson", "data": "https://api.host/d.geojson?key=K" }
            },
            "sprite": "https://api.host/maps/x/sprite?key=K",
            "glyphs": "https://api.host/fonts/{fontstack}/{range}.pbf?key=K"
        });
        let mut log = vec![];
        let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        let s = serde_json::to_string(&style).unwrap();
        assert!(!s.contains("key=K"), "kein Key im Ergebnis: {s}");
        assert!(!s.contains("api.host"), "kein Upstream-Host: {s}");
        // alle fünf Asset-Arten gemintet
        let arten: Vec<_> = log.iter().map(|(_,a)| a.as_str()).collect();
        for a in ["tilejson","template","static","sprite","glyphs"] { assert!(arten.contains(&a), "{a}"); }
    }

    #[test]
    fn rewrite_style_absolutiert_relative_refs() {
        let basis = url::Url::parse("https://h/maps/x/style.json?key=K").unwrap();
        let mut style = json!({"version":8,"sources":{},"sprite":"sprite","glyphs":"fonts/{fontstack}/{range}.pbf"});
        let mut log = vec![]; let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        // 'sprite' relativ → gegen Basis absolutiert (https://h/maps/x/sprite) und gemintet
        assert!(log.iter().any(|(u,a)| u=="https://h/maps/x/sprite" && matches!(a, SlotArt::Sprite)));
    }

    #[test]
    fn rewrite_style_neutralisiert_unbekannte_absolute_url() {
        let basis = url::Url::parse("https://h/s.json?key=K").unwrap();
        let mut style = json!({"version":8,"sources":{},"x_evil":"https://api.host/secret?key=K"});
        let mut log = vec![]; let mut m = fake_mint(&mut log);
        rewrite_style(&mut style, &basis, &mut m, 500).unwrap();
        let s = serde_json::to_string(&style).unwrap();
        assert!(!s.contains("api.host") && !s.contains("key=K"), "neutralisiert: {s}");
        assert!(log.is_empty(), "unbekannte Position wird NICHT zu fetchbarem Slot");
    }

    #[test]
    fn rewrite_style_slot_obergrenze() {
        let basis = url::Url::parse("https://h/s.json").unwrap();
        let tiles: Vec<_> = (0..10).map(|i| format!("https://h/{i}/{{z}}/{{x}}/{{y}}")).collect();
        let mut style = json!({"version":8,"sources":{"r":{"type":"raster","tiles": tiles}}});
        let mut log = vec![]; let mut m = fake_mint(&mut log);
        assert!(matches!(rewrite_style(&mut style, &basis, &mut m, 3), Err(RewriteFehler::ZuVieleSlots)));
    }

    #[test]
    fn rewrite_tilejson_normalisiert_tms() {
        let basis = url::Url::parse("https://h/tiles.json?key=K").unwrap();
        let mut tj = json!({"tiles":["https://h/{z}/{x}/{y}.pbf?key=K"], "scheme":"tms"});
        let mut log = vec![]; let mut m = fake_mint(&mut log);
        rewrite_tilejson(&mut tj, &basis, &mut m, 500).unwrap();
        let s = serde_json::to_string(&tj).unwrap();
        assert!(!s.contains("key=K"));
        assert!(!s.contains("\"scheme\":\"tms\""), "scheme→xyz normalisiert (kein Doppel-Flip)");
    }

    #[test]
    fn contains_secret_findet_query_werte() {
        let up = url::Url::parse("https://h/x?key=SECRET123&foo=bar").unwrap();
        assert!(contains_secret("...key=SECRET123...", &up));
        assert!(!contains_secret("nichts geheimes", &up));
    }
}
```

- [ ] **Step 2: FAIL** (`rtk proxy cargo test -p lifeline-hub karte::proxy`).
- [ ] **Step 3: Implementieren** nach den Strukturregeln oben. `url`-crate ist bereits via reqwest da (`use url::Url`). Absolutieren: `basis.join(ref)?`. Neutralisieren im Sweep: rekursiv über `Value`; bei `Value::Object` Schlüssel mit absolutem-http-String-Wert entfernen (an nicht-bekannten Positionen); bei `Value::Array`/verschachtelt rekursiv. `contains_secret`: `upstream.query_pairs()` → für jeden nicht-leeren Value `serialisiert.contains(value)`.
- [ ] **Step 4: PASS**. **Step 5: Clippy**. **Step 6: Commit**:

```bash
git add src/karte/proxy.rs
git commit -m "feat(lfh-182): Rewrite-Walker (strukturell+neutralize) + contains_secret"
```

---

### Task 3: Migration + `proxy` durch Repo & Online-CRUD (inkl. Validierung)

**Files:**
- Create: `migrations/0077_karte_proxy.sql`
- Modify: `src/karte/registry/repo.rs`, `src/routes/karte.rs`
- Test: `repo.rs` (tests), `tests/karte.rs`

**Interfaces:**
- Produces (repo):
  - `OnlineQuelle`/`OnlineQuelleEingabe` erhalten `pub proxy: bool`.
  - `pub async fn aktive_online_quellen_fuer_config(pool) -> Result<Vec<OnlineQuelleConfig>, sqlx::Error>` mit `struct OnlineQuelleConfig { id: i64, name: String, url: String, typ: String, attribution: Option<String>, proxy: bool }` (ersetzt `aktive_online_styles`).
  - `pub async fn slot_upsert(pool, quelle_id: i64, upstream_url: &str, art: &str) -> Result<i64, sqlx::Error>`
  - `pub async fn slot_aufloesen(pool, quelle_id: i64, slot: i64, art: &str) -> Result<Option<String>, sqlx::Error>`
  - `pub async fn slots_loeschen(pool, quelle_id: i64) -> Result<u64, sqlx::Error>`
- Produces (routes): `OnlineQuelleBody.proxy: bool` (`#[serde(default)]`); `validiere_online` setzt `proxy`, prüft für `proxy=1` SSRF (materialisierte Probe) + lehnt unbekannte Platzhalter ab.

- [ ] **Step 1: Migration schreiben** (`migrations/0077_karte_proxy.sql`):

```sql
-- LFH-182: Server-Proxy für Style/Tile. Additiv (ADD COLUMN + CREATE TABLE) → kein CHECK-Rebuild.
ALTER TABLE karte_online_quelle ADD COLUMN proxy INTEGER NOT NULL DEFAULT 0 CHECK (proxy IN (0,1));

-- Persistente Zuordnung opaker Slot-IDs → Upstream-URLs (inkl. Key; NUR server-seitig).
CREATE TABLE karte_proxy_asset (
    id           INTEGER PRIMARY KEY,
    quelle_id    INTEGER NOT NULL REFERENCES karte_online_quelle(id) ON DELETE CASCADE,
    upstream_url TEXT    NOT NULL,
    art          TEXT    NOT NULL CHECK (art IN ('static','template','tilejson','sprite','glyphs')),
    erstellt_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (quelle_id, upstream_url)
);
```

- [ ] **Step 2: Failing repo-Tests** (in `repo.rs` tests; `test_pool()` wendet Migrationen an):

```rust
#[tokio::test]
async fn online_quelle_round_trippt_proxy() {
    let pool = test_pool().await;
    let mut e = eingabe("X", 1, true); e.proxy = true;
    let q = anlegen_online_quelle(&pool, &e).await.unwrap();
    assert!(q.proxy, "proxy gespeichert+gelesen");
    // Default ohne proxy = false
    let q2 = anlegen_online_quelle(&pool, &eingabe("Y", 2, true)).await.unwrap();
    assert!(!q2.proxy);
}

#[tokio::test]
async fn aktive_online_quellen_fuer_config_traegt_id_und_proxy() {
    let pool = test_pool().await;
    let mut e = eingabe("P", 1, true); e.proxy = true;
    let q = anlegen_online_quelle(&pool, &e).await.unwrap();
    let liste = aktive_online_quellen_fuer_config(&pool).await.unwrap();
    let row = liste.iter().find(|r| r.id == q.id).unwrap();
    assert!(row.proxy);
    assert_eq!(row.typ, "vektor");
}

#[tokio::test]
async fn slot_upsert_dedupliziert_und_aufloesen_scoped() {
    let pool = test_pool().await;
    let q = anlegen_online_quelle(&pool, &eingabe("S", 1, true)).await.unwrap();
    let s1 = slot_upsert(&pool, q.id, "https://h/a?key=K", "template").await.unwrap();
    let s1b = slot_upsert(&pool, q.id, "https://h/a?key=K", "template").await.unwrap();
    assert_eq!(s1, s1b, "gleiche url → gleiche id");
    let s2 = slot_upsert(&pool, q.id, "https://h/b", "sprite").await.unwrap();
    assert_ne!(s1, s2);
    assert_eq!(slot_aufloesen(&pool, q.id, s1, "template").await.unwrap().as_deref(), Some("https://h/a?key=K"));
    assert!(slot_aufloesen(&pool, q.id, s1, "sprite").await.unwrap().is_none(), "falsche art → None");
    assert!(slot_aufloesen(&pool, 999, s1, "template").await.unwrap().is_none(), "fremde quelle → None");
}

#[tokio::test]
async fn slots_loeschen_nur_eigene() {
    let pool = test_pool().await;
    let a = anlegen_online_quelle(&pool, &eingabe("A", 1, true)).await.unwrap();
    let b = anlegen_online_quelle(&pool, &eingabe("B", 2, true)).await.unwrap();
    let sa = slot_upsert(&pool, a.id, "https://h/a", "static").await.unwrap();
    slot_upsert(&pool, b.id, "https://h/b", "static").await.unwrap();
    slots_loeschen(&pool, a.id).await.unwrap();
    assert!(slot_aufloesen(&pool, a.id, sa, "static").await.unwrap().is_none());
}
```

Den vorhandenen `eingabe()`-Helfer in `repo.rs` um `proxy: false` ergänzen; den alten `aktive_online_styles_nur_aktive_sortiert`-Test auf `aktive_online_quellen_fuer_config` umstellen (gleiche Sortier-/Aktiv-Semantik).

- [ ] **Step 3: FAIL** (`rtk proxy cargo test -p lifeline-hub karte::registry`).
- [ ] **Step 4: Implementieren.**
  - repo: `OnlineQuelle`/`OnlineQuelleEingabe` um `proxy: bool`; `SELECT … , proxy …` in `hole_online_quelle`/`liste_online_quellen`; `INSERT …, proxy` / `UPDATE … proxy = ?` (Spaltenliste je Query als Literal). `slot_upsert`: `INSERT INTO karte_proxy_asset (quelle_id,upstream_url,art) VALUES (?,?,?) ON CONFLICT(quelle_id,upstream_url) DO UPDATE SET art=excluded.art RETURNING id` (`fetch_one`→`get(0)`). `aktive_online_quellen_fuer_config`: `SELECT id,name,url,typ,attribution,proxy FROM karte_online_quelle WHERE aktiv=1 ORDER BY sortier,id`.
  - routes: `OnlineQuelleBody { …, #[serde(default)] proxy: bool }`. `validiere_online`: `eingabe.proxy = body.proxy`. Für `proxy=1`: `unbekannte_platzhalter(&url)` nicht-leer → `Err(Validation("Unbekannter Platzhalter …"))`; SSRF-Probe `download::url_ist_sicher(&Url::parse(&proxy::subst_template(&proxy::subst_glyphs(&url,"a","0-0"),0,0,0))?)` → Fehler → `Err(Validation)`; **`url` roh (getrimmt) speichern** (kein `Url`-Roundtrip). Bei `proxy=0` bleibt die bisherige Logik.
- [ ] **Step 5: Failing tests/karte.rs** (Endpunkt-Validierung — Verzeichnismuster vorab prüfen):

```rust
// tests/karte.rs (Integrationsmuster wie bestehende tests/*.rs; App via app::router(state))
// POST /api/karte/online-quellen als Admin
// - proxy=1 + interne url (https://10.0.0.5/style.json?key=K) → 422
// - proxy=1 + http://… → 422
// - proxy=1 + gültige https → 201, Body proxy:true
// - proxy=1 + url mit {quadkey} → 422
// - ohne proxy-Feld → proxy:false
// PATCH/DELETE einer proxy=1-Quelle → slot_aufloesen danach None (Slots gepurged)
```

(Volle Assertions: Testliste-Einträge „tests/karte.rs: POST …", „PATCH/DELETE … purged ihre Slots".)

- [ ] **Step 6:** PATCH/DELETE müssen `slots_loeschen(quelle_id)` aufrufen → in `online_aktualisieren` und `online_loeschen` ergänzen (+ Cache-Invalidierung in Task 8). **Step 7: PASS + Clippy. Step 8: Commit**:

```bash
git add migrations/0077_karte_proxy.sql src/karte/registry/repo.rs src/routes/karte.rs tests/karte.rs
git commit -m "feat(lfh-182): Migration + proxy-Flag durch Repo/CRUD + Slot-Map + Validierung"
```

---

### Task 4: `/config`-Rewrite + `online_liste`-Maskierung

**Files:** Modify `src/routes/karte.rs`; Test `tests/karte.rs`.

**Interfaces:**
- Consumes: `aktive_online_quellen_fuer_config` (Task 3), `proxy_config_url` (Task 1), `ist_admin()`.
- Produces: `config` baut `online_styles` aus `OnlineQuelleConfig`; für `proxy=1` `url = proxy_config_url(id, typ)`, `url` nie roh. `online_liste` maskiert `url` (z.B. `"***"`) für `proxy=1` wenn `!benutzer.ist_admin()`.

- [ ] **Step 1: Failing tests/karte.rs:**

```text
GET /api/karte/config:
  - proxy=1 vektor → online_styles[].url == /api/karte/proxy/{id}/style.json
  - proxy=1 raster → /api/karte/proxy/{id}/raster/{z}/{x}/{y}
  - proxy=0 → url unverändert (Upstream)
  - gesamter Response-Body enthält NICHT den Upstream-Host/Key der proxy=1-Quelle
  - attribution der proxy=1-Quelle bleibt erhalten
GET /api/karte/online-quellen:
  - als Admin: url einer proxy=1-Quelle voll sichtbar
  - als Führungskraft (darf_admin_bereich, !ist_admin): url maskiert, kein Key
```

- [ ] **Step 2: FAIL. Step 3: Implementieren** — `config()` iteriert `aktive_online_quellen_fuer_config`, mappt auf `OnlineStyle{ name, url: wenn proxy { proxy_config_url } else { url }, typ, attribution }`. `online_liste`: nach dem Laden über die Zeilen mappen, `if q.proxy && !benutzer.ist_admin() { q.url = "***".into() }`. `ist_admin()` in `src/auth/` verifizieren (Risiko-Notiz: `darf_admin_bereich()` schließt Führungskräfte ein).
- [ ] **Step 4: PASS + Clippy. Step 5: Commit**:

```bash
git add src/routes/karte.rs tests/karte.rs
git commit -m "feat(lfh-182): /config-Rewrite + url-Maskierung für proxy-Quellen"
```

---

### Task 5: SSRF-Resolver + `proxy_client` + `ssrf_redirect_policy`-Extraktion

**Files:** Modify `src/karte/download.rs`, `src/karte/proxy.rs`; Test in beiden.

**Interfaces:**
- Produces: `download::ssrf_redirect_policy() -> reqwest::redirect::Policy` (aus `download_client` herausgezogen). `proxy::sicherer_resolver() -> std::sync::Arc<dyn reqwest::dns::Resolve>` (löst Host auf, filtert `ip_ist_intern`, gibt nur public IPs; **keine** Adresse, wenn ein Host (auch) auf intern auflöst). `proxy::proxy_client() -> reqwest::Client` (Gesamt-Timeout + `dns_resolver(sicherer_resolver())` + `ssrf_redirect_policy()`).
- Consumes: `download::ip_ist_intern` (ggf. `pub(crate)` machen).

- [ ] **Step 1: Failing tests:**

```rust
// download.rs: ssrf_redirect_policy lehnt Redirect auf interne IP weiter ab (bestehendes Verhalten grün).
// proxy.rs:
#[tokio::test]
async fn sicherer_resolver_filtert_interne_ips() {
    let r = sicherer_resolver();
    // public Host → mind. eine Adresse, alle public
    // (gegen 'one.one.one.one' o.ä.; falls offline-CI: gegen einen kleinen Fake-Resolver-Adapter testen)
    // intern auflösender Host (z.B. 'localhost') → KEINE Adresse
}
#[test]
fn proxy_client_hat_gesamttimeout() {
    // Smoke: proxy_client() baut; Unterschied zu download_client dokumentiert (Gesamt-Timeout gesetzt).
}
```

Hinweis: Reiner Resolver-Unit-Test ohne Netz ist schwierig → bevorzugt die **Filter-Logik** als reine Funktion `fn nur_public(addrs: Vec<SocketAddr>) -> Vec<SocketAddr>` extrahieren und die testen (intern raus, leer wenn irgendeine intern war → fail-closed: bei gemischt **leer** zurückgeben). Resolver-Adapter ruft System-Resolver + `nur_public`.

- [ ] **Step 2: FAIL. Step 3: Implementieren.** `ssrf_redirect_policy` = der `Policy::custom`-Block aus `download_client` (1:1 verschoben; `download_client` ruft ihn auf — bestehende Tests bleiben grün). `nur_public(addrs)`: wenn ein Element `ip_ist_intern` → `vec![]`, sonst alle. Resolver impl `reqwest::dns::Resolve` (`reqwest 0.13.4`): in `resolve()` System-Lookup (`tokio::net::lookup_host`) + `nur_public`, als `Addrs`-Iterator zurück. `proxy_client`: `Client::builder().timeout(Duration::from_secs(30)).connect_timeout(…).dns_resolver(sicherer_resolver()).redirect(ssrf_redirect_policy()).user_agent("LifelineHub-Kartenproxy/1.0").build()`.
- [ ] **Step 4: PASS** (`rtk proxy cargo test -p lifeline-hub karte::download karte::proxy`). **Step 5: Clippy. Step 6: Commit**:

```bash
git add src/karte/download.rs src/karte/proxy.rs
git commit -m "feat(lfh-182): pinnender SSRF-Resolver + proxy_client; redirect-policy geteilt"
```

---

### Task 6: `hole_asset` — Asset-Fetch mit Header-Hygiene (Loopback)

**Files:** Modify `src/karte/proxy.rs`; Test (Loopback-Fixture wie `download.rs`).

**Interfaces:**
- Produces: `pub struct AssetAntwort { pub bytes: Vec<u8>, pub content_type: String, pub content_encoding: Option<String>, pub cache_control: Option<String> }`; `pub async fn hole_asset(client: &reqwest::Client, url: url::Url, byte_cap: usize) -> Result<AssetAntwort, ProxyFehler>`; `pub enum ProxyFehler { Status(u16), Http(String), ZuGross, Secret }` (`impl Display`).
- **Validiert NICHT selbst** (Loopback-testbar gegen 127.0.0.1); SSRF-Gate sitzt im Handler.

- [ ] **Step 1: Failing tests** (Fixture-Server analog `download.rs::spawn_fixture`, liefert konfigurierbare Header/Body):

```text
hole_asset (Loopback):
  - liefert bytes + content_type
  - Body > byte_cap → Err(ZuGross) (Content-Length NICHT vertrauen: auch ohne CL beim Streamen abbrechen)
  - Content-Encoding: gzip wird verbatim als content_encoding durchgereicht (Bytes unverändert)
  - Upstream content_type text/html → content_type == application/octet-stream (Clamp)
  - non-2xx → Err(Status(code)) ohne Upstream-Body
```

- [ ] **Step 2: FAIL. Step 3: Implementieren.** reqwest-Client OHNE automatisches Decompress für diesen Pfad (oder content_encoding manuell durchreichen — prüfen, ob das `gzip`-Feature aktiv ist: `rg "features" Cargo.toml` für reqwest; falls aktiv, `Response` dekomprimiert automatisch → dann content_encoding NICHT setzen und Bytes sind dekomprimiert; **Entscheidung dokumentieren**). Byte-Cap: chunked lesen (`resp.chunk().await`), bei Überschreitung abbrechen. Content-Type-Clamp: wenn `starts_with("text/")` → `application/octet-stream`. Nur Allowlist-Header übernehmen.
- [ ] **Step 4: PASS. Step 5: Clippy. Step 6: Commit**:

```bash
git add src/karte/proxy.rs
git commit -m "feat(lfh-182): hole_asset mit Byte-Cap + Header-Hygiene (Loopback-getestet)"
```

---

### Task 7: `hole_style` / `hole_tilejson` — fetch + rewrite + Slots (Loopback)

**Files:** Modify `src/karte/proxy.rs`; Test (Loopback, gegen `test_pool` für echte Slots).

**Interfaces:**
- Produces: `pub async fn hole_style(client, pool, quelle_id: i64, url: url::Url) -> Result<String, ProxyFehler>` und `pub async fn hole_tilejson(client, pool, quelle_id: i64, slot_url: url::Url) -> Result<String, ProxyFehler>` — fetch JSON, `rewrite_*` mit `mint = |u,art| proxy_url(id, art, slot_upsert(pool,quelle_id,u,art.as_str()))`, danach `contains_secret(&serialisiert, &url)` → `Err(Secret)` (fail-closed).

- [ ] **Step 1: Failing tests** (Voll-Style-Loopback-Kette):

```text
hole_style (Loopback + test_pool):
  - Fixture liefert vollen Style (sources.url→tilejson, raster.tiles, geojson.data, sprite, glyphs) mit ?key=K
  - Ergebnis-String enthält KEIN key=K / keinen Loopback-Host
  - die geminteten Slots lösen via slot_aufloesen auf die Upstream-URLs (mit Key) auf
  - fail-closed: wenn ein Key NICHT als URL auftaucht (z.B. nur in attribution-HTML) → Err(Secret)
hole_tilejson: tiles[]→Template-Slots, key-frei, scheme=tms normalisiert
```

- [ ] **Step 2: FAIL. Step 3: Implementieren** — fetch (`client.get(url).send()`), `resp.json::<Value>()` bzw. Text→parse; `basis = url.clone()`; `rewrite_style(&mut v, &basis, &mut mint, MAX_SLOTS)`; `let s = serde_json::to_string(&v)`; `if contains_secret(&s, &url) { return Err(Secret) }`; `Ok(s)`. `mint` schreibt synchron — aber `slot_upsert` ist async. Lösung: Rewrite gibt die zu mintenden (url,art) zurück ODER mint sammelt und Upsert läuft danach. **Einfachste Variante:** zweiphasig — Phase 1 `rewrite_*` mit `mint` das in eine `Vec<(String,SlotArt)>` sammelt und einen Platzhalter-Index-URL setzt; Phase 2 `slot_upsert` je gesammelter URL (await), dann Platzhalter→echte `proxy_url` ersetzen. Diese Zweiphasigkeit in `hole_style` kapseln (Walker bleibt synchron/rein).
- [ ] **Step 4: PASS. Step 5: Clippy. Step 6: Commit**:

```bash
git add src/karte/proxy.rs
git commit -m "feat(lfh-182): hole_style/hole_tilejson fetch+rewrite+slots, fail-closed"
```

---

### Task 8: Proxy-Endpunkte (Handler) + Routen + `ProxyState`

**Files:** Modify `src/routes/karte.rs`, `src/app.rs`, `src/main.rs`, `tests/karte.rs`, alle `tests/*.rs` mit `AppState`-Konstruktion.

**Interfaces:**
- Consumes: `proxy::{hole_style,hole_tilejson,hole_asset,subst_template,subst_glyphs,sprite_upstream,split_slot_suffix,validiere_range,validiere_fontstack}`, `repo::{finde_online_quelle?, slot_aufloesen}`, `download::url_ist_sicher`.
- Produces: `AppState.proxy: ProxyState { client: reqwest::Client, slots: Arc<RwLock<HashMap<(i64,i64),String>>> }`; Handler `proxy_style`, `proxy_raster`, `proxy_tile`, `proxy_tilejson`, `proxy_sprite`, `proxy_glyphs`.

**Handler-Regeln (alle):** Quelle laden; existiert + `proxy=1` + `aktiv` sonst `404`. Upstream-URL bestimmen (style/raster: aus `quelle.url`; tile/tilejson/sprite/glyphs: `slot_aufloesen(quelle_id, slot, ERWARTETE_ART)` → `404` bei `None`/art-Mismatch). `download::url_ist_sicher(&Url::parse(materialisiert)?)` → Fehlerstatus bei intern. Dann Service (`hole_style`/`hole_tilejson` → JSON-Response `no-cache`; `hole_asset` → Bytes mit hygienisierten Headern + durchgereichtem `Cache-Control`/`ETag`).

- [ ] **Step 1: `ProxyState` rollout (compile-getrieben).** `rg -n "AppState\s*\{" src tests` → Liste. `ProxyState` definieren, Feld in `AppState`, in `main.rs` konstruieren (`proxy_client()` + leerer Slot-Cache), in jeder Test-Konstruktion **eine** Zeile ergänzen. `rtk proxy cargo build --tests` bis grün.
- [ ] **Step 2: Failing tests/karte.rs** (Route-Ebene; Happy-Path der Fetches ist über die Service-Loopback-Kette in Task 6/7 bewiesen — hier Ablehnung/Scoping):

```text
GET /api/karte/proxy/999/style.json → 404 (Handler, nicht SPA-Fallback-HTML)
style.json-Handler: proxy=0-Quelle ODER inaktiv → 404; interne gespeicherte url → Fehlerstatus (SSRF-Gate vor Connect)
GET /tile/{slot}/1/1/1 auf Sprite-Slot → 404 (art-Mismatch); Slot fremder quelle_id → 404
GET /raster/{z}/{x}/{y} mit nicht-numerischem z → 400/404 (i64-Path-Typing)
glyphs-Range '0-255?x=' → abgelehnt
SSRF-Integration: Upstream-Style referenziert sprite auf interne Adresse → Slot-Fetch vor GET abgelehnt
```

- [ ] **Step 3: FAIL. Step 4: Handler implementieren** + `src/app.rs` Routen:

```rust
// in app.rs router(), bei den /api/karte-Routen:
.route("/api/karte/proxy/{id}/style.json", get(routes::karte::proxy_style))
.route("/api/karte/proxy/{id}/raster/{z}/{x}/{y}", get(routes::karte::proxy_raster))
.route("/api/karte/proxy/{id}/tile/{slot}/{z}/{x}/{y}", get(routes::karte::proxy_tile))
.route("/api/karte/proxy/{id}/tilejson/{slot}", get(routes::karte::proxy_tilejson))
.route("/api/karte/proxy/{id}/sprite/{rest}", get(routes::karte::proxy_sprite))
.route("/api/karte/proxy/{id}/glyphs/{slot}/{fontstack}/{range}", get(routes::karte::proxy_glyphs))
```

`proxy_raster`/`proxy_tile`: `subst_template(template, z,x,y)`; `proxy_glyphs`: `validiere_fontstack`+`validiere_range`+`subst_glyphs`; `proxy_sprite`: `split_slot_suffix(rest)`→`(slot,suffix)`, `slot_aufloesen(…, "sprite")`, `sprite_upstream(base,&suffix)`. Slot-Cache vor `slot_aufloesen` konsultieren; bei Quelle-Update/Delete (Task 3/4) Cache invalidieren.
- [ ] **Step 5: PASS** (`rtk proxy cargo test -p lifeline-hub` gesamt). **Step 6: Clippy. Step 7: Commit**:

```bash
git add src/routes/karte.rs src/app.rs src/main.rs tests/
git commit -m "feat(lfh-182): Proxy-Endpunkte + Routen + ProxyState"
```

---

### Task 9: Frontend — Admin-Proxy-Schalter + Style-Transparenz

**Files:** Modify `frontend/src/.../OnlineQuelleFormModal.tsx` (Pfad per `rg` verifizieren), `frontend/src/pages/lagekarte/basemapStil.ts`; Test `basemapStil.test.ts` + Form-Test/msw-Mocks.

**Interfaces:**
- Consumes: API-Vertrag — `OnlineStyle.url` kann jetzt relativ sein; POST/PATCH-Body trägt `proxy: boolean`.
- Produces: `baueOnlineStyle` absolutiert Vektor-`url` gegen `window.location.origin` (idempotent für Absolut-URLs); Form mappt `proxy`.

- [ ] **Step 1: Failing vitest** (`basemapStil.test.ts`):

```ts
it('absolutiert relative Vektor-Proxy-URL gegen Origin', () => {
  const s = baueOnlineStyle({ name: 'P', url: '/api/karte/proxy/1/style.json', typ: 'vektor', attribution: null });
  expect(s).toBe(new URL('/api/karte/proxy/1/style.json', window.location.origin).href);
});
it('Raster-Proxy-Template bleibt relatives tiles[0]', () => {
  const s = baueOnlineStyle({ name: 'P', url: '/api/karte/proxy/1/raster/{z}/{x}/{y}', typ: 'raster', attribution: null }) as StyleSpecification;
  expect((s.sources.raster as any).tiles[0]).toBe('/api/karte/proxy/1/raster/{z}/{x}/{y}');
});
```

Plus Form-Test: Proxy-`<Switch>` an + speichern → `proxy:true` im Body; ohne Umschalten `proxy:false`. Bestehende msw-Mocks um `proxy:false` ergänzen.

- [ ] **Step 2: FAIL** (`mise exec pnpm@<ver> -- pnpm -C <abs> test --no-file-parallelism basemapStil`).
- [ ] **Step 3: Implementieren.** `baueOnlineStyle`: für Vektor `return new URL(stil.url, window.location.origin).href` (statt nacktem `stil.url`). Raster unverändert (relatives Template ist same-origin gültig). Form: `<Form.Item name="proxy" valuePropName="checked"><Switch/></Form.Item>` + Hilfetext „Key bleibt auf dem Server"; `proxy` in initialValues/Submit-Body. App-Pattern (`App.useApp()` für message) beachten.
- [ ] **Step 4: PASS. Step 5: Gates** — `pnpm lint` (`--max-warnings 0`), `pnpm exec tsc --noEmit`, `pnpm test --no-file-parallelism` (alle via `rtk proxy mise exec …`). **Step 6: Commit**:

```bash
git add frontend/src
git commit -m "feat(lfh-182): Admin-Proxy-Schalter + Vektor-Style-URL-Absolutierung"
```

---

### Task 10: Frontend-Build, Verifikation, Doku

**Files:** Modify `docs/betrieb/packaging.md` (Abschnitt Lagekarte/Basemap) falls vorhanden; Browser-Smoke.

- [ ] **Step 1:** Frontend bauen (rust-embed): `mise exec pnpm@<ver> -- pnpm -C <abs> build`; Backend neu starten.
- [ ] **Step 2: Browser-Smoke** (Map ist WebGL, jsdom-untestbar): Debug-Backend mit `--admin-password` hochziehen, eine **key-basierte Vektor-Quelle** (MapTiler-Style-URL mit Test-Key) als `proxy=1` anlegen, Lagekarte öffnen. Netzwerk-Tab prüfen: (a) Karte rendert (Tiles+Sprite+Glyphs über `/api/karte/proxy/…`), (b) **kein** Request an den Upstream-Host, (c) Key in **keiner** geladenen Ressource. Ohne Test-Key: gegen einen Loopback-Fixture-Upstream (Service-Kette beweist es bereits).
- [ ] **Step 3:** Doku-Notiz in `docs/betrieb/packaging.md` (Proxy-Schalter, „Key bleibt server-seitig", v1-Grenzen: Platzhalter-Set, kein Style-Cache/Rate-Limit, Volumen-Open-Proxy-Bedrohungslage). 
- [ ] **Step 4: Gesamt-Gates re-run** gegen den dann-aktuellen `main`-Stand (Re-Baseline, Migrationsnummer prüfen). **Step 5: Commit**:

```bash
git add docs/betrieb/packaging.md
git commit -m "docs(lfh-182): Proxy-Schalter + v1-Grenzen im Packaging-Doc"
```

---

## Offene Risiken / bewusste v1-Grenzen (aus der adversarialen Review)

- **DNS-Rebinding** → pinnender Resolver (Task 5). `url_ist_sicher` allein reicht NICHT.
- **Open-Proxy-Exfiltration** → strukturell-zuerst + neutralize (Task 2); kein Static-Catch-all.
- **Key-Leak in attribution-HTML/Pfadsegmenten** → `contains_secret` fail-closed (Backstop); dokumentierte Restgrenze (Pfad-/Subdomain-Keys nicht scanbar).
- **Volumen-Open-Proxy** (unauth Endpunkt drainiert Key) → bewusst OUT-OF-SCOPE (kein Key-Konsument), Cache-Header-Passthrough; dokumentiert.
- **Platzhalter-Set v1** `{z}{x}{y}{-y}`, `{fontstack}{range}` — `{quadkey}/{ratio}/{bbox}` beim Speichern abgelehnt (fail-fast), additiv erweiterbar.
- **Migrationsnummer 0077** vor Merge gegen aktuellen Stand prüfen.
- **MapLibre relative Style-URL** → root-relative Proxy-URLs + Frontend-Absolutierung; im Browser-Smoke empirisch verifizieren.

## Self-Review (gegen Spec)

- Spec §1 proxy-Flag → Task 3. §2 /config-Rewrite + Repo-Query → Task 3/4. §3 Endpunkte → Task 8. §4 Slot-Map → Task 3 (+ Cache Task 8). §5 Sicherheit: SSRF/Resolver Task 5, Header-Hygiene Task 6, Rewrite/neutralize/contains_secret Task 2/7, Param-Guards Task 1/8, Maskierung Task 4, DoS-Cap Task 2. §6 Frontend → Task 9. §7 Komponentenschnitt → Tasks 1–9. §10 Verifikation → Task 10.
- Keine offenen Platzhalter; Signaturen über Interfaces-Blöcke konsistent (`SlotArt`, `proxy_url`, `slot_upsert/aufloesen/loeschen`, `hole_*`, `ProxyState`).
