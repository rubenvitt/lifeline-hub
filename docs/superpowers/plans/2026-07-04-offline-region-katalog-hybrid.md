# Offline-Region-Katalog (Hybrid) + geführter Picker — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Den Offline-Karten-Katalog von einem einzelnen DE-Eintrag auf einen kuratierten, hybrid ausgelieferten Regions-Katalog (~5–20) erweitern und die Auswahl im Admin-UI führen/auffindbar machen.

**Architecture:** Compiled-in Default-Katalog bleibt die Offline-Baseline; ein optionales, best-effort geholtes Remote-Manifest (gepinnte Mirror-URL) ergänzt/überschreibt per `name`. Reine Merge-Logik ist von Fetch/Cache getrennt (testbar ohne Netz). Frontend gruppiert die vorhandene Katalog-Auswahl und erklärt sie; der Download-/Registry-Pfad bleibt unangetastet.

**Tech Stack:** Rust/axum, reqwest (schon Dependency), sqlx; Frontend React + antd + @tanstack/react-query + Vitest/RTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-04-offline-region-katalog-hybrid-design.md` — verbindlich.
- Rust-Gate: `cargo test` (nicht fmt/clippy). Bestandsstil, Kommentare Deutsch.
- Frontend-Gate: `pnpm lint` (`--max-warnings 0`), `tsc --noEmit`, `vitest`. node/pnpm via mise.
- KEIN serverseitiges Tiling, KEIN Docker im Betrieb. Manifest-URL kompiliert-gepinnt (nicht admin-konfigurierbar).
- Download-Integrität bleibt per-Eintrag-`sha256` (bestehende Mechanik). Remote-Einträge werden nur ausgeliefert, wenn vollständig gepinnt (sha256 64-hex + https-non-TODO-URL + groesse>0 + lizenz).
- Compiled-in bleibt immer Fallback; ein fehlgeschlagener Manifest-Fetch darf den Katalog/Offline-Betrieb NIE brechen.

---

### Task A1: Reine Merge-Funktion `merge_offline_katalog`

**Files:**
- Modify: `src/config.rs` (neben `default_offline_katalog`)
- Test: `src/config.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `OfflineKatalogEintrag.gruppe: Option<String>` (neues Feld — hier hinzugefügt, damit alle Struct-Literale ab A1 es konsistent tragen; A2 nutzt es nur)
- Produces: `pub fn merge_offline_katalog(compiled: Vec<OfflineKatalogEintrag>, remote: Option<Vec<OfflineKatalogEintrag>>) -> Vec<OfflineKatalogEintrag>`
- Produces: `fn remote_eintrag_ist_gueltig(e: &OfflineKatalogEintrag) -> bool` (privat)

**Vor Step 1** das Feld an `OfflineKatalogEintrag` ergänzen (nach `sha256`), damit die Tests kompilieren:
```rust
    /// Optionale UX-Gruppe für die geführte Auswahl (z. B. „Deutschland", „DACH",
    /// „Bundesländer"). Rein für die Frontend-Gruppierung; `None` = ungruppiert.
    pub gruppe: Option<String>,
```
Der bestehende `default_offline_katalog()`-Eintrag bekommt dabei `gruppe: Some("Deutschland".into())` (wird in A2 ohnehin ersetzt).

- [ ] **Step 1: Failing test — Merge-Verhalten**

```rust
#[test]
fn merge_katalog_override_ergaenzt_und_verwirft_ungueltige() {
    let compiled = vec![
        eintrag("Deutschland (Shortbread)", "https://TODO-x/de.mbtiles", None), // Platzhalter
        eintrag("Bayern", "https://TODO-x/by.mbtiles", None),
    ];
    let remote = vec![
        // Override „Deutschland": echter Pin ersetzt den Platzhalter
        eintrag("Deutschland (Shortbread)", "https://mirror.example/de.mbtiles", Some("a".repeat(64))),
        // Neuer Eintrag: wird angehängt
        eintrag("DACH", "https://mirror.example/dach.mbtiles", Some("b".repeat(64))),
        // Ungültig (halb-gepinnt: echte URL ohne sha256) → verworfen
        eintrag("Sachsen", "https://mirror.example/sn.mbtiles", None),
    ];
    let out = merge_offline_katalog(compiled, Some(remote));
    let de = out.iter().find(|e| e.name == "Deutschland (Shortbread)").unwrap();
    assert_eq!(de.url, "https://mirror.example/de.mbtiles", "Remote-Pin überschreibt Platzhalter");
    assert!(out.iter().any(|e| e.name == "DACH"), "neuer Remote-Eintrag ergänzt");
    assert!(out.iter().any(|e| e.name == "Bayern"), "compiled-in bleibt erhalten");
    assert!(!out.iter().any(|e| e.name == "Sachsen"), "halb-gepinnter Remote-Eintrag verworfen");
}

#[test]
fn merge_katalog_ohne_remote_ist_identisch() {
    let compiled = vec![eintrag("Bayern", "https://TODO-x/by.mbtiles", None)];
    assert_eq!(merge_offline_katalog(compiled.clone(), None).len(), compiled.len());
}

// Test-Helfer (im tests-Modul):
fn eintrag(name: &str, url: &str, sha256: Option<String>) -> OfflineKatalogEintrag {
    OfflineKatalogEintrag {
        name: name.into(), url: url.into(), region: "DE".into(), groesse: 1_000,
        lizenz: "© OSM (ODbL)".into(), kachel_schema: "shortbread".into(),
        quelle: "test".into(), sha256, gruppe: None,
    }
}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cargo test --lib config::tests::merge_katalog -- --nocapture`
Expected: FAIL („cannot find function `merge_offline_katalog`").

- [ ] **Step 3: Implement**

```rust
/// Merged den kompilierten Default-Katalog mit einem optionalen Remote-Manifest (Hybrid, LFH-199).
/// Override per `name`: ein gültiger Remote-Eintrag mit gleichem Namen ersetzt den compiled-in
/// Eintrag; neue Namen werden angehängt. Der compiled-in Katalog ist immer die Baseline
/// (Offline-Fallback); `remote == None` (Fetch fehlgeschlagen/offline) → unveränderter Default.
pub fn merge_offline_katalog(
    compiled: Vec<OfflineKatalogEintrag>,
    remote: Option<Vec<OfflineKatalogEintrag>>,
) -> Vec<OfflineKatalogEintrag> {
    let Some(remote) = remote else { return compiled };
    let mut out = compiled;
    for e in remote {
        // Remote-Einträge müssen vollständig gepinnt sein — sonst käme ein Eintrag ohne
        // Integritätsprüfung/echte URL ins UI. Halb-gepinnte/Platzhalter-Remote-Einträge verwerfen.
        if !remote_eintrag_ist_gueltig(&e) {
            continue;
        }
        match out.iter_mut().find(|c| c.name == e.name) {
            Some(slot) => *slot = e, // Override per name
            None => out.push(e),     // neuer Eintrag ergänzt
        }
    }
    out
}

/// Ein Remote-Katalog-Eintrag ist nur auslieferbar, wenn vollständig gepinnt: 64-stelliger
/// lowercase-hex-sha256, echte https-URL (kein TODO-Platzhalter), Größe > 0, Lizenz gesetzt.
fn remote_eintrag_ist_gueltig(e: &OfflineKatalogEintrag) -> bool {
    matches!(&e.sha256, Some(h)
        if h.len() == 64 && h.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()))
        && e.url.starts_with("https://")
        && !e.url.contains("TODO")
        && e.groesse > 0
        && !e.lizenz.is_empty()
}
```

- [ ] **Step 4: Run — verify PASS**

Run: `cargo test --lib config::tests::merge_katalog`
Expected: PASS (2 Tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.rs
git commit -m "feat(lfh-199): reine merge_offline_katalog (Hybrid-Katalog, override per name)"
```

---

### Task A2: `gruppe`-Feld + kuratierte Platzhalter-Einträge

**Files:**
- Modify: `src/config.rs` (`OfflineKatalogEintrag`, `default_offline_katalog`)
- Test: `src/config.rs` tests

**Interfaces:**
- Consumes: `OfflineKatalogEintrag.gruppe` (in A1 hinzugefügt)

- [ ] **Step 1: Failing test — Katalog hat mehrere gruppierte Einträge**

```rust
#[test]
fn offline_katalog_ist_kuratiert_und_gruppiert() {
    let k = default_offline_katalog();
    assert!(k.len() >= 3, "kuratierter Katalog mit mehreren Regionen: {}", k.len());
    assert!(k.iter().all(|e| e.gruppe.is_some()), "jeder Eintrag hat eine UX-Gruppe");
    assert!(k.iter().any(|e| e.region == "DE" && e.name.contains("Deutschland")));
    // Konsistenz-Regel (LFH-197) gilt weiter (siehe katalog_eintrag_sha256_pin_konsistent).
    for e in &k {
        assert!(e.url.starts_with("https://"), "nur https: {}", e.url);
        assert_eq!(e.kachel_schema, "shortbread");
    }
}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cargo test --lib config::tests::offline_katalog_ist_kuratiert`
Expected: FAIL (Feld `gruppe` existiert nicht / nur 1 Eintrag).

- [ ] **Step 3: Implement — kuratierte Einträge**

`default_offline_katalog()` auf die kuratierte Liste erweitern (das `gruppe`-Feld stammt aus A1). Alle als **Platzhalter** (sha256 None, TODO-URL) — der Operator pinnt/hostet später (LFH-197-Runbook, Subtask C). Muster je Eintrag (Gruppe „Deutschland" für DE, „DACH" für Nachbarn, „Bundesländer" für Länder):

```rust
    fn platzhalter(name: &str, region: &str, gruppe: &str, ca_gb: i64) -> OfflineKatalogEintrag {
        OfflineKatalogEintrag {
            name: name.into(),
            url: format!("https://TODO-karten-build-release/{}.shortbread.mbtiles",
                region.to_lowercase()),
            region: region.into(),
            groesse: ca_gb * 1024 * 1024 * 1024,
            lizenz: "© OpenStreetMap contributors (ODbL)".into(),
            kachel_schema: "shortbread".into(),
            quelle: "Eigenbau (karten-build, Planetiler-Shortbread)".into(),
            sha256: None,
            gruppe: Some(gruppe.into()),
        }
    }
    vec![
        platzhalter("Deutschland (Shortbread)", "DE", "Deutschland", 3),
        platzhalter("DACH (DE/AT/CH)", "DACH", "DACH", 5),
        platzhalter("Bayern", "DE-BY", "Bundesländer", 1),
        platzhalter("Baden-Württemberg", "DE-BW", "Bundesländer", 1),
        platzhalter("Nordrhein-Westfalen", "DE-NW", "Bundesländer", 1),
        platzhalter("Niedersachsen", "DE-NI", "Bundesländer", 1),
    ]
```

Den bisherigen einzelnen DE-Eintrag durch diese Liste ersetzen (Name „Deutschland (Shortbread)" bleibt identisch → Update-Check/Override-Key stabil). Die `>>> OPERATOR-PIN <<<`-Doku aus LFH-197 auf „gilt je Eintrag" anpassen.

- [ ] **Step 4: Run — verify PASS (inkl. Bestandstests)**

Run: `cargo test --lib config::`
Expected: PASS. Falls `katalog_eintrag_sha256_pin_konsistent` bricht: Einträge sind alle Platzhalter (sha256 None + TODO-URL) → Bikonditionale erfüllt; keine Änderung nötig.

- [ ] **Step 5: Commit**

```bash
git add src/config.rs
git commit -m "feat(lfh-199): kuratierte Regions-Platzhalter + gruppe-Feld im Offline-Katalog"
```

---

### Task A3: Remote-Manifest-Fetch + Cache + Handler-Verdrahtung

**Files:**
- Create: `src/karte/katalog.rs` (Fetch + Cache + Effektiv-Katalog)
- Modify: `src/karte/mod.rs` (Modul einhängen)
- Modify: `src/app.rs` (AppState-Cache-Feld + Init)
- Modify: `src/routes/karte.rs` (`offline_katalog`, `offline_liste` auf Effektiv-Katalog)
- Test: `src/karte/katalog.rs` tests

**Interfaces:**
- Consumes: `config::{default_offline_katalog, merge_offline_katalog, OfflineKatalogEintrag}`
- Produces: `pub const OFFLINE_KATALOG_MANIFEST_URL: &str`
- Produces: `pub type KatalogCache = std::sync::Arc<std::sync::RwLock<Option<Vec<OfflineKatalogEintrag>>>>`
- Produces: `pub async fn effektiver_katalog(client: &reqwest::Client, cache: &KatalogCache) -> Vec<OfflineKatalogEintrag>`
- Produces: `pub fn merge_mit_cache(cache: &KatalogCache) -> Vec<OfflineKatalogEintrag>` (synchron, für Tests/`offline_liste`)

- [ ] **Step 1: Failing test — Cache-Fallback & Merge**

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effektiv_ohne_cache_ist_compiled_in() {
        let cache: KatalogCache = Default::default();
        let out = merge_mit_cache(&cache);
        assert_eq!(out.len(), crate::config::default_offline_katalog().len());
    }

    #[test]
    fn effektiv_mit_cache_merged_remote() {
        let cache: KatalogCache = Default::default();
        *cache.write().unwrap() = Some(vec![crate::config::OfflineKatalogEintrag {
            name: "DACH (DE/AT/CH)".into(),
            url: "https://mirror.example/dach.mbtiles".into(),
            region: "DACH".into(), groesse: 5_000_000_000,
            lizenz: "© OSM (ODbL)".into(), kachel_schema: "shortbread".into(),
            quelle: "mirror".into(), sha256: Some("c".repeat(64)), gruppe: Some("DACH".into()),
        }]);
        let out = merge_mit_cache(&cache);
        let dach = out.iter().find(|e| e.name == "DACH (DE/AT/CH)").unwrap();
        assert_eq!(dach.url, "https://mirror.example/dach.mbtiles", "Cache-Remote gemerged");
    }
}
```

- [ ] **Step 2: Run — verify FAIL**

Run: `cargo test --lib karte::katalog`
Expected: FAIL (Modul/Funktion existiert nicht).

- [ ] **Step 3: Implement `src/karte/katalog.rs`**

```rust
//! Hybrid-Offline-Katalog (LFH-199): compiled-in Default ∪ optionales, best-effort geholtes
//! Remote-Manifest (gepinnte Mirror-URL). Der Fetch ist best-effort und darf den Katalog nie
//! brechen — bei jedem Fehler bleibt es beim compiled-in Default (bzw. dem letzten Cache-Stand).
use crate::config::{default_offline_katalog, merge_offline_katalog, OfflineKatalogEintrag};
use std::sync::{Arc, RwLock};

/// Gepinnte Manifest-URL am Eigen-Mirror (LFH-183). Platzhalter bis zum ersten Release —
/// bis dahin schlägt der Fetch sauber fehl → compiled-in Fallback.
pub const OFFLINE_KATALOG_MANIFEST_URL: &str =
    "https://TODO-karten-build-release/offline-katalog-manifest.json";

/// Zuletzt erfolgreich geholtes Remote-Manifest (in-memory). `None` = noch nichts geholt.
pub type KatalogCache = Arc<RwLock<Option<Vec<OfflineKatalogEintrag>>>>;

/// Synchroner Merge des compiled-in Katalogs mit dem gecachten Remote-Manifest (ohne Netz).
/// Für `offline_liste` (Update-Check) und Tests.
pub fn merge_mit_cache(cache: &KatalogCache) -> Vec<OfflineKatalogEintrag> {
    let remote = cache.read().unwrap().clone();
    merge_offline_katalog(default_offline_katalog(), remote)
}

/// Effektiver Katalog: best-effort Manifest-Fetch (aktualisiert den Cache bei Erfolg), dann Merge.
/// Jeder Fehler (offline, Statusfehler, Parse) wird verschluckt → Cache/compiled-in bleibt.
pub async fn effektiver_katalog(
    client: &reqwest::Client,
    cache: &KatalogCache,
) -> Vec<OfflineKatalogEintrag> {
    if let Some(remote) = hole_manifest(client).await {
        *cache.write().unwrap() = Some(remote);
    }
    merge_mit_cache(cache)
}

async fn hole_manifest(client: &reqwest::Client) -> Option<Vec<OfflineKatalogEintrag>> {
    let resp = client.get(OFFLINE_KATALOG_MANIFEST_URL).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    resp.json::<Vec<OfflineKatalogEintrag>>().await.ok()
}
```

`OfflineKatalogEintrag` braucht `Deserialize` (für `resp.json`). In `src/config.rs` das Derive erweitern: `#[derive(Clone, Debug, Serialize, Deserialize)]` (Import `serde::Deserialize` sicherstellen).

`src/karte/mod.rs`: `pub mod katalog;` ergänzen.

`src/app.rs`: AppState-Feld ergänzen und initialisieren:

```rust
    /// Cache des zuletzt geholten Remote-Katalog-Manifests (Hybrid-Katalog, LFH-199).
    pub offline_katalog_cache: crate::karte::katalog::KatalogCache,
```
(bei der AppState-Konstruktion `offline_katalog_cache: Default::default(),`)

`src/routes/karte.rs`:
- `offline_katalog` auf den Effektiv-Katalog umstellen:

```rust
pub async fn offline_katalog(
    State(state): State<AppState>,
    _admin: AdminUser,
) -> Result<Json<Vec<OfflineKatalogEintrag>>, AppError> {
    Ok(Json(
        crate::karte::katalog::effektiver_katalog(&state.download_client, &state.offline_katalog_cache).await,
    ))
}
```
- In `offline_liste` Zeile 541 `let katalog = default_offline_katalog();` ersetzen durch
  `let katalog = crate::karte::katalog::merge_mit_cache(&state.offline_katalog_cache);`
  (synchron, kein Netz-Call in der Liste; nutzt den Cache, den `offline_katalog` füllt).

- [ ] **Step 4: Run — verify PASS + volles Gate**

Run: `cargo test --lib karte::katalog` → PASS.
Run: `cargo test` → alle grün.

- [ ] **Step 5: Commit**

```bash
git add src/karte/katalog.rs src/karte/mod.rs src/app.rs src/routes/karte.rs src/config.rs
git commit -m "feat(lfh-199): Remote-Manifest-Fetch + Cache, Handler auf Effektiv-Katalog"
```

---

### Task B1: Frontend — `gruppe`-Typ, gruppierter Picker, Erklärung, Einstieg

**Files:**
- Modify: `frontend/src/api/offlineKarten.ts` (`OfflineKatalogEintrag.gruppe`)
- Modify: `frontend/src/karten/OfflineDownloadKatalogModal.tsx` (Gruppierung + Erklärung + Titel)
- Modify: `frontend/src/karten/OfflineKartenVerwaltung.tsx` (sprechender Einstiegs-Button)
- Test: `frontend/src/karten/OfflineDownloadKatalogModal.test.tsx` (neu oder erweitern)

**Interfaces:**
- Consumes: `OfflineKatalogEintrag` (Server-autoritativ, jetzt mit `gruppe?: string | null`)

- [ ] **Step 1: Failing test — Gruppierung rendert + Auswahl triggert Download**

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';
import { vi } from 'vitest';
import OfflineDownloadKatalogModal from './OfflineDownloadKatalogModal';
import * as api from '../api/offlineKarten';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}><App>{ui}</App></QueryClientProvider>;
}

test('gruppiert Katalog und startet Download beim Klick', async () => {
  vi.spyOn(api, 'ladeOfflineKatalog').mockResolvedValue([
    { name: 'Deutschland (Shortbread)', url: 'u1', region: 'DE', groesse: 3e9, lizenz: 'ODbL', kachel_schema: 'shortbread', quelle: 'q', sha256: null, gruppe: 'Deutschland' },
    { name: 'Bayern', url: 'u2', region: 'DE-BY', groesse: 1e9, lizenz: 'ODbL', kachel_schema: 'shortbread', quelle: 'q', sha256: null, gruppe: 'Bundesländer' },
  ]);
  const dl = vi.spyOn(api, 'starteOfflineDownload').mockResolvedValue({} as never);

  render(wrap(<OfflineDownloadKatalogModal offen vorhandeneUrls={new Set()} onClose={() => {}} />));

  expect(await screen.findByText('Bundesländer')).toBeInTheDocument(); // Gruppen-Überschrift
  await userEvent.click(screen.getAllByRole('button', { name: /herunterladen/i })[0]);
  expect(dl).toHaveBeenCalledWith(expect.objectContaining({ name: 'Deutschland (Shortbread)' }));
});
```

- [ ] **Step 2: Run — verify FAIL**

Run: `mise exec pnpm@<ver> -- pnpm -C /Users/rubeen/dev/personal/lifeline-hub/frontend test -- OfflineDownloadKatalogModal --run`
Expected: FAIL (keine Gruppen-Überschrift „Bundesländer").

- [ ] **Step 3: Implement — Typ + Gruppierung + Erklärung**

`offlineKarten.ts` `OfflineKatalogEintrag` ergänzen:
```ts
  /** Optionale UX-Gruppe für die geführte Auswahl. */
  gruppe?: string | null;
```

`OfflineDownloadKatalogModal.tsx`: statt einer flachen `List` die Einträge nach `gruppe` gruppieren (Fallback-Gruppe „Weitere" für `null`), je Gruppe eine Überschrift + `List`. Titel auf „Region aufs Gerät bringen", Erklärungsabsatz beibehalten/erweitern. Minimaler Umbau:
```tsx
const gruppen = (katalogQuery.data ?? []).reduce<Record<string, OfflineKatalogEintrag[]>>((acc, e) => {
  const g = e.gruppe ?? 'Weitere';
  (acc[g] ??= []).push(e);
  return acc;
}, {});
// ... render: Object.entries(gruppen).map(([gruppe, eintraege]) => (
//   <div key={gruppe}><Typography.Title level={5}>{gruppe}</Typography.Title><List dataSource={eintraege} ... /></div>
// ))
```
Die vorhandene `renderItem`-Logik (Herunterladen/Vorhanden/Meta) je Gruppen-`List` wiederverwenden.

`OfflineKartenVerwaltung.tsx`: den Button, der das Modal öffnet, sprechend benennen (z. B. „Region aufs Gerät bringen" statt „Aus Katalog herunterladen"), Modal-Titel entsprechend.

- [ ] **Step 4: Run — verify PASS + Gates**

Run: `... pnpm -C .../frontend test -- OfflineDownloadKatalogModal --run` → PASS.
Run: `... pnpm -C .../frontend lint` und `... tsc --noEmit` → sauber.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api/offlineKarten.ts frontend/src/karten/OfflineDownloadKatalogModal.tsx frontend/src/karten/OfflineKartenVerwaltung.tsx frontend/src/karten/OfflineDownloadKatalogModal.test.tsx
git commit -m "feat(lfh-199): gruppierter Regions-Picker + sprechender Einstieg (Frontend)"
```

---

## Notes für die Umsetzung

- Reihenfolge: A1 → A2 → A3 → B1 (B1 hängt am `gruppe`-Feld aus A2/A3, nicht an A3s Fetch).
- Kein echter Netz-Call in Tests: die Merge-/Cache-Logik wird über `KatalogCache`-Injektion getestet; `hole_manifest`/`effektiver_katalog`s Netzpfad bleibt untested (best-effort, Fallback ist der getestete Pfad).
- `frontend/dist` muss für `cargo test` vorhanden sein (rust-embed) — im Haupt-Arbeitsbaum gegeben.
